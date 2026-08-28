import { createHash, randomUUID } from "node:crypto";

import {
  PlatformApiError,
  type PlatformRequestIdentity,
  type RadiusPlatformServices,
} from "./app.js";

import type {
  AgentEnvironmentChangeResponse,
  FinalizeAgentDeploymentRequest,
  FinalizeAgentDeploymentResponse,
  ListAgentEnvironmentHistoryResponse,
  ListAgentDeploymentsResponse,
  PrepareAgentDeploymentRequest,
  PrepareAgentDeploymentResponse,
  PromoteAgentDeploymentRequest,
  RollbackAgentDeploymentRequest,
} from "@curve-ai/platform-contracts";
import {
  createPlatformRegistryVerifier,
  type PlatformRegistryFetch,
} from "./registry-verifier.js";

interface PendingUpload {
  accountId: string;
  request: PrepareAgentDeploymentRequest;
  response: PrepareAgentDeploymentResponse;
  requestHash: string;
}

export interface DevelopmentPlatformOptions {
  accessToken: string;
  registry?: string;
  registryVerification?: string;
  allowInsecureRegistryVerification?: boolean;
  registryUsername?: string;
  registryPassword?: string;
  fetch?: PlatformRegistryFetch;
  now?: () => Date;
}

export function createDevelopmentPlatformServices(
  options: DevelopmentPlatformOptions,
): RadiusPlatformServices {
  const accessToken = options.accessToken.trim();
  if (!accessToken) throw new Error("Development Platform token is required");
  const registry = options.registry ?? "127.0.0.1:5001";
  const registryVerification = options.registryVerification ?? registry;
  const registryUsername = options.registryUsername ?? "radius-dev";
  const registryPassword = options.registryPassword ?? "radius-dev-only";
  const registryVerifier = createPlatformRegistryVerifier({
    registry,
    registryVerification,
    allowInsecureRegistryVerification:
      options.allowInsecureRegistryVerification ?? false,
    username: registryUsername,
    password: registryPassword,
    fetch: options.fetch,
  });
  const now = options.now ?? (() => new Date());
  const accountId = "11111111-1111-4111-8111-111111111111";
  const organizationId = "22222222-2222-4222-8222-222222222222";
  const identity: PlatformRequestIdentity = {
    accountId,
    response: {
      apiVersion: 1,
      accountId,
      organizations: [
        {
          id: organizationId,
          slug: "dev",
          displayName: "Radius Development",
          role: "owner",
        },
      ],
    },
  };
  const agents = new Map<string, { name: string }>([
    ["agent_example1", { name: "TypeScript Example Agent" }],
  ]);
  const uploadsById = new Map<string, PendingUpload>();
  const preparedByIdempotency = new Map<string, PendingUpload>();
  const finalizedByIdempotency = new Map<
    string,
    { requestHash: string; response: FinalizeAgentDeploymentResponse }
  >();
  const deploymentChangesByIdempotency = new Map<
    string,
    { requestHash: string; response: AgentEnvironmentChangeResponse }
  >();
  const agentDeployments = new Map<string, DevelopmentAgentDeployment>();
  const deploymentRevisions = new Map<string, number>();
  const deployments = new Map<
    string,
    {
      revision: number;
      agentDeploymentId: string;
      agentDeploymentVersion: string;
      imageDigest: string;
      state: "verified";
    }
  >();
  const deploymentEvents = new Map<string, DevelopmentDeploymentRevision[]>();
  const deploymentState: DevelopmentDeploymentState = {
    agentDeployments,
    deployments,
    revisions: deploymentRevisions,
    events: deploymentEvents,
    idempotency: deploymentChangesByIdempotency,
    now,
  };
  const physicalDevices = new Map<string, DevelopmentPhysicalDevice>();
  const clientInstallations = new Map<string, DevelopmentClientInstallation>();
  const clientInstallationByInstance = new Map<string, string>();
  const agentInstallations = new Map<string, DevelopmentAgentInstallation>();
  let deploymentSequence = 0;

  return {
    authenticate: async (candidate) =>
      candidate === accessToken ? identity : null,
    authenticateBrowserSession: async () => null,

    listOrganizationMemberships: async ({ organization }) => ({
      apiVersion: 1,
      organization,
      memberships: [
        {
          id: "33333333-3333-4333-8333-333333333333",
          accountId,
          displayName: "Radius Developer",
          email: null,
          role: "owner",
          lifecycleState: "active",
          joinedAt: "2026-08-26T00:00:00.000Z",
          updatedAt: "2026-08-26T00:00:00.000Z",
          developerTokenCount: 0,
          current: true,
        },
      ],
    }),

    updateOrganizationMembership: async () => {
      throw new PlatformApiError(
        503,
        "NOT_CONFIGURED",
        "Organization membership writes require PostgreSQL",
      );
    },

    listDeveloperTokens: async ({ organization }) => ({
      apiVersion: 1,
      organization,
      tokens: [],
    }),

    createDeveloperToken: async () => {
      throw new PlatformApiError(
        503,
        "NOT_CONFIGURED",
        "Developer-token writes require PostgreSQL",
      );
    },

    revokeDeveloperToken: async () => {
      throw new PlatformApiError(
        503,
        "NOT_CONFIGURED",
        "Developer-token writes require PostgreSQL",
      );
    },

    listAgents: async ({ identity: requestIdentity, organization }) => {
      if (
        requestIdentity.accountId !== accountId ||
        !requestIdentity.response.organizations.some(
          (candidate) => candidate.slug === organization,
        )
      ) {
        throw new PlatformApiError(
          404,
          "ORGANIZATION_NOT_FOUND",
          "Organization not found",
        );
      }
      const environmentNames = ["development", "staging", "production"];
      return {
        apiVersion: 1,
        organization,
        agents: [...agents.entries()].map(([agent, metadata]) => ({
          agent,
          name: metadata.name,
          environments: environmentNames.map((name) => ({
            name,
            deployment: publicDeployment(deployments.get(`${agent}:${name}`)),
          })),
        })),
      };
    },

    listAgentDeployments: async ({
      identity: requestIdentity,
      agent,
      limit,
      cursor,
    }): Promise<ListAgentDeploymentsResponse> => {
      assertDevelopmentProjectAccess(requestIdentity, accountId, agent, agents);
      const page = paginate(
        [...agentDeployments.entries()]
          .filter(([, agentDeployment]) => agentDeployment.agent === agent)
          .reverse()
          .map(([id, agentDeployment]) => ({ id, ...agentDeployment })),
        limit,
        cursor,
        (agentDeployment) => agentDeployment.id,
      );
      return {
        apiVersion: 1,
        agent,
        agentDeployments: page.items,
        nextCursor: page.nextCursor,
      };
    },

    listAgentEnvironmentHistory: async ({
      identity: requestIdentity,
      agent,
      environment,
      limit,
      cursor,
    }): Promise<ListAgentEnvironmentHistoryResponse> => {
      assertDevelopmentProjectAccess(requestIdentity, accountId, agent, agents);
      const key = `${agent}:${environment}`;
      const page = paginate(
        [...(deploymentEvents.get(key) ?? [])].reverse(),
        limit,
        cursor,
        (revision) => String(revision.revision),
      );
      return {
        apiVersion: 1,
        agent,
        environment,
        currentRevision: deploymentRevisions.get(key) ?? 0,
        revisions: page.items,
        nextCursor: page.nextCursor,
      };
    },

    prepareAgentDeployment: async ({
      identity: requestIdentity,
      request,
      idempotencyKey,
    }) => {
      if (
        !requestIdentity.response.organizations.some(
          (organization) => organization.slug === request.organization,
        )
      ) {
        throw new PlatformApiError(
          404,
          "ORGANIZATION_NOT_FOUND",
          "Organization not found",
        );
      }
      const requestHash = hashJson(request);
      const existing = preparedByIdempotency.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new PlatformApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for different deployment input",
          );
        }
        return existing.response;
      }
      agents.set(request.agent, { name: request.manifest.name });
      const uploadId = randomUUID();
      const tag = uploadId.replaceAll("-", "");
      const response: PrepareAgentDeploymentResponse = {
        apiVersion: 1,
        uploadId,
        imageReference: `${registry}/${request.agent}/agent:${tag}`,
        credentials: {
          registry,
          username: registryUsername,
          password: registryPassword,
          expiresAt: new Date(now().getTime() + 15 * 60_000).toISOString(),
        },
      };
      const upload = {
        accountId: requestIdentity.accountId,
        request,
        response,
        requestHash,
      };
      uploadsById.set(uploadId, upload);
      preparedByIdempotency.set(idempotencyKey, upload);
      return response;
    },

    finalizeAgentDeployment: async ({
      identity: requestIdentity,
      agent,
      request,
      idempotencyKey,
    }) => {
      const requestHash = hashJson({ agent, request });
      const existing = finalizedByIdempotency.get(idempotencyKey);
      if (existing) {
        if (existing.requestHash !== requestHash) {
          throw new PlatformApiError(
            409,
            "IDEMPOTENCY_CONFLICT",
            "Idempotency key was already used for different finalization input",
          );
        }
        return existing.response;
      }
      const upload = uploadsById.get(request.uploadId);
      if (
        !upload ||
        upload.accountId !== requestIdentity.accountId ||
        upload.request.agent !== agent ||
        upload.request.organization !== request.organization
      ) {
        throw new PlatformApiError(
          404,
          "UPLOAD_NOT_FOUND",
          "Agent deployment upload not found",
        );
      }
      if (upload.request.bundleSha256 !== request.bundleSha256) {
        throw new PlatformApiError(
          409,
          "BUNDLE_DIGEST_MISMATCH",
          "Finalized bundle does not match the prepared deployment",
        );
      }
      await registryVerifier.verifyManifest({
        imageReference: upload.response.imageReference,
        expectedDigest: request.imageDigest as `sha256:${string}`,
      });

      deploymentSequence += 1;
      const agentDeploymentId = randomUUID();
      let environmentRevision: FinalizeAgentDeploymentResponse["environmentRevision"] =
        null;
      if (request.promote) {
        const key = `${agent}:${upload.request.environment}`;
        const currentRevision = deploymentRevisions.get(key) ?? 0;
        if (
          currentRevision > 0 &&
          request.expectedDeploymentRevision === null
        ) {
          throw new PlatformApiError(
            409,
            "DEPLOYMENT_REVISION_REQUIRED",
            "Existing deployment requires an expected revision",
          );
        }
        if (
          request.expectedDeploymentRevision !== null &&
          request.expectedDeploymentRevision !== currentRevision
        ) {
          throw new PlatformApiError(
            409,
            "DEPLOYMENT_REVISION_CONFLICT",
            "Deployment revision changed before promotion",
          );
        }
        const revision = currentRevision + 1;
        deploymentRevisions.set(key, revision);
        environmentRevision = {
          environment: upload.request.environment,
          revision,
          agentDeploymentId,
        };
      }
      const finalizedAt = now().toISOString();
      const date = finalizedAt.slice(0, 10).replaceAll("-", "");
      const response: FinalizeAgentDeploymentResponse = {
        apiVersion: 1,
        agentDeployment: {
          id: agentDeploymentId,
          version: `${date}.${deploymentSequence}`,
          imageDigest: request.imageDigest,
          state: "verified",
        },
        environmentRevision,
      };
      agentDeployments.set(agentDeploymentId, {
        agent,
        version: response.agentDeployment.version,
        imageDigest: response.agentDeployment.imageDigest,
        sourceManifestDigest: request.sourceManifestDigest,
        sbomDigest: request.sbomDigest,
        provenanceDigest: request.provenanceDigest,
        minimumDesktopVersion: upload.request.manifest.minimumDesktopVersion,
        runtimeProtocolVersion: upload.request.manifest.protocol.version,
        state: "verified",
        createdAt: finalizedAt,
      });
      if (environmentRevision) {
        const deploymentKey = `${agent}:${environmentRevision.environment}`;
        const previousDeployment = deployments.get(deploymentKey);
        deployments.set(deploymentKey, {
          revision: environmentRevision.revision,
          agentDeploymentId,
          agentDeploymentVersion: response.agentDeployment.version,
          imageDigest: response.agentDeployment.imageDigest,
          state: "verified",
        });
        appendDeploymentEvent(deploymentEvents, deploymentKey, {
          revision: environmentRevision.revision,
          action: "deploy",
          agentDeploymentId,
          agentDeploymentVersion: response.agentDeployment.version,
          imageDigest: response.agentDeployment.imageDigest,
          previousAgentDeploymentId:
            previousDeployment?.agentDeploymentId ?? null,
          createdAt: finalizedAt,
        });
      }
      finalizedByIdempotency.set(idempotencyKey, { requestHash, response });
      return response;
    },

    promoteAgentDeployment: async ({
      identity: requestIdentity,
      agent,
      environment,
      request,
      idempotencyKey,
    }) =>
      changeDeployment({
        accountId: requestIdentity.accountId,
        action: "promote",
        agent,
        environment,
        request,
        idempotencyKey,
        state: deploymentState,
      }),

    rollbackAgentDeployment: async ({
      identity: requestIdentity,
      agent,
      environment,
      request,
      idempotencyKey,
    }) =>
      changeDeployment({
        accountId: requestIdentity.accountId,
        action: "rollback",
        agent,
        environment,
        request,
        idempotencyKey,
        state: deploymentState,
      }),

    registerClientInstallation: async ({
      identity: requestIdentity,
      request,
    }) => {
      if (
        requestIdentity.accountId !== accountId ||
        request.organization !== "dev"
      ) {
        throw new PlatformApiError(
          404,
          "ORGANIZATION_NOT_FOUND",
          "Organization not found",
        );
      }
      let device = physicalDevices.get(request.physicalDevice.fingerprint);
      if (!device) {
        device = {
          id: randomUUID(),
          displayName: request.physicalDevice.displayName,
          assetTag: request.physicalDevice.assetTag,
          platform: request.physicalDevice.platform,
          architecture: request.physicalDevice.architecture,
          lifecycleState: "active",
          clientInstallationIds: [],
        };
        physicalDevices.set(request.physicalDevice.fingerprint, device);
      }
      const existingId = clientInstallationByInstance.get(
        request.clientInstanceId,
      );
      const clientInstallationId = existingId ?? randomUUID();
      const existing = clientInstallations.get(clientInstallationId);
      const installation: DevelopmentClientInstallation = existing ?? {
        id: clientInstallationId,
        clientInstanceId: request.clientInstanceId,
        lifecycleState: "active",
        observations: [],
        agentInstallationIds: [],
      };
      if (
        !installation.observations.some(
          (observation) =>
            observation.clientEventId === request.observation.clientEventId,
        )
      ) {
        installation.observations.push({
          ...request.observation,
          errorCode: request.observation.errorCode,
        });
      }
      clientInstallations.set(clientInstallationId, installation);
      clientInstallationByInstance.set(
        request.clientInstanceId,
        clientInstallationId,
      );
      if (!device.clientInstallationIds.includes(clientInstallationId)) {
        device.clientInstallationIds.push(clientInstallationId);
      }
      return {
        apiVersion: 1,
        physicalDeviceId: device.id,
        clientInstallationId,
      };
    },

    reportAgentInstallation: async ({
      clientInstallationId,
      agent,
      request,
    }) => {
      const clientInstallation = clientInstallations.get(clientInstallationId);
      const deployment = agentDeployments.get(request.agentDeploymentId);
      if (!clientInstallation) {
        throw new PlatformApiError(
          404,
          "CLIENT_INSTALLATION_NOT_FOUND",
          "Client installation not found",
        );
      }
      if (!deployment || deployment.agent !== agent) {
        throw new PlatformApiError(
          404,
          "AGENT_DEPLOYMENT_NOT_FOUND",
          "Agent deployment not found",
        );
      }
      const key = `${clientInstallationId}:${agent}`;
      let installation = agentInstallations.get(key);
      if (!installation) {
        installation = {
          id: randomUUID(),
          agent,
          lifecycleState: "active",
          observations: [],
        };
        agentInstallations.set(key, installation);
        clientInstallation.agentInstallationIds.push(installation.id);
      }
      let observation = installation.observations.find(
        (candidate) => candidate.clientEventId === request.clientEventId,
      );
      if (!observation) {
        observation = {
          id: randomUUID(),
          ...request,
        };
        installation.observations.push(observation);
      }
      return {
        apiVersion: 1,
        agentInstallationId: installation.id,
        observationId: observation.id,
      };
    },

    listInstallations: async ({ organization }) => {
      if (organization !== "dev") {
        throw new PlatformApiError(
          404,
          "ORGANIZATION_NOT_FOUND",
          "Organization not found",
        );
      }
      return {
        apiVersion: 1,
        organization,
        physicalDevices: [...physicalDevices.values()].map((device) => ({
          id: device.id,
          displayName: device.displayName,
          assetTag: device.assetTag,
          platform: device.platform,
          architecture: device.architecture,
          lifecycleState: device.lifecycleState,
          clientInstallations: device.clientInstallationIds.map((id) => {
            const installation = clientInstallations.get(id)!;
            const latest = installation.observations.at(-1) ?? null;
            return {
              id: installation.id,
              clientInstanceId: installation.clientInstanceId,
              lifecycleState: installation.lifecycleState,
              latestObservation: latest
                ? {
                    desktopVersion: latest.desktopVersion,
                    runtimeVersion: latest.runtimeVersion,
                    runtimeProtocolVersion: latest.runtimeProtocolVersion,
                    state: latest.state,
                    errorCode: latest.errorCode,
                    observedAt: latest.observedAt,
                  }
                : null,
              agentInstallations: [...agentInstallations.values()]
                .filter((candidate) =>
                  installation.agentInstallationIds.includes(candidate.id),
                )
                .map((candidate) => {
                  const observation = candidate.observations.at(-1) ?? null;
                  const deployment = observation
                    ? agentDeployments.get(observation.agentDeploymentId)
                    : null;
                  return {
                    id: candidate.id,
                    agent: candidate.agent,
                    lifecycleState: candidate.lifecycleState,
                    latestObservation:
                      observation && deployment
                        ? {
                            agentDeploymentId: observation.agentDeploymentId,
                            agentDeploymentVersion: deployment.version,
                            state: observation.state,
                            errorCode: observation.errorCode,
                            observedAt: observation.observedAt,
                          }
                        : null,
                  };
                }),
            };
          }),
        })),
      };
    },
  };
}

