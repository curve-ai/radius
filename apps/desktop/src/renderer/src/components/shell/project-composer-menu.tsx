import { Folder, LoaderCircle, SquarePlus } from "lucide-react";
import type { ReactNode } from "react";

import { ComposerContextMenuClose } from "@renderer/components/ai/composer-context-menu";
import {
  ActionToolPanelButton,
  ActionToolPanelGroup,
  ActionToolPanelGroupLabel,
  ActionToolPanelItem,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
  ActionToolPanelItemMeta,
} from "@renderer/components/ui/action-tool-panel";
import { useProjects } from "./project-context-value";

export function ProjectComposerMenu(): ReactNode {
  const {
    activeProject,
    error,
    loading,
    openCreateProjectDialog,
    projects,
    relinkProject,
    selectProject,
  } = useProjects();
  const projectsVisible = loading || projects.length > 0 || error;

  return (
    <>
      {projectsVisible ? (
        <ActionToolPanelGroup className="gap-0 p-0">
          <ActionToolPanelGroupLabel className="px-1.5 pb-1 pt-1 text-xs">
            Projects
          </ActionToolPanelGroupLabel>
          {loading ? (
            <ActionToolPanelItem
              aria-live="polite"
              className="min-h-8 gap-2 px-1.5 py-1"
            >
              <ActionToolPanelItemIcon>
                <LoaderCircle className="animate-spin" aria-hidden />
              </ActionToolPanelItemIcon>
              <ActionToolPanelItemContent>
                <ActionToolPanelItemLabel>
                  Loading projects
                </ActionToolPanelItemLabel>
              </ActionToolPanelItemContent>
            </ActionToolPanelItem>
          ) : (
            projects.map((project) => {
              const selected = project.id === activeProject?.id;
              return (
                <ComposerContextMenuClose key={project.id}>
                  <ActionToolPanelButton
                    type="button"
                    selected={selected}
                    className="rounded-lg px-1.5"
                    onClick={() => {
                      selectProject(project.id);
                      if (!project.rootPath) {
                        void relinkProject(project.id).catch(() => {});
                      }
                    }}
                  >
                    <ActionToolPanelItemIcon>
                      <Folder aria-hidden />
                    </ActionToolPanelItemIcon>
                    <ActionToolPanelItemContent>
                      <ActionToolPanelItemLabel className="truncate">
                        {project.name}
                      </ActionToolPanelItemLabel>
                    </ActionToolPanelItemContent>
                    {selected || !project.rootPath ? (
                      <ActionToolPanelItemMeta className="text-sm">
                        {selected ? "Current" : "Relink"}
                      </ActionToolPanelItemMeta>
                    ) : null}
                  </ActionToolPanelButton>
                </ComposerContextMenuClose>
              );
            })
          )}
          {error ? (
            <p className="px-1.5 py-1 text-xs text-negative" role="alert">
              {error}
            </p>
          ) : null}
        </ActionToolPanelGroup>
      ) : null}
      <ActionToolPanelGroup className="gap-0 p-0">
        <ActionToolPanelGroupLabel className="px-1.5 pb-1 pt-1 text-xs">
          Add
        </ActionToolPanelGroupLabel>
        <ComposerContextMenuClose>
          <ActionToolPanelButton
            type="button"
            className="rounded-lg px-1.5"
            onClick={openCreateProjectDialog}
          >
            <ActionToolPanelItemIcon>
              <SquarePlus strokeWidth={1.5} aria-hidden />
            </ActionToolPanelItemIcon>
            <ActionToolPanelItemContent>
              <ActionToolPanelItemLabel>
                Create new project
              </ActionToolPanelItemLabel>
            </ActionToolPanelItemContent>
          </ActionToolPanelButton>
        </ComposerContextMenuClose>
      </ActionToolPanelGroup>
    </>
  );
}
