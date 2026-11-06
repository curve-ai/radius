import { createContext, useContext } from "react";
import type { ChatWindowState } from "../../../../chat-window-types";

export interface ChatWindowContextValue {
  state: ChatWindowState;
  requestedSessionId: string | null;
  reportError(error: unknown): void;
}
export const ChatWindowContext = createContext<ChatWindowContextValue | null>(
  null,
);
export function useChatWindow(): ChatWindowContextValue {
  const value = useContext(ChatWindowContext);
  if (!value) throw new Error("Chat window context is unavailable");
  return value;
}
export function windowPreferenceKey(key: string): string {
  return `${key}:${window.sessionStorage.getItem("radius:window-id") ?? "main"}`;
}

export function readWindowPreference(key: string): string | null {
  return (
    localStorage.getItem(windowPreferenceKey(key)) ??
    (sessionStorage.getItem("radius:window-id") === "main"
      ? localStorage.getItem(key)
      : null)
  );
}