interface DevelopmentPhysicalDevice {
  id: string;
  displayName: string;
  assetTag: string | null;
  platform: string;
  architecture: string;
  lifecycleState: "active";
  clientInstallationIds: string[];
}

interface DevelopmentClientInstallation {
  id: string;
  clientInstanceId: string;
  lifecycleState: "active";
  observations: Array<{
    clientEventId: string;
    schemaVersion: 1;
    desktopVersion: string;
    runtimeVersion: string;
    runtimeProtocolVersion: number;
    state: "ready" | "degraded" | "update_required" | "error";
    errorCode: string | null;
    observedAt: string;
  }>;
  agentInstallationIds: string[];
}

interface DevelopmentAgentInstallation {
  id: string;
  agent: string;
  lifecycleState: "active";
  observations: Array<{
    id: string;
    agentDeploymentId: string;
    clientEventId: string;
    schemaVersion: 1;
    state:
      | "installing"
      | "ready"
      | "failed"
      | "retained"
      | "removed"
      | "blocked_incompatible";
    errorCode: string | null;
    observedAt: string;
  }>;
}

interface DevelopmentAgentDeployment {
  agent: string;
  version: string;
  imageDigest: string;
  sourceManifestDigest: string;
  sbomDigest: string | null;
  provenanceDigest: string | null;
  minimumDesktopVersion: string;
  runtimeProtocolVersion: number;
  state: "verified";
  createdAt: string;
}

