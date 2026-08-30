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
import { projectErrorMessage } from "./project-errors";
import { ProjectNameField } from "./project-name-field";
import { ProjectSourceFoldersField } from "./project-source-folders-field";

export function EditProjectDialog({
  open,
  project,
  onAddFolder,
  onOpenChange,
  onRemoveFolder,
  onSaved,
}: {
  open: boolean;
  project: ProjectSidebarRecord;
  onAddFolder: (projectId: string) => Promise<void>;
  onOpenChange: (open: boolean) => void;
  onRemoveFolder: (projectId: string, rootId: string) => Promise<void>;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    const nextName = name.trim();
    if (!nextName || saving) return;

    setSaving(true);
    setError(null);
    try {
      await window.radius.renameProject({
        projectId: project.id,
        name: nextName,
      });
      await onSaved();
      onOpenChange(false);
    } catch (cause) {
      setError(projectErrorMessage(cause, "Project could not be updated"));
    } finally {
      setSaving(false);
    }
  };

  const addFolder = async (): Promise<void> => {
    setAdding(true);
    setError(null);
    try {
      await onAddFolder(project.id);
    } catch (cause) {
      setError(
        projectErrorMessage(cause, "Project folder could not be linked"),
      );
    } finally {
      setAdding(false);
    }
  };

  const removeFolder = async (rootId: string): Promise<void> => {
    setRemovingId(rootId);
    setError(null);
    try {
      await onRemoveFolder(project.id, rootId);
    } catch (cause) {
      setError(
        projectErrorMessage(cause, "Project folder could not be removed"),
      );
    } finally {
      setRemovingId(null);
    }
  };

  const busy = saving || adding || removingId !== null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => !busy && onOpenChange(nextOpen)}
    >
      <DialogContent
        showCloseButton={!busy}
        aria-describedby="edit-project-description"
        className="gap-0 overflow-hidden rounded-lg border-border/70 p-0 shadow-xl sm:max-w-[34rem]"
      >
        <form onSubmit={(event) => void submit(event)}>
          <DialogHeader className="px-6 pb-5 pt-6 pr-14">
            <DialogTitle className="type-md font-normal leading-tight">
              Edit project
            </DialogTitle>
            <DialogDescription
              id="edit-project-description"
              className="sr-only"
            >
              Rename the project or manage its local source folders.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6">
            <ProjectNameField
              id="edit-project-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            <ProjectSourceFoldersField
              adding={adding}
              disabled={busy}
              folders={project.roots}
              removingId={removingId}
              onAdd={() => void addFolder()}
              onRemove={(folder) => void removeFolder(folder.id)}
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
              disabled={busy}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || busy}>
              {saving ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
