import { Folder, FolderPlus, X } from "lucide-react";
import { useId, type ReactNode } from "react";

export interface ProjectSourceFolderItem {
  id: string;
  name: string;
  rootPath: string;
}

export function ProjectSourceFoldersField({
  adding,
  disabled,
  folders,
  onAdd,
  onRemove,
  removingId,
}: {
  adding: boolean;
  disabled: boolean;
  folders: readonly ProjectSourceFolderItem[];
  onAdd: () => void;
  onRemove: (folder: ProjectSourceFolderItem) => void;
  removingId?: string | null;
}): ReactNode {
  const fieldId = useId();
  return (
    <div className="space-y-2">
      <div>
        <p id={`${fieldId}-label`} className="text-sm text-foreground">
          Source folders
        </p>
        <p
          id={`${fieldId}-description`}
          className="mt-0.5 text-xs leading-5 text-muted-foreground"
        >
          Folders Radius can read and edit for this project.
        </p>
      </div>
      <div
        role="group"
        aria-labelledby={`${fieldId}-label`}
        aria-describedby={`${fieldId}-description`}
        className="overflow-hidden rounded-md border border-input bg-background"
      >
        {folders.length > 0 ? (
          <div className="max-h-48 overflow-y-auto">
            {folders.map((folder) => (
              <div
                key={folder.id}
                className="flex min-h-11 min-w-0 items-center gap-2 border-b border-border px-3"
              >
                <Folder
                  className="size-4 shrink-0 text-muted-foreground"
                  strokeWidth={1.5}
                  aria-hidden
                />
                <span
                  className="min-w-0 flex-1 truncate text-sm text-foreground"
                  title={folder.rootPath}
                >
                  {folder.name}
                </span>
                <button
                  type="button"
                  disabled={disabled}
                  aria-label={`Remove ${folder.name}`}
                  title="Remove folder"
                  className="flex size-8 shrink-0 items-center justify-center rounded-md text-muted-foreground outline-none transition-[background-color,color] hover:bg-accent hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
                  onClick={() => onRemove(folder)}
                >
                  <X className="size-4" strokeWidth={1.5} aria-hidden />
                  {removingId === folder.id ? (
                    <span className="sr-only">Removing folder</span>
                  ) : null}
                </button>
              </div>
            ))}
          </div>
        ) : null}
        <button
          type="button"
          disabled={disabled}
          className="flex min-h-11 w-full items-center gap-2 px-3 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring disabled:cursor-wait disabled:opacity-50"
          onClick={onAdd}
        >
          <FolderPlus
            className="size-4 shrink-0 text-muted-foreground"
            strokeWidth={1.5}
            aria-hidden
          />
          <span>{adding ? "Opening…" : "Add folder"}</span>
        </button>
      </div>
    </div>
  );
}
