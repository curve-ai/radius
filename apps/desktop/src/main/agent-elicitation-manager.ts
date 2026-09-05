import { randomUUID } from "node:crypto";

import type { AcpElicitationHandler } from "@curve-ai/radius-runtime";

import type {
  AgentElicitationField,
  AgentElicitationOption,
  AgentElicitationResponse,
  AgentElicitationValue,
  PendingAgentElicitation,
  ResolveAgentElicitationInput,
} from "../radius-api";
import {
  compileElicitationPattern,
  matchesElicitationPattern,
} from "../elicitation-pattern";

type CreateElicitationRequest = Parameters<AcpElicitationHandler>[0];
type CreateElicitationResponse = Awaited<ReturnType<AcpElicitationHandler>>;

const MAX_PENDING_PER_SESSION = 16;
const MAX_MESSAGE_LENGTH = 4_096;
const MAX_TITLE_LENGTH = 256;
const MAX_DESCRIPTION_LENGTH = 2_048;
const MAX_FIELD_NAME_LENGTH = 128;
const MAX_FIELD_COUNT = 32;
const MAX_OPTION_COUNT = 100;
const MAX_OPTION_VALUE_LENGTH = 512;
const MAX_PATTERN_LENGTH = 512;
const MAX_URL_LENGTH = 2_048;
const MAX_ACCEPTED_CONTENT_BYTES = 256 * 1024;
const MAX_ACCEPTED_STRING_LENGTH = 100_000;

export type ElicitationValue = AgentElicitationValue;
export type ElicitationResolution = AgentElicitationResponse;
export type ResolveElicitationInput = ResolveAgentElicitationInput;
export type PendingElicitationOptionSummary = AgentElicitationOption;
export type PendingElicitationFieldSummary = AgentElicitationField;
export type PendingElicitationSummary = PendingAgentElicitation;

export interface AgentElicitationManagerOptions {
  createRequestId?: () => string;
  now?: () => Date;
}

export class AgentElicitationError extends Error {
  constructor(
    readonly code:
      | "INVALID_REQUEST"
      | "INVALID_RESPONSE"
      | "NOT_PENDING"
      | "SESSION_MISMATCH"
      | "TOO_MANY_PENDING",
    message: string,
  ) {
    super(message);
    this.name = "AgentElicitationError";
  }
}

interface ValidatedField {
  summary: PendingElicitationFieldSummary;
  allowedValues: ReadonlySet<string> | null;
}

interface PendingElicitation {
  summary: PendingElicitationSummary;
  fields: ReadonlyMap<string, ValidatedField> | null;
  finish(response: CreateElicitationResponse): void;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function boundedString(
  value: unknown,
  label: string,
  maximum: number,
  options: { optional?: boolean } = {},
): string | null {
  if ((value === undefined || value === null) && options.optional) return null;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `${label} must be a non-empty string`,
    );
  }
  const normalized = value.trim();
  if (normalized.length > maximum) {
    throw new AgentElicitationError("INVALID_REQUEST", `${label} is too long`);
  }
  return normalized;
}

function optionalFiniteNumber(value: unknown, label: string): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `${label} must be a finite number`,
    );
  }
  return value;
}

function optionalCount(value: unknown, label: string): number | null {
  const count = optionalFiniteNumber(value, label);
  if (count !== null && (!Number.isInteger(count) || count < 0)) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `${label} must be a non-negative integer`,
    );
  }
  return count;
}

function assertAcpRequestId(value: unknown): void {
  if (typeof value === "string") {
    boundedString(value, "ACP request ID", MAX_FIELD_NAME_LENGTH);
    return;
  }
  if (typeof value === "number" && Number.isFinite(value)) return;
  throw new AgentElicitationError(
    "INVALID_REQUEST",
    "ACP request ID must be a string or number",
  );
}

function boundedOptionValue(value: unknown): string {
  if (typeof value !== "string" || value.length > MAX_OPTION_VALUE_LENGTH) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "Elicitation option values must be bounded strings",
    );
  }
  return value;
}

