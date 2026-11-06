import { useChatWindow } from "./chat-window-context";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  WorkspaceNavigationContext,
  type WorkspaceNavigationContextValue,
} from "@renderer/components/shell/navigation-context";
import {
  WORKSPACE_TITLES,
  type WorkspaceView,
} from "@renderer/components/shell/types";

type NavigationHistory = {
  entries: WorkspaceView[];
  index: number;
};

export function WorkspaceNavigationProvider({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  const { state: chatWindow } = useChatWindow();
  const [history, setHistory] = useState<NavigationHistory>({
    entries: ["workspace"],
    index: 0,
  });
  const activeView = history.entries[history.index];

  const navigate = useCallback(
    (view: WorkspaceView): void => {
      if (chatWindow.kind === "detached" && view !== "workspace") {
        void window.radius.chatWindows.openMain(
          view === "settings" || view === "agents" || view === "connectors"
            ? view
            : "workspace",
        );
        return;
      }
      setHistory((current) => {
        if (current.entries[current.index] === view) return current;

        const entries = [...current.entries.slice(0, current.index + 1), view];
        return { entries, index: entries.length - 1 };
      });
    },
    [chatWindow.kind],
  );

  const goBack = useCallback((): void => {
    setHistory((current) =>
      current.index > 0 ? { ...current, index: current.index - 1 } : current,
    );
  }, []);

  const goForward = useCallback((): void => {
    setHistory((current) =>
      current.index < current.entries.length - 1
        ? { ...current, index: current.index + 1 }
        : current,
    );
  }, []);

  useEffect(() => {
    document.title = `${WORKSPACE_TITLES[activeView]} · Radius`;
    document.getElementById("main-content")?.focus();
  }, [activeView]);

  useEffect(
    () => window.radius.chatWindows.onNavigateMain(navigate),
    [navigate],
  );

  useEffect(() => {
    if (chatWindow.kind !== "main" || !chatWindow.requestedView) return;
    const view = chatWindow.requestedView;
    const frame = window.requestAnimationFrame(() => navigate(view));
    return () => window.cancelAnimationFrame(frame);
  }, [chatWindow.kind, chatWindow.requestedView, navigate]);

  const value = useMemo<WorkspaceNavigationContextValue>(
    () => ({
      activeView,
      canGoBack: history.index > 0,
      canGoForward: history.index < history.entries.length - 1,
      navigate,
      goBack,
      goForward,
    }),
    [activeView, goBack, goForward, history, navigate],
  );

  return (
    <WorkspaceNavigationContext.Provider value={value}>
      {children}
    </WorkspaceNavigationContext.Provider>
  );
}
