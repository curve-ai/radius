import { useCallback } from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { useProjects } from "@renderer/components/shell/project-context-value";

export function useStartNewChat(): () => void {
  const { navigate } = useWorkspaceNavigation();
  const { clearActiveSession } = useProjects();

  return useCallback(() => {
    clearActiveSession();
    navigate("workspace");
  }, [clearActiveSession, navigate]);
}
