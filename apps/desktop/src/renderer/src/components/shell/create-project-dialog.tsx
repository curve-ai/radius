import { useState, type FormEvent, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { InlineFeedbackTransition } from "@renderer/components/ui/inline-feedback-transition";
import type { ProjectSidebarRecord } from "./project-context-value";
import { ProjectNameField } from "./project-name-field";
import { projectErrorMessage } from "./project-errors";
import {
  ProjectSourceFoldersField,
  type ProjectSourceFolderItem,
} from "./project-source-folders-field";

type FolderSelection = NonNullable<
  Awaited<ReturnType<Window["radius"]["chooseProjectFolder"]>>
>;

export function CreateProjectDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (project: ProjectSidebarRecord) => Promise<void>;
}): ReactNode {
  const [name, setName] = useState("");
  const [selections, setSelections] = useState<FolderSelection[]>([]);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setName("");
    setSelections([]);
    setChoosing(false);
    setCreating(false);
    setError(null);
  };

  const close = (): void => {
    for (const selection of selections) {
      void window.radius.discardProjectFolderSelection(selection.selectionId);
    }
    reset();
    onOpenChange(false);
  };

  const handleOpenChange = (nextOpen: boolean): void => {
    if (!nextOpen && creating) return;
    if (nextOpen) onOpenChange(true);
    else close();
  };

  const chooseFolder = async (): Promise<void> => {
    setChoosing(true);
    setError(null);
    try {
      const nextSelection = await window.radius.chooseProjectFolder();
      if (!nextSelection) return;
      if (
        selections.some(
          (selection) => selection.rootPath === nextSelection.rootPath,
        )
      ) {
        await window.radius.discardProjectFolderSelection(
          nextSelection.selectionId,
        );
        setError("That folder is already selected");
        return;
      }
      const shouldUseFolderName = !name.trim() && selections.length === 0;
      setSelections((current) => [...current, nextSelection]);
      if (shouldUseFolderName) setName(nextSelection.defaultName);
    } catch (cause) {
      setError(projectErrorMessage(cause, "Folder could not be selected"));
    } finally {
      setChoosing(false);
    }
  };

  const removeFolder = (folder: ProjectSourceFolderItem): void => {
    const selection = selections.find(
      (candidate) => candidate.selectionId === folder.id,
    );
    if (!selection) return;
    void window.radius.discardProjectFolderSelection(selection.selectionId);
    setSelections((current) =>
      current.filter(
        (candidate) => candidate.selectionId !== selection.selectionId,
      ),
    );
    setError(null);
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const projectName = name.trim();
    if (!projectName || creating) return;

    setCreating(true);
    setError(null);
    try {
      const project = await window.radius.createProject({
        name: projectName,
        selectionIds: selections.map((selection) => selection.selectionId),
      });
      setSelections([]);
      await onCreated(project);
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(projectErrorMessage(cause, "Project could not be created"));
    } finally {
      setCreating(false);
    }
  };

  const canCreate = Boolean(name.trim()) && !creating;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        aria-describedby="create-project-description"
        showCloseButton={!creating}
        className="gap-0 overflow-hidden rounded-lg border-border/70 p-0 shadow-xl sm:max-w-[38rem]"
      >
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader className="px-6 pb-5 pt-6 pr-14">
            <DialogTitle className="type-md-lg font-normal leading-tight">
              Create project
            </DialogTitle>
            <DialogDescription
              id="create-project-description"
              className="sr-only"
            >
              Name the project and optionally add source folders for local file
              access.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6">
            <ProjectNameField
              id="project-name"
              autoFocus
              value={name}
              placeholder="Project name"
              onChange={(event) => setName(event.target.value)}
            />

            <ProjectSourceFoldersField
              adding={choosing}
              disabled={choosing || creating}
              folders={selections.map((selection) => ({
                id: selection.selectionId,
                name: selection.defaultName,
                rootPath: selection.rootPath,
              }))}
              onAdd={() => void chooseFolder()}
              onRemove={removeFolder}
            />

            <InlineFeedbackTransition>
              {error ? (
                <p role="alert" className="text-sm leading-5 text-negative">
                  {error}
                </p>
              ) : null}
            </InlineFeedbackTransition>
          </div>

          <DialogFooter className="px-6 pb-6 pt-6">
            <Button
              type="button"
              variant="ghost"
              disabled={creating}
              onClick={close}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!canCreate}>
              {creating ? "Creating…" : "Create project"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