function optionSummaries(
  schema: Record<string, unknown>,
): PendingElicitationOptionSummary[] | null {
  const rawEnum = schema.enum;
  const rawOneOf = schema.oneOf;
  if (rawEnum != null && rawOneOf != null) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "An elicitation field cannot declare both enum and oneOf",
    );
  }

  let options: PendingElicitationOptionSummary[] | null = null;
  if (rawEnum != null) {
    if (!Array.isArray(rawEnum)) {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        "An elicitation enum must be an array",
      );
    }
    options = rawEnum.map((value) => {
      const text = boundedOptionValue(value);
      return { value: text, title: text, description: null };
    });
  } else if (rawOneOf != null) {
    if (!Array.isArray(rawOneOf)) {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        "An elicitation oneOf value must be an array",
      );
    }
    options = rawOneOf.map((rawOption) => {
      const option = record(rawOption);
      if (!option) {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          "An elicitation option must be an object",
        );
      }
      return {
        value: boundedOptionValue(option.const),
        title: boundedString(
          option.title,
          "Elicitation option title",
          MAX_TITLE_LENGTH,
        )!,
        description: boundedString(
          option.description,
          "Elicitation option description",
          MAX_DESCRIPTION_LENGTH,
          { optional: true },
        ),
      };
    });
  }

  if (options && options.length > MAX_OPTION_COUNT) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `An elicitation field can include at most ${MAX_OPTION_COUNT} options`,
    );
  }
  if (
    options &&
    new Set(options.map((option) => option.value)).size !== options.length
  ) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "Elicitation option values must be unique",
    );
  }
  return options;
}

function parseField(
  name: string,
  rawSchema: unknown,
  required: boolean,
): ValidatedField {
  boundedString(name, "Elicitation field name", MAX_FIELD_NAME_LENGTH);
  const schema = record(rawSchema);
  if (!schema) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `Elicitation field ${name} must be an object`,
    );
  }
  if (
    schema.type !== "string" &&
    schema.type !== "number" &&
    schema.type !== "integer" &&
    schema.type !== "boolean" &&
    schema.type !== "array"
  ) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `Elicitation field ${name} has an unsupported type`,
    );
  }

  const type = schema.type;
  const title = boundedString(
    schema.title,
    `Title for ${name}`,
    MAX_TITLE_LENGTH,
    { optional: true },
  );
  const description = boundedString(
    schema.description,
    `Description for ${name}`,
    MAX_DESCRIPTION_LENGTH,
    { optional: true },
  );
  let options: PendingElicitationOptionSummary[] | null = null;
  let minimum: number | null = null;
  let maximum: number | null = null;
  let minimumLength: number | null = null;
  let maximumLength: number | null = null;
  let format: PendingElicitationFieldSummary["format"] = null;
  let pattern: string | null = null;

  if (type === "string") {
    options = optionSummaries(schema);
    minimumLength = optionalCount(
      schema.minLength,
      `Minimum length for ${name}`,
    );
    maximumLength = optionalCount(
      schema.maxLength,
      `Maximum length for ${name}`,
    );
    if (schema.format != null) {
      if (
        schema.format !== "email" &&
        schema.format !== "uri" &&
        schema.format !== "date" &&
        schema.format !== "date-time"
      ) {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          `Format for ${name} is not supported`,
        );
      }
      format = schema.format;
    }
    if (schema.pattern != null) {
      pattern = boundedString(
        schema.pattern,
        `Pattern for ${name}`,
        MAX_PATTERN_LENGTH,
      );
      try {
        compileElicitationPattern(pattern!);
      } catch {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          `Pattern for ${name} is unsupported`,
        );
      }
    }
  } else if (type === "number" || type === "integer") {
    minimum = optionalFiniteNumber(schema.minimum, `Minimum for ${name}`);
    maximum = optionalFiniteNumber(schema.maximum, `Maximum for ${name}`);
  } else if (type === "array") {
    minimumLength = optionalCount(schema.minItems, `Minimum items for ${name}`);
    maximumLength = optionalCount(schema.maxItems, `Maximum items for ${name}`);
    const items = record(schema.items);
    if (!items) {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        `Items for ${name} must be an object`,
      );
    }
    if (items.anyOf != null) {
      options = optionSummaries({ oneOf: items.anyOf });
    } else {
      if (items.type !== "string") {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          `Items for ${name} must contain strings`,
        );
      }
      options = optionSummaries({ enum: items.enum });
    }
    if (!options) {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        `Items for ${name} must declare options`,
      );
    }
  }

  if (minimum !== null && maximum !== null && minimum > maximum) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `Minimum for ${name} cannot exceed its maximum`,
    );
  }
  if (
    minimumLength !== null &&
    maximumLength !== null &&
    minimumLength > maximumLength
  ) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `Minimum length for ${name} cannot exceed its maximum`,
    );
  }

  const summary: PendingElicitationFieldSummary = {
    name,
    type,
    title,
    description,
    required,
    defaultValue: null,
    options,
    format,
    minimum,
    maximum,
    minimumLength,
    maximumLength,
    pattern,
  };
  const field = {
    summary,
    allowedValues: options
      ? new Set(options.map((option) => option.value))
      : null,
  };
  if (schema.default !== undefined && schema.default !== null) {
    try {
      validateFieldValue(field, schema.default, `Default value for ${name}`);
    } catch {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        `Default value for ${name} does not match its field`,
      );
    }
    summary.defaultValue = schema.default as ElicitationValue;
  }
  return field;
}

