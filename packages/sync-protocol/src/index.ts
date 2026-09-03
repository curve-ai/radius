import { z } from "zod";

export const SYNC_PROTOCOL_VERSION = 1 as const;
export const MAX_SYNC_BATCH_SIZE = 100;

const uuid = z.string().uuid();
const timestamp = z.string().datetime({ offset: true });
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const positiveInteger = z.number().int().positive();

export type JsonValue =
  null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const JsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.null(),
    z.boolean(),
    z.number(),
    z.string(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
);

export const SessionStatusSchema = z.enum([
  "active",
  "completed",
  "cancelled",
  "failed",
]);

export const ProjectRecordSchema = z.object({
  id: uuid,
  originClientInstanceId: uuid,
  name: z.string().trim().min(1),
  revision: positiveInteger,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
});

export const MessageRoleSchema = z.enum(["user", "assistant", "system"]);
export const MessageStatusSchema = z.enum(["completed", "cancelled", "failed"]);
export const MessageKindSchema = z.enum([
  "prompt",
  "progress",
  "final",
  "run_summary",
  "system_notice",
]);
export const AgentRunStateSchema = z.enum([
  "working",
  "waiting_for_approval",
  "waiting_for_user",
  "completed",
  "failed",
  "cancelled",
]);
export const AgentRunPresentationModeSchema = z.enum(["inline", "collapsible"]);
export const AgentRunInitialStateSchema = z.enum(["expanded", "collapsed"]);
export const FileChangeOperationSchema = z.enum([
  "create",
  "modify",
  "relocate",
  "delete",
]);

const RUN_REQUIRED_EVENT_TYPES = new Set([
  "agent_run",
  "agent_run_state_update",
  "agent_run_presentation",
  "tool_progress",
  "file_change",
]);

function messageKindMatchesRole(
  role: z.infer<typeof MessageRoleSchema>,
  kind: z.infer<typeof MessageKindSchema>,
): boolean {
  switch (role) {
    case "user":
      return kind === "prompt";
    case "assistant":
      return kind === "progress" || kind === "final" || kind === "run_summary";
    case "system":
      return kind === "system_notice";
  }
}
export const ReasoningSummaryKindSchema = z.enum([
  "analysis",
  "decision",
  "handoff",
]);
export const TaskStepStateSchema = z.enum([
  "pending",
  "in_progress",
  "completed",
  "blocked",
  "skipped",
]);
export const ToolOutcomeSchema = z.enum(["succeeded", "failed", "cancelled"]);
export const ApprovalDecisionSchema = z.enum([
  "approved",
  "denied",
  "cancelled",
  "expired",
]);

export const SessionRecordSchema = z.object({
  id: uuid,
  originClientInstanceId: uuid,
  projectId: uuid.nullable(),
  title: z.string().trim().min(1),
  status: SessionStatusSchema,
  revision: positiveInteger,
  createdAt: timestamp,
  updatedAt: timestamp,
  archivedAt: timestamp.nullable(),
  deletedAt: timestamp.nullable(),
});

const FileArtifactSchema = z.object({
  id: uuid,
  sessionId: uuid,
  name: z.string().trim().min(1),
  artifactType: z.enum([
    "document",
    "presentation",
    "image",
    "dataset",
    "archive",
    "other",
  ]),
  storageKind: z.literal("file"),
  mimeType: z.string().trim().min(1),
  contentSha256: sha256,
  byteSize: z.number().int().nonnegative(),
  supersedesArtifactId: uuid.nullable(),
  createdAt: timestamp,
  deletedAt: timestamp.nullable(),
});

const LinkArtifactSchema = z.object({
  id: uuid,
  sessionId: uuid,
  name: z.string().trim().min(1),
  artifactType: z.enum([
    "document",
    "presentation",
    "image",
    "dataset",
    "archive",
    "other",
  ]),
  storageKind: z.literal("link"),
  url: z.string().url(),
  provider: z.string().trim().min(1),
  externalId: z.string().trim().min(1).nullable(),
  supersedesArtifactId: uuid.nullable(),
  createdAt: timestamp,
  deletedAt: timestamp.nullable(),
});

export const ArtifactRecordSchema = z.discriminatedUnion("storageKind", [
  FileArtifactSchema,
  LinkArtifactSchema,
]);

export const EventArtifactLinkSchema = z.object({
  artifact: ArtifactRecordSchema,
  relationship: z.enum(["input", "output", "attachment", "preview"]),
});

const EventHeaderShape = {
  eventId: uuid,
  sessionId: uuid,
  sessionRevision: positiveInteger,
  sourceClientInstanceId: uuid,
  agentRunId: uuid.nullable(),
  occurredAt: timestamp,
  artifactLinks: z.array(EventArtifactLinkSchema),
};

