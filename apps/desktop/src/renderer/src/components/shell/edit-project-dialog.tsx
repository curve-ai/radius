import { Folder } from "lucide-react";
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

export function EditProjectDialog({
  open,
  project,
  onOpenChange,
  onRelink,
  onSaved,
}: {
  open: boolean;
  project: ProjectSidebarRecord;
  onOpenChange: (open: boolean) => void;
  onRelink: (projectId: string) => Promise<boolean>;
  onSaved: () => Promise<void>;
}): ReactNode {
  const [name, setName] = useState(project.name);
  const [saving, setSaving] = useState(false);
  const [relinking, setRelinking] = useState(false);
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

  const relink = async (): Promise<void> => {
    setRelinking(true);
    setError(null);
    try {
      await onRelink(project.id);
    } catch (cause) {
      setError(
        projectErrorMessage(cause, "Project folder could not be linked"),
      );
    } finally {
      setRelinking(false);
    }
  };

  const busy = saving || relinking;

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
              Rename the project or change its local root folder.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5 px-6">
            <ProjectNameField
              id="edit-project-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
            />

            <div className="space-y-2">
              <p className="text-sm text-foreground">Project folder</p>
              <div className="flex min-w-0 items-center gap-3 rounded-md border border-border bg-foreground/[0.015] p-3">
                <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted text-foreground">
                  <Folder className="size-4" aria-hidden />
                </span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {project.rootPath ?? "No local folder linked"}
                </span>
                <Button
                  type="button"
                  variant="secondary"
                  size="xs"
                  disabled={busy}
                  onClick={() => void relink()}
                >
                  {relinking
                    ? "Opening…"
                    : project.rootPath
                      ? "Change folder"
                      : "Link folder"}
                </Button>
              </div>
            </div>

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
