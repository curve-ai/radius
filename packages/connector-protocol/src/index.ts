import { z } from "zod";

export const CONNECTOR_PROFILE_PROTOCOL_VERSION = 1;
export const CONNECTOR_CATALOG_PROTOCOL_VERSION = 2;

const uuid = z.string().uuid();
const sha256 = z.string().regex(/^[a-f0-9]{64}$/);
const timestamp = z.string().datetime({ offset: true });
const nonempty = z.string().trim().min(1);
const positiveInteger = z.number().int().positive();

export const ConnectorTransportSchema = z.enum(["streamable_http"]);
export const ConnectorAuthenticationSchema = z.enum([
  "none",
  "oauth",
  "bearer",
]);
export const ConnectorCatalogCategorySchema = z.enum([
  "productivity",
  "developer_tools",
  "data",
  "finance",
  "communication",
  "other",
]);
export const ConnectorRequirementSchema = z.enum(["required", "optional"]);
export const AgentToolInterfaceDeclarationSchema = z.enum([
  "manifest",
  "runtime_discovery",
]);

export const CapabilityReferenceSchema = z.object({
  key: nonempty,
  operation: nonempty,
  contractVersion: positiveInteger,
  requirement: ConnectorRequirementSchema,
});

export const AgentToolInterfaceSchema = z.object({
  kind: z.literal("radius.mcp"),
  requirement: ConnectorRequirementSchema,
  declaration: AgentToolInterfaceDeclarationSchema,
  protocolVersions: z.array(nonempty).min(1),
});

export const ConnectorEndpointManifestSchema = z.object({
  key: nonempty,
  transport: ConnectorTransportSchema,
  url: z.string().url(),
  authentication: ConnectorAuthenticationSchema,
});

export const ConnectorCapabilityMappingSchema = z.object({
  endpointKey: nonempty,
  capability: CapabilityReferenceSchema.omit({ requirement: true }),
  nativeToolName: nonempty,
  inputSchemaSha256: sha256,
  outputSchemaSha256: sha256.nullable(),
});

export const ConnectorManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    publisherKey: nonempty,
    connectorKey: nonempty,
    displayName: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    version: nonempty,
    minimumHostVersion: nonempty,
    publishedAt: timestamp,
    endpoints: z.array(ConnectorEndpointManifestSchema).min(1),
    capabilityMappings: z.array(ConnectorCapabilityMappingSchema).min(1),
  })
  .superRefine((manifest, context) => {
    const endpointKeys = new Set(manifest.endpoints.map((item) => item.key));
    if (endpointKeys.size !== manifest.endpoints.length) {
      context.addIssue({
        code: "custom",
        path: ["endpoints"],
        message: "Connector endpoint keys must be unique",
      });
    }
    for (const [index, mapping] of manifest.capabilityMappings.entries()) {
      if (!endpointKeys.has(mapping.endpointKey)) {
        context.addIssue({
          code: "custom",
          path: ["capabilityMappings", index, "endpointKey"],
          message: "Capability mapping references an unknown endpoint",
        });
      }
    }
  });

const ProfileConnectorBaseSchema = z.object({
  id: uuid,
  connectorId: uuid,
  revision: positiveInteger,
  releaseSelectionMode: z.enum(["exact", "channel"]),
  releaseSelectionValue: nonempty,
  originClientInstanceId: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
});

const ProfileConnectionBaseSchema = z.object({
  id: uuid,
  profileConnectorId: uuid,
  revision: positiveInteger,
  endpointKey: nonempty,
  accountLabel: z.string().trim().min(1).max(120).nullable(),
  remoteSubject: z.string().trim().min(1).max(240).nullable(),
  originClientInstanceId: uuid,
  createdAt: timestamp,
  updatedAt: timestamp,
  deletedAt: timestamp.nullable(),
});

export const ProfileConnectorRecordSchema = ProfileConnectorBaseSchema;
export const ProfileConnectorConnectionRecordSchema =
  ProfileConnectionBaseSchema;

const CommonChangeShape = {
  protocolVersion: z.literal(CONNECTOR_PROFILE_PROTOCOL_VERSION),
  changeId: uuid,
  originClientInstanceId: uuid,
  payloadSchemaVersion: z.literal(1),
  payloadSha256: sha256,
  createdAt: timestamp,
};