function validateFormat(
  format: PendingElicitationFieldSummary["format"],
  value: string,
): boolean {
  if (!format) return true;
  if (format === "email") return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
  if (format === "uri") {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
  if (format === "date") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) && parsed.toISOString().startsWith(value)
    );
  }
  return !Number.isNaN(Date.parse(value));
}

function validateFieldValue(
  field: ValidatedField,
  value: unknown,
  label: string,
): asserts value is ElicitationValue {
  const { summary } = field;
  if (summary.type === "string") {
    if (
      typeof value !== "string" ||
      value.length > MAX_ACCEPTED_STRING_LENGTH
    ) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} must be text`,
      );
    }
    if (
      (summary.minimumLength !== null &&
        value.length < summary.minimumLength) ||
      (summary.maximumLength !== null && value.length > summary.maximumLength)
    ) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} does not satisfy its length constraints`,
      );
    }
    if (field.allowedValues && !field.allowedValues.has(value)) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} is not an available option`,
      );
    }
    if (!validateFormat(summary.format, value)) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} does not match its requested format`,
      );
    }
    if (summary.pattern && !matchesElicitationPattern(summary.pattern, value)) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} does not match its requested pattern`,
      );
    }
    return;
  }

  if (summary.type === "number" || summary.type === "integer") {
    if (
      typeof value !== "number" ||
      !Number.isFinite(value) ||
      (summary.type === "integer" && !Number.isInteger(value))
    ) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} must be a ${summary.type}`,
      );
    }
    if (
      (summary.minimum !== null && value < summary.minimum) ||
      (summary.maximum !== null && value > summary.maximum)
    ) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} is outside its allowed range`,
      );
    }
    return;
  }

  if (summary.type === "boolean") {
    if (typeof value !== "boolean") {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `${label} must be true or false`,
      );
    }
    return;
  }

  if (
    !Array.isArray(value) ||
    !value.every((item) => typeof item === "string") ||
    (summary.minimumLength !== null && value.length < summary.minimumLength) ||
    (summary.maximumLength !== null && value.length > summary.maximumLength) ||
    (field.allowedValues &&
      value.some((item) => !field.allowedValues!.has(item)))
  ) {
    throw new AgentElicitationError(
      "INVALID_RESPONSE",
      `${label} contains an invalid selection`,
    );
  }
}

function formSummary(
  requestId: string,
  sessionId: string,
  message: string,
  toolCallId: string | null,
  createdAt: string,
  rawSchema: unknown,
): { summary: PendingElicitationSummary; fields: Map<string, ValidatedField> } {
  const schema = record(rawSchema);
  if (!schema || (schema.type != null && schema.type !== "object")) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "The elicitation form schema must be an object",
    );
  }
  const properties = schema.properties == null ? {} : record(schema.properties);
  if (!properties) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "The elicitation form properties must be an object",
    );
  }
  const entries = Object.entries(properties);
  if (entries.length > MAX_FIELD_COUNT) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      `An elicitation form can include at most ${MAX_FIELD_COUNT} fields`,
    );
  }
  const requiredValues = schema.required ?? [];
  if (
    !Array.isArray(requiredValues) ||
    requiredValues.some((value) => typeof value !== "string")
  ) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "The elicitation required fields must be an array of names",
    );
  }
  const required = new Set(requiredValues as string[]);
  if (
    required.size !== requiredValues.length ||
    [...required].some((name) => !Object.hasOwn(properties, name))
  ) {
    throw new AgentElicitationError(
      "INVALID_REQUEST",
      "The elicitation required fields must be unique declared properties",
    );
  }

  const fields = new Map(
    entries.map(([name, field]) => [
      name,
      parseField(name, field, required.has(name)),
    ]),
  );
  return {
    summary: {
      requestId,
      sessionId,
      mode: "form",
      message,
      toolCallId,
      createdAt,
      title: boundedString(
        schema.title,
        "Elicitation title",
        MAX_TITLE_LENGTH,
        {
          optional: true,
        },
      ),
      description: boundedString(
        schema.description,
        "Elicitation description",
        MAX_DESCRIPTION_LENGTH,
        { optional: true },
      ),
      fields: [...fields.values()].map((field) => field.summary),
    },
    fields,
  };
}

function acceptedFormResponse(
  pending: PendingElicitation,
  content: Record<string, ElicitationValue> | null | undefined,
): CreateElicitationResponse {
  const fields = pending.fields!;
  const values = content ?? {};
  if (!record(values)) {
    throw new AgentElicitationError(
      "INVALID_RESPONSE",
      "Accepted elicitation content must be an object",
    );
  }
  let serialized: string;
  try {
    serialized = JSON.stringify(values);
  } catch {
    throw new AgentElicitationError(
      "INVALID_RESPONSE",
      "Accepted elicitation content must be serializable",
    );
  }
  if (Buffer.byteLength(serialized, "utf8") > MAX_ACCEPTED_CONTENT_BYTES) {
    throw new AgentElicitationError(
      "INVALID_RESPONSE",
      "Accepted elicitation content is too large",
    );
  }
  for (const name of Object.keys(values)) {
    if (!fields.has(name)) {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        `Accepted elicitation content includes unknown field ${name}`,
      );
    }
  }
  for (const [name, field] of fields) {
    const value = values[name];
    if (value === undefined) {
      if (field.summary.required) {
        throw new AgentElicitationError(
          "INVALID_RESPONSE",
          `Accepted elicitation content is missing ${name}`,
        );
      }
      continue;
    }
    validateFieldValue(field, value, name);
  }
  return Object.keys(values).length > 0
    ? { action: "accept", content: values }
    : { action: "accept" };
}

export class AgentElicitationManager {
  readonly #pending = new Map<string, PendingElicitation>();
  readonly #createRequestId: () => string;
  readonly #now: () => Date;

  constructor(options: AgentElicitationManagerOptions = {}) {
    this.#createRequestId = options.createRequestId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
  }

  handle(
    ownerSessionId: string,
    request: CreateElicitationRequest,
    signal: AbortSignal,
  ): Promise<CreateElicitationResponse> {
    boundedString(ownerSessionId, "Owner session ID", MAX_FIELD_NAME_LENGTH);
    if (signal.aborted) return Promise.resolve({ action: "cancel" });
    if (this.listPending(ownerSessionId).length >= MAX_PENDING_PER_SESSION) {
      throw new AgentElicitationError(
        "TOO_MANY_PENDING",
        "This session already has too many pending elicitation requests",
      );
    }

    const raw = request as unknown as Record<string, unknown>;
    const requestSessionId = raw.sessionId;
    const requestScopeId = raw.requestId;
    if (requestSessionId != null && requestScopeId != null) {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        "An elicitation cannot have both session and request scope",
      );
    }
    if (requestSessionId != null) {
      if (requestSessionId !== ownerSessionId) {
        throw new AgentElicitationError(
          "SESSION_MISMATCH",
          "The elicitation belongs to another session",
        );
      }
    } else {
      assertAcpRequestId(requestScopeId);
    }

    const message = boundedString(
      raw.message,
      "Elicitation message",
      MAX_MESSAGE_LENGTH,
    )!;
    const toolCallId = boundedString(
      raw.toolCallId,
      "Elicitation tool call ID",
      MAX_FIELD_NAME_LENGTH,
      { optional: true },
    );
    let requestId = "";
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const candidate = boundedString(
        this.#createRequestId(),
        "Local elicitation request ID",
        MAX_FIELD_NAME_LENGTH,
      )!;
      if (!this.#pending.has(candidate)) {
        requestId = candidate;
        break;
      }
    }
    if (!requestId) {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        "Radius could not allocate an elicitation request ID",
      );
    }

    const createdAt = this.#now().toISOString();
    let summary: PendingElicitationSummary;
    let fields: Map<string, ValidatedField> | null = null;
    if (raw.mode === "form") {
      const form = formSummary(
        requestId,
        ownerSessionId,
        message,
        toolCallId,
        createdAt,
        raw.requestedSchema,
      );
      summary = form.summary;
      fields = form.fields;
    } else if (raw.mode === "url") {
      const elicitationId = boundedString(
        raw.elicitationId,
        "ACP elicitation ID",
        MAX_FIELD_NAME_LENGTH,
      )!;
      if (
        [...this.#pending.values()].some(
          (pending) =>
            pending.summary.sessionId === ownerSessionId &&
            pending.summary.mode === "url" &&
            pending.summary.elicitationId === elicitationId,
        )
      ) {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          "That URL elicitation is already pending",
        );
      }
      const url = boundedString(raw.url, "Elicitation URL", MAX_URL_LENGTH)!;
      let parsed: URL;
      try {
        parsed = new URL(url);
      } catch {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          "The elicitation URL is invalid",
        );
      }
      if (
        (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
        parsed.username ||
        parsed.password
      ) {
        throw new AgentElicitationError(
          "INVALID_REQUEST",
          "The elicitation URL must be HTTP or HTTPS without credentials",
        );
      }
      summary = {
        requestId,
        sessionId: ownerSessionId,
        mode: "url",
        message,
        toolCallId,
        createdAt,
        elicitationId,
        url: parsed.toString(),
      };
    } else {
      throw new AgentElicitationError(
        "INVALID_REQUEST",
        "Radius does not support this elicitation mode",
      );
    }

    return new Promise<CreateElicitationResponse>((resolve) => {
      let settled = false;
      const finish = (response: CreateElicitationResponse): void => {
        if (settled) return;
        settled = true;
        signal.removeEventListener("abort", onAbort);
        this.#pending.delete(requestId);
        resolve(response);
      };
      const onAbort = (): void => finish({ action: "cancel" });
      this.#pending.set(requestId, { summary, fields, finish });
      signal.addEventListener("abort", onAbort, { once: true });
      if (signal.aborted) finish({ action: "cancel" });
    });
  }

  listPending(sessionId: string): PendingElicitationSummary[] {
    return [...this.#pending.values()]
      .filter((pending) => pending.summary.sessionId === sessionId)
      .map((pending) => structuredClone(pending.summary));
  }

  resolve(input: ResolveElicitationInput): void {
    if (!input || typeof input !== "object") {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        "The elicitation response is invalid",
      );
    }
    boundedString(
      input.sessionId,
      "Elicitation session ID",
      MAX_FIELD_NAME_LENGTH,
    );
    boundedString(
      input.requestId,
      "Elicitation request ID",
      MAX_FIELD_NAME_LENGTH,
    );
    const response = record(input.response);
    if (!response || typeof response.action !== "string") {
      throw new AgentElicitationError(
        "INVALID_RESPONSE",
        "The elicitation action is invalid",
      );
    }
    const pending = this.#pending.get(input.requestId);
    if (!pending || pending.summary.sessionId !== input.sessionId) {
      throw new AgentElicitationError(
        "NOT_PENDING",
        "The elicitation request is no longer pending for this session",
      );
    }
    if (response.action === "accept") {
      if (pending.summary.mode === "url") {
        if (response.content != null) {
          throw new AgentElicitationError(
            "INVALID_RESPONSE",
            "URL elicitations do not accept form content",
          );
        }
        pending.finish({ action: "accept" });
      } else {
        pending.finish(
          acceptedFormResponse(
            pending,
            response.content as
              Record<string, ElicitationValue> | null | undefined,
          ),
        );
      }
      return;
    }
    if (response.action === "decline") {
      if (response.content != null) {
        throw new AgentElicitationError(
          "INVALID_RESPONSE",
          "Declined elicitations cannot include content",
        );
      }
      pending.finish({ action: "decline" });
      return;
    }
    if (response.action === "cancel") {
      if (response.content != null) {
        throw new AgentElicitationError(
          "INVALID_RESPONSE",
          "Cancelled elicitations cannot include content",
        );
      }
      pending.finish({ action: "cancel" });
      return;
    }
    throw new AgentElicitationError(
      "INVALID_RESPONSE",
      "The elicitation action is invalid",
    );
  }

  completeUrl(sessionId: string, elicitationId: string): boolean {
    const pending = [...this.#pending.values()].find(
      (candidate) =>
        candidate.summary.sessionId === sessionId &&
        candidate.summary.mode === "url" &&
        candidate.summary.elicitationId === elicitationId,
    );
    if (!pending) return false;
    pending.finish({ action: "accept" });
    return true;
  }

  cancelSession(sessionId: string): number {
    const pending = [...this.#pending.values()].filter(
      (candidate) => candidate.summary.sessionId === sessionId,
    );
    for (const candidate of pending) candidate.finish({ action: "cancel" });
    return pending.length;
  }
}