const ProjectFileVersionSchema = z.object({
  id: uuid,
  relativePath: z
    .string()
    .trim()
    .min(1)
    .refine(
      (value) =>
        !value.startsWith("/") &&
        !value.includes("\\") &&
        value
          .split("/")
          .every(
            (segment) => segment !== "" && segment !== "." && segment !== "..",
          ),
      "File paths must be normalized project-relative POSIX paths",
    ),
  mimeType: z.string().trim().min(1),
  contentSha256: sha256,
  byteSize: z.number().int().nonnegative(),
  capturedAt: timestamp,
});

const MessagePartSchema = z.discriminatedUnion("partType", [
  z.object({
    id: uuid,
    position: z.number().int().nonnegative(),
    partType: z.literal("text"),
    text: z.string(),
  }),
  z.object({
    id: uuid,
    position: z.number().int().nonnegative(),
    partType: z.literal("artifact_reference"),
    artifactId: uuid,
  }),
]);

const MessageEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("message"),
  role: MessageRoleSchema,
  messageKind: MessageKindSchema,
  status: MessageStatusSchema,
  model: z.string().trim().min(1).nullable(),
  providerMessageId: z.string().trim().min(1).nullable(),
  finishReason: z.string().trim().min(1).nullable(),
  parts: z.array(MessagePartSchema).min(1),
});

const AgentRunEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("agent_run"),
  providerKey: z.string().trim().min(1),
  providerRunId: z.string().trim().min(1).nullable(),
  triggeringMessageEventId: uuid.nullable(),
});

const AgentRunStateUpdateEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("agent_run_state_update"),
  state: AgentRunStateSchema,
  detail: z.string().trim().min(1).nullable(),
});

const AgentRunPresentationEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("agent_run_presentation"),
  mode: AgentRunPresentationModeSchema,
  initialState: AgentRunInitialStateSchema.nullable(),
  summaryMessageEventId: uuid.nullable(),
  label: z.string().trim().min(1).max(80).nullable(),
});

const ReasoningSummaryEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("reasoning_summary"),
  summaryKind: ReasoningSummaryKindSchema,
  summaryText: z.string().trim().min(1),
});

const TaskPlanEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("task_plan"),
  planId: uuid,
  title: z.string().trim().min(1),
  supersedesPlanId: uuid.nullable(),
  steps: z
    .array(
      z.object({
        id: uuid,
        position: z.number().int().nonnegative(),
        title: z.string().trim().min(1),
      }),
    )
    .min(1),
});

const TaskStepUpdateEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("task_step_update"),
  taskStepId: uuid,
  state: TaskStepStateSchema,
  detail: z.string().trim().min(1).nullable(),
});

const ToolCallEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("tool_call"),
  triggeringMessageEventId: uuid.nullable(),
  capability: z.string().trim().min(1),
  operation: z.string().trim().min(1),
  inputSchemaId: z.string().trim().min(1),
  inputSchemaVersion: positiveInteger,
  input: JsonValueSchema,
});

const ToolResultEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("tool_result"),
  toolCallEventId: uuid,
  outcome: ToolOutcomeSchema,
  outputSchemaId: z.string().trim().min(1),
  outputSchemaVersion: positiveInteger,
  output: JsonValueSchema,
});

const ToolProgressEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("tool_progress"),
  toolCallEventId: uuid,
  progressSchemaId: z.string().trim().min(1),
  progressSchemaVersion: positiveInteger,
  progress: JsonValueSchema,
});

const FileChangeEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("file_change"),
  projectId: uuid,
  projectFileId: uuid,
  projectFileCreatedAt: timestamp,
  toolCallEventId: uuid.nullable(),
  operation: FileChangeOperationSchema,
  beforeVersion: ProjectFileVersionSchema.nullable(),
  afterVersion: ProjectFileVersionSchema.nullable(),
  textDiff: z
    .object({
      additions: z.number().int().nonnegative(),
      deletions: z.number().int().nonnegative(),
    })
    .nullable(),
});

const ApprovalRequestEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("approval_request"),
  toolCallEventId: uuid,
  reason: z.string().trim().min(1),
  expiresAt: timestamp.nullable(),
});

const ApprovalDecisionEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("approval_decision"),
  approvalRequestEventId: uuid,
  decision: ApprovalDecisionSchema,
  actorType: z.enum(["user", "organization_policy", "system"]),
  actorId: z.string().trim().min(1).nullable(),
  note: z.string().trim().min(1).nullable(),
});

const ErrorEventSchema = z.object({
  ...EventHeaderShape,
  eventType: z.literal("error"),
  code: z.string().trim().min(1),
  message: z.string().trim().min(1),
  retryable: z.boolean(),
  detailsSchemaId: z.string().trim().min(1).nullable(),
  details: JsonValueSchema.nullable(),
});

