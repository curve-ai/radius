import {
  clearComposerDraft,
  getComposerDraft,
  MAX_COMPOSER_DRAFT_LENGTH,
  saveComposerDraft,
  type ComposerDraftInput,
  type RadiusDatabase,
} from "@curve-ai/radius-storage";

import type { ComposerDraftContext } from "../radius-api";
import { localDeviceIdentity } from "./device-identity";
import { initializeStorage } from "./storage";

function parseIdentifier(value: unknown, label: string): string {
  if (typeof value !== "string" || !value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

function parseComposerDraftContext(value: unknown): ComposerDraftContext {
  if (!value || typeof value !== "object") {
    throw new Error("A draft context is required");
  }
  const kind = Reflect.get(value, "kind");
  if (kind === "new_chat") {
    const projectId = Reflect.get(value, "projectId");
    if (projectId === null) return { kind, projectId: null };
    return {
      kind,
      projectId: parseIdentifier(projectId, "A draft project identifier"),
    };
  }
  if (kind === "session") {
    return {
      kind,
      sessionId: parseIdentifier(
        Reflect.get(value, "sessionId"),
        "A draft session identifier",
      ),
    };
  }
  throw new Error("The draft context is invalid");
}

async function localDraftStorage(context: ComposerDraftContext): Promise<{
  database: RadiusDatabase;
  input: ComposerDraftInput;
}> {
  const storage = await initializeStorage();
  return {
    database: storage.database,
    input: {
      clientInstanceId: localDeviceIdentity(storage.vault).clientInstanceId,
      context,
    },
  };
}

export async function getComposerDraftForRenderer(
  value: unknown,
): Promise<string | null> {
  const { database, input } = await localDraftStorage(
    parseComposerDraftContext(value),
  );
  return getComposerDraft(database, input);
}

export async function saveComposerDraftForRenderer(
  value: unknown,
): Promise<void> {
  if (!value || typeof value !== "object") {
    throw new Error("Draft details are required");
  }
  const context = parseComposerDraftContext(Reflect.get(value, "context"));
  const content = Reflect.get(value, "content");
  if (typeof content !== "string") {
    throw new Error("Draft content must be text");
  }
  if (content.length > MAX_COMPOSER_DRAFT_LENGTH) {
    throw new Error(
      `Drafts must be ${MAX_COMPOSER_DRAFT_LENGTH} characters or fewer`,
    );
  }
  const { database, input } = await localDraftStorage(context);
  await saveComposerDraft(database, {
    ...input,
    content,
  });
}

export async function clearComposerDraftForRenderer(
  value: unknown,
): Promise<void> {
  const { database, input } = await localDraftStorage(
    parseComposerDraftContext(value),
  );
  await clearComposerDraft(database, input);
}