interface DevelopmentEnvironmentDeployment {
  revision: number;
  agentDeploymentId: string;
  agentDeploymentVersion: string;
  imageDigest: string;
  state: "verified";
}

interface DevelopmentDeploymentRevision {
  revision: number;
  action: "deploy" | "promote" | "rollback" | "revoke";
  agentDeploymentId: string | null;
  agentDeploymentVersion: string | null;
  imageDigest: string | null;
  previousAgentDeploymentId: string | null;
  createdAt: string;
}

interface DevelopmentDeploymentState {
  agentDeployments: Map<string, DevelopmentAgentDeployment>;
  deployments: Map<string, DevelopmentEnvironmentDeployment>;
  revisions: Map<string, number>;
  events: Map<string, DevelopmentDeploymentRevision[]>;
  idempotency: Map<
    string,
    { requestHash: string; response: AgentEnvironmentChangeResponse }
  >;
  now: () => Date;
}

function publicDeployment(
  deployment: DevelopmentEnvironmentDeployment | undefined,
) {
  if (!deployment) return null;
  return {
    revision: deployment.revision,
    agentDeploymentVersion: deployment.agentDeploymentVersion,
    imageDigest: deployment.imageDigest,
    state: deployment.state,
  };
}

function changeDeployment(options: {
  accountId: string;
  action: "promote" | "rollback";
  agent: string;
  environment: string;
  request: PromoteAgentDeploymentRequest | RollbackAgentDeploymentRequest;
  idempotencyKey: string;
  state: DevelopmentDeploymentState;
}): AgentEnvironmentChangeResponse {
  const requestHash = hashJson({
    accountId: options.accountId,
    action: options.action,
    agent: options.agent,
    environment: options.environment,
    request: options.request,
  });
  const existing = options.state.idempotency.get(options.idempotencyKey);
  if (existing) {
    if (existing.requestHash !== requestHash) {
      throw new PlatformApiError(
        409,
        "IDEMPOTENCY_CONFLICT",
        "Idempotency key was already used for a different deployment change",
      );
    }
    return existing.response;
  }

  const agentDeployment = options.state.agentDeployments.get(
    options.request.agentDeploymentId,
  );
  if (!agentDeployment || agentDeployment.agent !== options.agent) {
    throw new PlatformApiError(
      404,
      "AGENT_DEPLOYMENT_NOT_FOUND",
      "Agent deployment not found",
    );
  }
  if (agentDeployment.state !== "verified") {
    throw new PlatformApiError(
      409,
      "AGENT_DEPLOYMENT_NOT_VERIFIED",
      "Agent deployment is not verified",
    );
  }

  const key = `${options.agent}:${options.environment}`;
  const current = options.state.deployments.get(key);
  const currentRevision = options.state.revisions.get(key) ?? 0;
  if (
    currentRevision > 0 &&
    options.request.expectedDeploymentRevision !== currentRevision
  ) {
    throw new PlatformApiError(
      409,
      options.request.expectedDeploymentRevision === null
        ? "DEPLOYMENT_REVISION_REQUIRED"
        : "DEPLOYMENT_REVISION_CONFLICT",
      "Deployment revision changed before the requested operation",
    );
  }
  if (
    currentRevision === 0 &&
    options.request.expectedDeploymentRevision !== null
  ) {
    throw new PlatformApiError(
      409,
      "DEPLOYMENT_REVISION_CONFLICT",
      "Deployment does not exist at the expected revision",
    );
  }
  if (current?.agentDeploymentId === options.request.agentDeploymentId) {
    throw new PlatformApiError(
      409,
      "AGENT_DEPLOYMENT_ALREADY_DEPLOYED",
      "Agent deployment is already selected for this environment",
    );
  }
  const events = options.state.events.get(key) ?? [];
  if (
    options.action === "rollback" &&
    !events.some(
      (event) => event.agentDeploymentId === options.request.agentDeploymentId,
    )
  ) {
    throw new PlatformApiError(
      409,
      "ROLLBACK_TARGET_NOT_DEPLOYED",
      "Rollback target was not previously deployed to this environment",
    );
  }

  const revision = currentRevision + 1;
  const response: AgentEnvironmentChangeResponse = {
    apiVersion: 1,
    environmentRevision: {
      environment: options.environment,
      revision,
      agentDeploymentId: options.request.agentDeploymentId,
      previousAgentDeploymentId: current?.agentDeploymentId ?? null,
    },
  };
  options.state.revisions.set(key, revision);
  options.state.deployments.set(key, {
    revision,
    agentDeploymentId: options.request.agentDeploymentId,
    agentDeploymentVersion: agentDeployment.version,
    imageDigest: agentDeployment.imageDigest,
    state: agentDeployment.state,
  });
  appendDeploymentEvent(options.state.events, key, {
    revision,
    action: options.action,
    agentDeploymentId: options.request.agentDeploymentId,
    agentDeploymentVersion: agentDeployment.version,
    imageDigest: agentDeployment.imageDigest,
    previousAgentDeploymentId: current?.agentDeploymentId ?? null,
    createdAt: options.state.now().toISOString(),
  });
  options.state.idempotency.set(options.idempotencyKey, {
    requestHash,
    response,
  });
  return response;
}