export const SessionEventRecordSchema = z
  .discriminatedUnion("eventType", [
    MessageEventSchema,
    AgentRunEventSchema,
    AgentRunStateUpdateEventSchema,
    AgentRunPresentationEventSchema,
    ReasoningSummaryEventSchema,
    TaskPlanEventSchema,
    TaskStepUpdateEventSchema,
    ToolCallEventSchema,
    ToolProgressEventSchema,
    ToolResultEventSchema,
    FileChangeEventSchema,
    ApprovalRequestEventSchema,
    ApprovalDecisionEventSchema,
    ErrorEventSchema,
  ])
  .superRefine((event, context) => {
    if (
      RUN_REQUIRED_EVENT_TYPES.has(event.eventType) &&
      event.agentRunId === null
    ) {
      context.addIssue({
        code: "custom",
        path: ["agentRunId"],
        message: `${event.eventType} events must belong to an agent run`,
      });
    }

    if (event.eventType === "message") {
      if (!messageKindMatchesRole(event.role, event.messageKind)) {
        context.addIssue({
          code: "custom",
          path: ["messageKind"],
          message: `Message kind ${event.messageKind} is invalid for role ${event.role}`,
        });
      }
    }

    if (event.eventType === "agent_run_presentation") {
      const stateMatchesMode =
        (event.mode === "inline" && event.initialState === null) ||
        (event.mode === "collapsible" && event.initialState !== null);
      if (!stateMatchesMode) {
        context.addIssue({
          code: "custom",
          path: ["initialState"],
          message:
            "Inline runs have no initial collapse state; collapsible runs require one",
        });
      }
    }

    if (event.eventType === "file_change") {
      const before = event.beforeVersion;
      const after = event.afterVersion;
      const versionsMatchOperation =
        (event.operation === "create" && before === null && after !== null) ||
        ((event.operation === "modify" || event.operation === "relocate") &&
          before !== null &&
          after !== null) ||
        (event.operation === "delete" && before !== null && after === null);
      if (!versionsMatchOperation) {
        context.addIssue({
          code: "custom",
          path: ["operation"],
          message: "File change versions do not match the operation",
        });
      }
      if (
        event.operation === "modify" &&
        before !== null &&
        after !== null &&
        before.relativePath !== after.relativePath
      ) {
        context.addIssue({
          code: "custom",
          path: ["afterVersion", "relativePath"],
          message: "Modify operations must retain the same relative path",
        });
      }
      if (
        event.operation === "relocate" &&
        before !== null &&
        after !== null &&
        before.relativePath === after.relativePath
      ) {
        context.addIssue({
          code: "custom",
          path: ["afterVersion", "relativePath"],
          message: "Relocate operations must change the relative path",
        });
      }
    }
  });

const CommonChangeEnvelopeShape = {
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  changeId: uuid,
  originClientInstanceId: uuid,
  payloadSchemaVersion: positiveInteger,
  payloadSha256: sha256,
  createdAt: timestamp,
};

const ProjectChangeEnvelopeShape = {
  ...CommonChangeEnvelopeShape,
  projectId: uuid,
  projectRevision: positiveInteger,
};

const SessionChangeEnvelopeShape = {
  ...CommonChangeEnvelopeShape,
  sessionId: uuid,
  sessionRevision: positiveInteger,
};

const ProjectUpsertChangeSchema = z.object({
  ...ProjectChangeEnvelopeShape,
  kind: z.literal("project.upsert"),
  payload: ProjectRecordSchema,
});

const ProjectDeleteChangeSchema = z.object({
  ...ProjectChangeEnvelopeShape,
  kind: z.literal("project.delete"),
  payload: ProjectRecordSchema.refine((project) => project.deletedAt !== null, {
    message: "A project.delete payload requires deletedAt",
  }),
});

const SessionUpsertChangeSchema = z.object({
  ...SessionChangeEnvelopeShape,
  kind: z.literal("session.upsert"),
  payload: SessionRecordSchema,
});

const SessionEventAppendChangeSchema = z.object({
  ...SessionChangeEnvelopeShape,
  kind: z.literal("session.event.append"),
  payload: SessionEventRecordSchema,
});

const SessionDeleteChangeSchema = z.object({
  ...SessionChangeEnvelopeShape,
  kind: z.literal("session.delete"),
  payload: SessionRecordSchema.refine((session) => session.deletedAt !== null, {
    message: "A session.delete payload requires deletedAt",
  }),
});

