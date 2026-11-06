import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChatWindowContext } from "./chat-window-context";
import {
  captureChatViews,
  prepareChatView,
  retainChatViewStates,
  restoreChatViewStates,
} from "./chat-view-state";
import type { ChatWindowState } from "../../../../chat-window-types";

export function ChatWindowProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const [state, setState] = useState<ChatWindowState | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [frozen, setFrozen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportError = useCallback(
    (cause: unknown) =>
      setError(cause instanceof Error ? cause.message : String(cause)),
    [],
  );

  useEffect(() => {
    const update = (next: ChatWindowState): void => {
      sessionStorage.setItem("radius:window-id", next.id);
      setState(next);
      if (!next.transferring) {
        setFrozen(false);
        setPreview(null);
      }
    };
    const unsubscribe = window.radius.chatWindows.onChanged(update);
    const unsubscribeError = window.radius.chatWindows.onError(reportError);
    const unsubscribeRequest = window.radius.chatWindows.onRequest(
      (request) => {
        void (async () => {
          try {
            if (request.kind === "restore-all") {
              restoreChatViewStates(request.states);
              await window.radius.chatWindows.reply(request.id, {});
            } else if (request.kind === "prepare") {
              setFrozen(true);
              const restored = prepareChatView(
                request.sessionId,
                request.state,
              );
              setPreview(request.sessionId);
              await restored;
              await window.radius.chatWindows.reply(request.id, {});
            } else {
              setFrozen(true);
              // Commit the inert boundary before flushing draft writes or reading File bytes.
              await new Promise<void>((resolve) =>
                window.setTimeout(resolve, 0),
              );
              const states = await captureChatViews(
                request.kind === "capture" ? request.sessionId : undefined,
              );
              await window.radius.chatWindows.reply(request.id, { states });
            }
          } catch (cause) {
            setFrozen(false);
            await window.radius.chatWindows
              .reply(request.id, {
                error:
                  cause instanceof Error
                    ? cause.message
                    : "The chat could not be moved",
              })
              .catch(() => undefined);
          }
        })();
      },
    );
    void window.radius.chatWindows.state().then(update).catch(reportError);
    return () => {
      unsubscribe();
      unsubscribeError();
      unsubscribeRequest();
    };
  }, [reportError]);

  useEffect(() => {
    if (state && !state.transferring)
      retainChatViewStates((id) =>
        state.kind === "main"
          ? !state.detached[id]
          : state.sessionIds.includes(id),
      );
  }, [state]);

  if (!state)
    return (
      <div
        role="status"
        className="flex h-dvh items-center justify-center bg-background text-sm text-muted-foreground"
      >
        {error ?? "Opening workspace…"}
      </div>
    );
  const effective = preview
    ? {
        ...state,
        sessionIds: state.sessionIds.includes(preview)
          ? state.sessionIds
          : [...state.sessionIds, preview],
        activeSessionId: preview,
      }
    : state;
  return (
    <ChatWindowContext.Provider
      value={{
        state: effective,
        requestedSessionId: effective.activeSessionId,
        reportError,
      }}
    >
      <div className="h-full" inert={frozen || undefined}>
        {children}
      </div>
      {frozen ? (
        <div
          role="status"
          className="fixed bottom-4 left-1/2 z-[100] -translate-x-1/2 rounded-md border bg-background px-3 py-2 text-sm text-muted-foreground shadow-sm"
        >
          Moving chat…
        </div>
      ) : null}
      {error ? (
        <div
          role="alert"
          className="fixed bottom-4 left-1/2 z-[100] flex max-w-[90vw] -translate-x-1/2 items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm shadow-sm"
        >
          <span>{error}</span>
          <button
            type="button"
            className="shrink-0 rounded px-1 text-muted-foreground hover:text-foreground"
            onClick={() => setError(null)}
          >
            Dismiss
          </button>
        </div>
      ) : null}
    </ChatWindowContext.Provider>
  );
}
