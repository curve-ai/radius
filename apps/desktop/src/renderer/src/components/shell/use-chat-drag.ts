import {
  useCallback,
  useEffect,
  useRef,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { useChatWindow } from "./chat-window-context";

/** Pointer capture preserves mouse-up outside the source window; lost capture cancels. */
export function useChatDrag(
  sessionId: string,
): React.HTMLAttributes<HTMLElement> {
  const { reportError } = useChatWindow();
  const drag = useRef<{
    x: number;
    y: number;
    token: string;
    started: Promise<void> | null;
    node: HTMLElement;
    previousCursor: string;
    cancel: (event: KeyboardEvent) => void;
  } | null>(null);
  const suppressClick = useRef(false);
  const finish = useCallback(
    (cancelled: boolean): void => {
      const current = drag.current;
      if (!current) return;
      drag.current = null;
      window.removeEventListener("keydown", current.cancel, true);
      current.node.style.opacity = "";
      document.body.style.cursor = current.previousCursor;
      if (current.started)
        void current.started
          .then(() =>
            window.radius.chatWindows.endDrag(current.token, cancelled),
          )
          .catch(reportError);
    },
    [reportError],
  );
  useEffect(() => () => finish(true), [finish]);
  return {
    onPointerDown: (event: ReactPointerEvent<HTMLElement>): void => {
      if (
        event.button !== 0 ||
        (event.target instanceof Element &&
          event.target.closest("input, textarea, [data-chat-action]"))
      )
        return;
      finish(true);
      suppressClick.current = false;
      event.currentTarget.setPointerCapture(event.pointerId);
      const cancel = (keyEvent: KeyboardEvent): void => {
        if (keyEvent.key === "Escape") {
          keyEvent.preventDefault();
          finish(true);
        }
      };
      drag.current = {
        x: event.clientX,
        y: event.clientY,
        token: crypto.randomUUID(),
        started: null,
        node: event.currentTarget,
        previousCursor: document.body.style.cursor,
        cancel,
      };
      window.addEventListener("keydown", cancel, true);
    },
    onPointerMove: (event: ReactPointerEvent<HTMLElement>): void => {
      const current = drag.current;
      if (
        !current ||
        current.started ||
        Math.hypot(event.clientX - current.x, event.clientY - current.y) < 7
      )
        return;
      suppressClick.current = true;
      current.node.style.opacity = "0.5";
      document.body.style.cursor = "grabbing";
      current.started = window.radius.chatWindows.beginDrag(
        sessionId,
        current.token,
      );
      // Attach a rejection handler immediately; finish still observes the same promise.
      void current.started.catch(reportError);
    },
    onPointerUp: (): void => finish(false),
    onPointerCancel: (): void => finish(true),
    onLostPointerCapture: (): void => finish(true),
    onClickCapture: (event: React.MouseEvent<HTMLElement>): void => {
      if (suppressClick.current) {
        event.preventDefault();
        event.stopPropagation();
        suppressClick.current = false;
      }
    },
  };
}