export const SyncChangeEnvelopeSchema = z
  .discriminatedUnion("kind", [
    ProjectUpsertChangeSchema,
    ProjectDeleteChangeSchema,
    SessionUpsertChangeSchema,
    SessionEventAppendChangeSchema,
    SessionDeleteChangeSchema,
  ])
  .superRefine((change, context) => {
    if (change.kind === "project.upsert" || change.kind === "project.delete") {
      const invariants = [
        {
          actual: change.payload.id,
          expected: change.projectId,
          path: ["payload", "id"],
          message: "Envelope and payload project identifiers must match",
        },
        {
          actual: change.payload.revision,
          expected: change.projectRevision,
          path: ["payload", "revision"],
          message: "Envelope and payload project revisions must match",
        },
        {
          actual: change.payload.originClientInstanceId,
          expected: change.originClientInstanceId,
          path: ["payload", "originClientInstanceId"],
          message: "Envelope and payload origin clients must match",
        },
      ];
      for (const invariant of invariants) {
        if (invariant.actual !== invariant.expected) {
          context.addIssue({
            code: "custom",
            path: invariant.path,
            message: invariant.message,
          });
        }
      }
      return;
    }

    const payload = change.payload;
    const payloadSessionId =
      "sessionId" in payload ? payload.sessionId : payload.id;
    const payloadRevision =
      "sessionRevision" in payload ? payload.sessionRevision : payload.revision;
    const payloadOriginClientInstanceId =
      "sourceClientInstanceId" in payload
        ? payload.sourceClientInstanceId
        : payload.originClientInstanceId;
    const invariants = [
      {
        actual: payloadSessionId,
        expected: change.sessionId,
        path: [
          "payload",
          change.kind === "session.event.append" ? "sessionId" : "id",
        ],
        message: "Envelope and payload session identifiers must match",
      },
      {
        actual: payloadRevision,
        expected: change.sessionRevision,
        path: [
          "payload",
          change.kind === "session.event.append"
            ? "sessionRevision"
            : "revision",
        ],
        message: "Envelope and payload session revisions must match",
      },
      {
        actual: payloadOriginClientInstanceId,
        expected: change.originClientInstanceId,
        path: [
          "payload",
          change.kind === "session.event.append"
            ? "sourceClientInstanceId"
            : "originClientInstanceId",
        ],
        message: "Envelope and payload origin clients must match",
      },
    ];
    for (const invariant of invariants) {
      if (invariant.actual !== invariant.expected) {
        context.addIssue({
          code: "custom",
          path: invariant.path,
          message: invariant.message,
        });
      }
    }
  });

export const PushRequestSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  clientInstanceId: uuid,
  changes: z.array(SyncChangeEnvelopeSchema).max(MAX_SYNC_BATCH_SIZE),
});

export const PushChangeResultSchema = z.object({
  changeId: uuid,
  status: z.enum(["accepted", "duplicate", "conflict", "rejected"]),
  errorCode: z.string().trim().min(1).nullable(),
});

export const PushResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  results: z.array(PushChangeResultSchema),
});

export const PullResponseSchema = z.object({
  protocolVersion: z.literal(SYNC_PROTOCOL_VERSION),
  changes: z.array(SyncChangeEnvelopeSchema).max(MAX_SYNC_BATCH_SIZE),
  nextCursor: z.string().min(1).nullable(),
});

export const ProviderCapabilitiesSchema = z.object({
  protocolVersions: z.array(z.literal(SYNC_PROTOCOL_VERSION)).min(1),
  maxBatchSize: z.number().int().min(1).max(MAX_SYNC_BATCH_SIZE),
  artifactTransfer: z.boolean(),
});

/**
 * What a device sends to enrol itself before it may push.
 *
 * The public key is the device half of the signature on every later request,
 * so a server stores it and verifies against it rather than trusting the
 * client instance id alone.
 */
export const DeviceRegistrationSchema = z.object({
  clientInstanceId: uuid,
  displayName: z.string().trim().min(1).max(120),
  platform: z.string().trim().min(1).max(40),
  publicKeyJwk: z.object({
    kty: z.literal("OKP"),
    crv: z.literal("Ed25519"),
    x: z.string().min(1),
  }),
  appVersion: z.string().trim().min(1).max(40),
});

export type SessionRecord = z.infer<typeof SessionRecordSchema>;
export type ProjectRecord = z.infer<typeof ProjectRecordSchema>;
export type ArtifactRecord = z.infer<typeof ArtifactRecordSchema>;
export type EventArtifactLink = z.infer<typeof EventArtifactLinkSchema>;
export type SessionEventRecord = z.infer<typeof SessionEventRecordSchema>;
export type SyncChangeEnvelope = z.infer<typeof SyncChangeEnvelopeSchema>;
export type PushRequest = z.infer<typeof PushRequestSchema>;
export type PushChangeResult = z.infer<typeof PushChangeResultSchema>;
export type PushResponse = z.infer<typeof PushResponseSchema>;
export type PullResponse = z.infer<typeof PullResponseSchema>;
export type ProviderCapabilities = z.infer<typeof ProviderCapabilitiesSchema>;
export type DeviceRegistration = z.infer<
  typeof DeviceRegistrationSchema
>;
