import type {
  AgentElicitationField,
  AgentElicitationValue,
  PendingAgentElicitation,
} from "../../../../radius-api";
import { matchesElicitationPattern } from "../../../../elicitation-pattern";

export type FormElicitation = Extract<
  PendingAgentElicitation,
  { mode: "form" }
>;
export type ElicitationDraftValue = string | boolean | string[] | null;
export type AgentElicitationDraft = Record<string, ElicitationDraftValue>;

export interface AgentElicitationDraftValidation {
  content: Record<string, AgentElicitationValue> | null;
  errors: Record<string, string>;
}

export function agentElicitationFieldLabel(
  field: AgentElicitationField,
): string {
  return field.title ?? field.name;
}

export function createAgentElicitationDraft(
  request: FormElicitation,
): AgentElicitationDraft {
  return Object.fromEntries(
    request.fields.map((field) => {
      if (field.type === "boolean") {
        return [
          field.name,
          typeof field.defaultValue === "boolean"
            ? field.defaultValue
            : field.required
              ? false
              : null,
        ];
      }
      if (field.type === "array") {
        return [
          field.name,
          Array.isArray(field.defaultValue) ? [...field.defaultValue] : [],
        ];
      }
      return [
        field.name,
        field.defaultValue === null ? "" : String(field.defaultValue),
      ];
    }),
  );
}

function validFormat(
  format: AgentElicitationField["format"],
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

export function validateAgentElicitationDraft(
  request: FormElicitation,
  draft: AgentElicitationDraft,
): AgentElicitationDraftValidation {
  const content: Record<string, AgentElicitationValue> = {};
  const errors: Record<string, string> = {};

  for (const field of request.fields) {
    const label = agentElicitationFieldLabel(field);
    const raw = draft[field.name];
    if (field.type === "boolean") {
      if (raw === null && !field.required) continue;
      if (typeof raw !== "boolean") errors[field.name] = `${label} is invalid.`;
      else content[field.name] = raw;
      continue;
    }
    if (field.type === "array") {
      const values = Array.isArray(raw) ? raw : [];
      if (field.required && values.length === 0) {
        errors[field.name] = `Choose at least one option for ${label}.`;
        continue;
      }
      if (
        (field.minimumLength !== null && values.length < field.minimumLength) ||
        (field.maximumLength !== null && values.length > field.maximumLength)
      ) {
        errors[field.name] = `${label} has the wrong number of selections.`;
        continue;
      }
      const allowed = new Set(
        field.options?.map((option) => option.value) ?? [],
      );
      if (values.some((value) => !allowed.has(value))) {
        errors[field.name] = `${label} contains an unavailable option.`;
        continue;
      }
      if (values.length > 0) content[field.name] = values;
      continue;
    }

    const value = typeof raw === "string" ? raw : "";
    if (value.trim().length === 0) {
      if (field.required) errors[field.name] = `${label} is required.`;
      continue;
    }
    if (field.type === "number" || field.type === "integer") {
      const parsed = Number(value);
      if (
        !Number.isFinite(parsed) ||
        (field.type === "integer" && !Number.isInteger(parsed))
      ) {
        errors[field.name] = `${label} must be a valid ${field.type}.`;
      } else if (
        (field.minimum !== null && parsed < field.minimum) ||
        (field.maximum !== null && parsed > field.maximum)
      ) {
        errors[field.name] = `${label} is outside the allowed range.`;
      } else {
        content[field.name] = parsed;
      }
      continue;
    }

    if (
      (field.minimumLength !== null && value.length < field.minimumLength) ||
      (field.maximumLength !== null && value.length > field.maximumLength)
    ) {
      errors[field.name] = `${label} does not meet the length requirement.`;
      continue;
    }
    if (
      field.options &&
      !field.options.some((option) => option.value === value)
    ) {
      errors[field.name] = `${label} is not an available option.`;
      continue;
    }
    if (!validFormat(field.format, value)) {
      errors[field.name] = `${label} does not match the requested format.`;
      continue;
    }
    if (field.pattern && !matchesElicitationPattern(field.pattern, value)) {
      errors[field.name] = `${label} does not match the requested pattern.`;
      continue;
    }
    content[field.name] = value;
  }

  return {
    content: Object.keys(errors).length === 0 ? content : null,
    errors,
  };
}
