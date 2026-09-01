import { createContext, useContext } from "react";

export const WorkspaceWindowResizeContext = createContext(false);

export function useWorkspaceWindowResizing(): boolean {
  return useContext(WorkspaceWindowResizeContext);
}
