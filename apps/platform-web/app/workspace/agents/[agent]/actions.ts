"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";

import { RadiusPlatformError } from "@curve-ai/platform-client";
import { formString, isUuid } from "@/app/workspace/action-input";
import { canChangeDeployments } from "@/lib/platform-permissions";
import { getPlatformContext } from "@/lib/platform-server";
import type { DeploymentActionState } from "./action-state";

export async function changeDeploymentAction(
  _previousState: DeploymentActionState,
  formData: FormData,
): Promise<DeploymentActionState> {
  try {
    const context = await getPlatformContext();
    const organization = context.organization;
    const expectedOrganization = formString(formData, "organization");
    if (!organization || organization.slug !== expectedOrganization) {
      return failure(
        "The selected organization changed. Refresh and try again.",
      );
    }
    if (!canChangeDeployments(organization.role)) {
      return failure("Developer access is required to change deployments.");
    }

    const agent = formString(formData, "agent");
    const environment = formString(formData, "environment");
    const agentDeploymentId = formString(formData, "agentDeploymentId");
    const mode = formString(formData, "mode");
    const expectedRevision = Number(formString(formData, "expectedRevision"));
    if (
      !AGENT_PATTERN.test(agent) ||
      !SLUG_PATTERN.test(environment) ||
      !isUuid(agentDeploymentId) ||
      (mode !== "promote" && mode !== "rollback") ||
      !Number.isInteger(expectedRevision) ||
      expectedRevision < 0
    ) {
      return failure(
        "The deployment action is invalid. Refresh and try again.",
      );
    }

    const agents = await context.client.listAgents(organization.slug);
    const selectedAgent = agents.agents.find(
      (candidate) => candidate.agent === agent,
    );
    if (
      !selectedAgent ||
      !selectedAgent.environments.some(
        (candidate) => candidate.name === environment,
      )
    ) {
      return failure(
        "The selected agent or environment is no longer available.",
      );
    }

    const history = await context.client.listAgentEnvironmentHistory(
      agent,
      environment,
      { limit: 1 },
    );
    const currentDeploymentId = history.revisions[0]?.agentDeploymentId ?? null;
    const { targetDeployment, currentDeployment } = await loadDeploymentPair(
      context.client,
      agent,
      agentDeploymentId,
      currentDeploymentId,
    );
    if (history.currentRevision !== expectedRevision) {
      return failure(
        "The deployment changed. Review the latest revision and try again.",
      );
    }
    if (!targetDeployment || targetDeployment.state !== "verified") {
      return failure("The selected deployment is no longer available.");
    }
    if (currentDeploymentId === agentDeploymentId) {
      return failure(
        "This deployment is already active in the selected environment.",
      );
    }
    if (currentDeploymentId !== null && !currentDeployment) {
      return failure("The active deployment is no longer available.");
    }
    const expectedMode =
      currentDeployment &&
      new Date(targetDeployment.createdAt).getTime() <
        new Date(currentDeployment.createdAt).getTime()
        ? "rollback"
        : "promote";
    if (mode !== expectedMode) {
      return failure(
        "The deployment action changed. Refresh and review the active deployment.",
      );
    }

    const idempotencyKey = randomUUID();
    const result =
      mode === "rollback"
        ? await context.client.rollbackAgentDeployment(
            agent,
            environment,
            {
              apiVersion: 1,
              agentDeploymentId,
              expectedDeploymentRevision: history.currentRevision,
            },
            idempotencyKey,
          )
        : await context.client.promoteAgentDeployment(
            agent,
            environment,
            {
              apiVersion: 1,
              agentDeploymentId,
              expectedDeploymentRevision:
                history.currentRevision === 0 ? null : history.currentRevision,
            },
            idempotencyKey,
          );

    revalidatePath(`/workspace/agents/${agent}`);
    return {
      status: "success",
      message: `Deployment advanced to revision ${result.environmentRevision.revision}.`,
    };
  } catch (error) {
    return failure(actionErrorMessage(error));
  }
}

async function loadDeploymentPair(
  client: Awaited<ReturnType<typeof getPlatformContext>>["client"],
  agent: string,
  targetDeploymentId: string,
  currentDeploymentId: string | null,
): Promise<{
  targetDeployment:
    | Awaited<
        ReturnType<typeof client.listAgentDeployments>
      >["agentDeployments"][number]
    | null;
  currentDeployment:
    | Awaited<
        ReturnType<typeof client.listAgentDeployments>
      >["agentDeployments"][number]
    | null;
}> {
  let targetDeployment = null;
  let currentDeployment = null;
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  for (;;) {
    const page = await client.listAgentDeployments(agent, {
      limit: 100,
      ...(cursor ? { cursor } : {}),
    });
    targetDeployment ??=
      page.agentDeployments.find(
        (agentDeployment) => agentDeployment.id === targetDeploymentId,
      ) ?? null;
    currentDeployment ??=
      page.agentDeployments.find(
        (agentDeployment) => agentDeployment.id === currentDeploymentId,
      ) ?? null;
    if (
      targetDeployment &&
      (currentDeploymentId === null || currentDeployment)
    ) {
      return { targetDeployment, currentDeployment };
    }
    if (!page.nextCursor) return { targetDeployment, currentDeployment };
    if (seenCursors.has(page.nextCursor)) {
      throw new Error("Deployment inventory returned a repeated cursor");
    }
    seenCursors.add(page.nextCursor);
    cursor = page.nextCursor;
  }
}

const AGENT_PATTERN = /^agent_[A-Za-z0-9_-]{6,64}$/;
const SLUG_PATTERN = /^[a-z][a-z0-9-]{0,62}$/;
function failure(message: string): DeploymentActionState {
  return { status: "error", message };
}

function actionErrorMessage(error: unknown): string {
  if (error instanceof RadiusPlatformError) {
    if (error.code === "DEPLOYMENT_REVISION_CONFLICT") {
      return "The deployment changed. Review the latest revision and try again.";
    }
    if (error.status === 403) {
      return "Your current role does not allow deployment changes.";
    }
    return error.message;
  }
  return error instanceof Error
    ? error.message
    : "The deployment change failed.";
}