export const ConnectorProfileChangeSchema = z.discriminatedUnion("kind", [
  z.object({
    ...CommonChangeShape,
    kind: z.literal("profile_connector.upsert"),
    profileConnectorId: uuid,
    revision: positiveInteger,
    payload: ProfileConnectorBaseSchema.refine(
      (value) => value.deletedAt === null,
      { message: "Upsert payload must not be deleted" },
    ),
  }),
  z.object({
    ...CommonChangeShape,
    kind: z.literal("profile_connector.delete"),
    profileConnectorId: uuid,
    revision: positiveInteger,
    payload: ProfileConnectorBaseSchema.refine(
      (value) => value.deletedAt !== null,
      { message: "Delete payload requires deletedAt" },
    ),
  }),
  z.object({
    ...CommonChangeShape,
    kind: z.literal("profile_connection.upsert"),
    profileConnectionId: uuid,
    revision: positiveInteger,
    payload: ProfileConnectionBaseSchema.refine(
      (value) => value.deletedAt === null,
      { message: "Upsert payload must not be deleted" },
    ),
  }),
  z.object({
    ...CommonChangeShape,
    kind: z.literal("profile_connection.delete"),
    profileConnectionId: uuid,
    revision: positiveInteger,
    payload: ProfileConnectionBaseSchema.refine(
      (value) => value.deletedAt !== null,
      { message: "Delete payload requires deletedAt" },
    ),
  }),
]);

export const ConnectorProfilePushRequestSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROFILE_PROTOCOL_VERSION),
  clientInstanceId: uuid,
  changes: z.array(ConnectorProfileChangeSchema).max(100),
});

export const ConnectorProfilePushResultSchema = z.object({
  changeId: uuid,
  status: z.enum(["accepted", "duplicate", "conflict", "rejected"]),
  errorCode: nonempty.nullable(),
});

export const ConnectorProfilePullResponseSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_PROFILE_PROTOCOL_VERSION),
  changes: z.array(ConnectorProfileChangeSchema).max(100),
  nextCursor: nonempty.nullable(),
});

export const ConnectorCatalogEntrySchema = z.object({
  id: uuid,
  source: z.literal("official_mcp_registry"),
  sourceServerName: nonempty,
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(1).max(500),
  category: ConnectorCatalogCategorySchema,
  version: nonempty,
  transport: z.enum(["streamable_http", "stdio"]),
  remoteUrl: z.string().url().nullable(),
  repositoryUrl: z.string().url().nullable(),
  websiteUrl: z.string().url().nullable(),
  domain: nonempty.nullable(),
  logoUrl: z.string().url().nullable(),
  publishedAt: timestamp.nullable(),
  updatedAt: timestamp,
});

export const ConnectorCatalogListResponseSchema = z.object({
  protocolVersion: z.literal(CONNECTOR_CATALOG_PROTOCOL_VERSION),
  connectors: z.array(ConnectorCatalogEntrySchema),
  nextCursor: nonempty.nullable(),
});

export const ConnectorLogoResolutionSchema = z.object({
  domain: nonempty,
  logoUrl: z.string().url().nullable(),
  state: z.enum(["ready", "queued", "unavailable"]),
});

export type AgentToolInterface = z.infer<typeof AgentToolInterfaceSchema>;
export type CapabilityReference = z.infer<typeof CapabilityReferenceSchema>;
export type ConnectorManifest = z.infer<typeof ConnectorManifestSchema>;
export type ConnectorProfileChange = z.infer<
  typeof ConnectorProfileChangeSchema
>;
export type ProfileConnectorRecord = z.infer<
  typeof ProfileConnectorRecordSchema
>;
export type ProfileConnectorConnectionRecord = z.infer<
  typeof ProfileConnectorConnectionRecordSchema
>;
export type ConnectorCatalogCategory = z.infer<
  typeof ConnectorCatalogCategorySchema
>;
export type ConnectorCatalogEntry = z.infer<typeof ConnectorCatalogEntrySchema>;
export type ConnectorCatalogListResponse = z.infer<
  typeof ConnectorCatalogListResponseSchema
>;
