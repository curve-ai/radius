import { Folder, FolderPlus } from "lucide-react";
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
import { cn } from "@renderer/lib/utils";
import type { ProjectSidebarRecord } from "./project-context-value";
import { ProjectNameField } from "./project-name-field";
import { projectErrorMessage } from "./project-errors";

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
  const [selection, setSelection] = useState<FolderSelection | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reset = (): void => {
    setName("");
    setSelection(null);
    setChoosing(false);
    setCreating(false);
    setError(null);
  };

  const close = (): void => {
    if (selection) {
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
      const shouldUseFolderName =
        !name.trim() || name === selection?.defaultName;
      if (selection) {
        await window.radius.discardProjectFolderSelection(
          selection.selectionId,
        );
      }
      setSelection(nextSelection);
      if (shouldUseFolderName) setName(nextSelection.defaultName);
    } catch (cause) {
      setError(projectErrorMessage(cause, "Folder could not be selected"));
    } finally {
      setChoosing(false);
    }
  };

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const projectName = name.trim();
    if (!selection || !projectName || creating) return;

    setCreating(true);
    setError(null);
    try {
      const project = await window.radius.createProject({
        selectionId: selection.selectionId,
        name: projectName,
      });
      setSelection(null);
      await onCreated(project);
      reset();
      onOpenChange(false);
    } catch (cause) {
      setError(projectErrorMessage(cause, "Project could not be created"));
    } finally {
      setCreating(false);
    }
  };

  const canCreate = Boolean(selection && name.trim()) && !creating;

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
              Name the project and choose the one folder Radius may read and
              edit.
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

            <div className="space-y-2">
              <div>
                <p className="text-sm text-foreground">Project folder</p>
                <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
                  This folder is the access boundary for every chat in this
                  project.
                </p>
              </div>
              <button
                type="button"
                disabled={choosing || creating}
                className={cn(
                  "flex min-h-36 w-full items-center justify-center rounded-md border border-border bg-foreground/[0.015] px-6 py-5 text-center outline-none transition-[background-color,border-color,box-shadow] hover:bg-foreground/[0.035] focus-visible:border-foreground/30 focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-60",
                  selection && "justify-start text-left",
                )}
                onClick={() => void chooseFolder()}
              >
                {selection ? (
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                      <Folder className="size-5" aria-hidden />
                    </span>
                    <span className="min-w-0">
                      <span className="block truncate text-sm text-foreground">
                        {selection.defaultName}
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground">
                        {selection.rootPath}
                      </span>
                      <span className="mt-2 block text-xs text-muted-foreground">
                        Radius can read and edit everything inside. Click to
                        change.
                      </span>
                    </span>
                  </span>
                ) : (
                  <span className="flex flex-col items-center">
                    <FolderPlus
                      className="mb-3 size-6 text-muted-foreground"
                      strokeWidth={1.5}
                      aria-hidden
                    />
                    <span className="text-sm text-foreground">
                      {choosing
                        ? "Opening folder picker…"
                        : "Choose project folder"}
                    </span>
                    <span className="mt-1 text-xs leading-5 text-muted-foreground">
                      Radius can read and edit everything inside this folder.
                    </span>
                  </span>
                )}
              </button>
            </div>

            {error && (
              <p role="alert" className="text-sm leading-5 text-negative">
                {error}
              </p>
            )}
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