function appendDeploymentEvent(
  events: Map<string, DevelopmentDeploymentRevision[]>,
  key: string,
  event: DevelopmentDeploymentRevision,
): void {
  const history = events.get(key) ?? [];
  history.push(event);
  events.set(key, history);
}

function assertDevelopmentProjectAccess(
  identity: PlatformRequestIdentity,
  accountId: string,
  agent: string,
  agents: ReadonlyMap<string, { name: string }>,
): void {
  if (identity.accountId !== accountId || !agents.has(agent)) {
    throw new PlatformApiError(404, "AGENT_NOT_FOUND", "Project not found");
  }
}

function paginate<T>(
  items: readonly T[],
  limit: number,
  cursor: string | null,
  key: (item: T) => string,
): { items: T[]; nextCursor: string | null } {
  let offset = 0;
  if (cursor !== null) {
    const cursorKey = decodeCursor(cursor);
    const index = items.findIndex((item) => key(item) === cursorKey);
    if (index < 0) {
      throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
    }
    offset = index + 1;
  }
  const page = items.slice(offset, offset + limit);
  const nextOffset = offset + page.length;
  return {
    items: page,
    nextCursor:
      nextOffset < items.length
        ? Buffer.from(key(page.at(-1) as T), "utf8").toString("base64url")
        : null,
  };
}

function decodeCursor(cursor: string): string {
  try {
    const decoded = Buffer.from(cursor, "base64url").toString("utf8");
    if (!decoded || decoded.length > 128) throw new Error("invalid");
    return decoded;
  } catch {
    throw new PlatformApiError(400, "INVALID_CURSOR", "Cursor is invalid");
  }
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
