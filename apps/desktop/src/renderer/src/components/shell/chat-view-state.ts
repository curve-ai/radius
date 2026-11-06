import type { ChatViewState } from "../../../../chat-window-types";

export type LocalChatViewState = ChatViewState;
const saved = new Map<string, LocalChatViewState>();
const savedFlushes = new Map<string, () => Promise<void>>();
const readers = new Map<string, () => Promise<LocalChatViewState>>();
const ready = new Map<string, () => void>();

export function getChatViewState(id: string): LocalChatViewState | undefined {
  return saved.get(id);
}
export function saveChatViewState(id: string, state: LocalChatViewState): void {
  saved.set(id, state);
}
export function registerChatView(
  id: string,
  read: () => Promise<LocalChatViewState>,
  flushDraft?: () => Promise<void>,
): () => void {
  readers.set(id, read);
  if (flushDraft) savedFlushes.set(id, flushDraft);
  return () => {
    if (readers.get(id) === read) readers.delete(id);
  };
}
export function chatViewReady(id: string): void {
  ready.get(id)?.();
}
export function restoreChatViewStates(
  states: Record<string, ChatViewState>,
): void {
  for (const [id, state] of Object.entries(states)) saved.set(id, state);
}

export function prepareChatView(
  id: string,
  state: ChatViewState | null,
): Promise<void> {
  if (state) restoreChatViewStates({ [id]: state });
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      ready.delete(id);
      reject(new Error("This chat could not be restored"));
    }, 12_000);
    ready.set(id, () => {
      window.clearTimeout(timer);
      ready.delete(id);
      resolve();
    });
  });
}
export async function captureChatViews(
  id?: string,
): Promise<Record<string, ChatViewState>> {
  const result: Record<string, ChatViewState> = {};
  const ids = id ? [id] : [...new Set([...readers.keys(), ...saved.keys()])];
  for (const sessionId of ids) {
    const local = (await readers.get(sessionId)?.()) ?? saved.get(sessionId);
    if (!local) continue;
    if (!readers.has(sessionId) && savedFlushes.has(sessionId))
      await savedFlushes.get(sessionId)!();
    saved.set(sessionId, local);
    result[sessionId] = local;
  }
  return result;
}

export function retainChatViewStates(owns: (id: string) => boolean): void {
  for (const id of saved.keys())
    if (!owns(id) && !readers.has(id)) {
      saved.delete(id);
      savedFlushes.delete(id);
    }
}
