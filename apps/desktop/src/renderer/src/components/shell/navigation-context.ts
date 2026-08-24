import { createContext, useContext } from "react";

import type { WorkspaceView } from "@renderer/components/shell/types";

export type WorkspaceNavigationContextValue = {
  activeView: WorkspaceView;
  canGoBack: boolean;
  canGoForward: boolean;
  navigate: (view: WorkspaceView) => void;
  goBack: () => void;
  goForward: () => void;
};

export const WorkspaceNavigationContext =
  createContext<WorkspaceNavigationContextValue | null>(null);

export function useWorkspaceNavigation(): WorkspaceNavigationContextValue {
  const context = useContext(WorkspaceNavigationContext);
  if (!context) {
    throw new Error(
      "useWorkspaceNavigation must be used within WorkspaceNavigationProvider.",
    );
  }

  return context;
}
