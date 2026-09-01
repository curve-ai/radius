import { Folder, MessagesSquare } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

import { NativeControlMenuButton } from "@renderer/components/shell/native-control-menu-button";
import { projectErrorMessage } from "@renderer/components/shell/project-errors";
import { useProjects } from "@renderer/components/shell/project-context-value";
import { showSessionActionMenu } from "@renderer/components/shell/session-action-menu-actions";
import { cn } from "@renderer/lib/utils";
import type { NativeControlMenuPoint } from "../../../../radius-api";

export function WorkspaceSessionHeader(): ReactNode {
  const {
    activeSession,
    archiveSession,
    clearSessionRenameRequest,
    markSessionsUnread,
    renameSession,
    sessionRenameRequestId,
    setSessionPinned,
  } = useProjects();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [renameError, setRenameError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const savingRef = useRef(false);

  const session = activeSession?.session ?? null;
  const project = activeSession?.project ?? null;
  const pinned = Boolean(session?.pinnedAt);

  useEffect(() => {
    if (!session || sessionRenameRequestId !== session.id) return;
    let selectFrame: number | null = null;
    const frame = window.requestAnimationFrame(() => {
      clearSessionRenameRequest(session.id);
      setMenuOpen(false);
      setRenameError(null);
      setDraft(session.title);
      setEditing(true);
      selectFrame = window.requestAnimationFrame(() =>
        inputRef.current?.select(),
      );
    });
    return () => {
      window.cancelAnimationFrame(frame);
      if (selectFrame !== null) window.cancelAnimationFrame(selectFrame);
    };
  }, [clearSessionRenameRequest, session, sessionRenameRequestId]);

  const beginRename = useCallback((): void => {
    if (!session) return;
    setMenuOpen(false);
    setRenameError(null);
    setDraft(session.title);
    setEditing(true);
    window.requestAnimationFrame(() => inputRef.current?.select());
  }, [session]);

  const commitRename = async (): Promise<void> => {
    if (!session || savingRef.current) return;
    const title = draft.trim();
    if (!title || title === session.title) {
      setDraft(session.title);
      setEditing(false);
      setRenameError(null);
      return;
    }

    savingRef.current = true;
    setSaving(true);
    setRenameError(null);
    try {
      await renameSession(session.id, title);
      setEditing(false);
    } catch (cause) {
      setRenameError(projectErrorMessage(cause, "Chat could not be renamed"));
      window.requestAnimationFrame(() => inputRef.current?.select());
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleRenameSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    void commitRename();
  };

  const handleRenameKeyDown = (
    event: ReactKeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key !== "Escape" || !session) return;
    event.preventDefault();
    setDraft(session.title);
    setEditing(false);
    setRenameError(null);
  };

  const togglePin = useCallback(async (): Promise<void> => {
    if (!session) return;
    setMenuOpen(false);
    await setSessionPinned(session.id, !pinned);
  }, [pinned, session, setSessionPinned]);

  const markUnread = useCallback((): void => {
    if (!session) return;
    markSessionsUnread([session.id]);
    setMenuOpen(false);
  }, [markSessionsUnread, session]);

  const archive = useCallback(async (): Promise<void> => {
    if (!session) return;
    setMenuOpen(false);
    await archiveSession(session.id);
  }, [archiveSession, session]);

  const copyWorkingDirectory = useCallback(async (): Promise<void> => {
    if (!project || project.roots.length === 0) return;
    await window.radius.writeClipboardText(
      project.roots.map((root) => root.rootPath).join("\n"),
    );
  }, [project]);

  const copySessionId = useCallback(async (): Promise<void> => {
    if (!session) return;
    await window.radius.writeClipboardText(session.id);
  }, [session]);

  const openSessionMenu = (point: NativeControlMenuPoint): void => {
    if (!session || menuOpen) return;
    setMenuOpen(true);
    void showSessionActionMenu(
      {
        canMarkUnread: session.lastAssistantMessageAt !== null,
        pinned,
        sessionId: session.id,
        title: session.title,
        workingDirectories: project?.roots.map((root) => root.rootPath) ?? [],
        onArchive: archive,
        onMarkUnread: markUnread,
        onRename: beginRename,
        onTogglePin: togglePin,
      },
      point,
    )
      .catch(() => undefined)
      .finally(() => setMenuOpen(false));
  };

  const handleContextMenu = (event: ReactMouseEvent<HTMLDivElement>): void => {
    if (editing) return;
    event.preventDefault();
    openSessionMenu({ x: event.clientX, y: event.clientY });
  };

  useEffect(() => {
    if (!session) return;
    const handleShortcut = (event: KeyboardEvent): void => {
      if (!event.metaKey) return;
      if (
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement ||
        (event.target instanceof HTMLElement && event.target.isContentEditable)
      ) {
        return;
      }
      const key = event.key.toLowerCase();

      if (event.altKey && key === "p") {
        event.preventDefault();
        void togglePin().catch(() => undefined);
      } else if (event.altKey && key === "r") {
        event.preventDefault();
        beginRename();
      } else if (event.shiftKey && key === "a") {
        event.preventDefault();
        void archive().catch(() => undefined);
      } else if (event.shiftKey && key === "c" && project?.roots.length) {
        event.preventDefault();
        void copyWorkingDirectory();
      } else if (event.altKey && key === "c") {
        event.preventDefault();
        void copySessionId();
      }
    };

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [
    archive,
    beginRename,
    copySessionId,
    copyWorkingDirectory,
    project?.roots.length,
    session,
    togglePin,
  ]);

  if (!session) return null;

  const SessionIcon = project ? Folder : MessagesSquare;

  return (
    <div
      className="flex min-w-0 flex-1 items-center gap-1"
      onContextMenu={handleContextMenu}
    >
      <SessionIcon className="mr-1 size-4 shrink-0" aria-hidden />
      {editing ? (
        <form
          className="w-fit min-w-0 max-w-[calc(100%-2rem)] shrink"
          onSubmit={handleRenameSubmit}
          title={renameError ?? undefined}
        >
          <input
            ref={inputRef}
            value={draft}
            maxLength={120}
            disabled={saving}
            aria-label="Chat name"
            aria-invalid={renameError ? "true" : undefined}
            style={{ fieldSizing: "content" }}
            className={cn(
              "h-7 w-auto min-w-[2ch] max-w-full rounded-md border-0 bg-background px-1 type-base text-foreground outline-none ring-1 ring-inset ring-border focus:ring-ring",
              renameError && "ring-negative focus:ring-negative",
            )}
            onBlur={() => void commitRename()}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={handleRenameKeyDown}
          />
          {renameError ? (
            <span role="alert" className="sr-only">
              {renameError}
            </span>
          ) : null}
        </form>
      ) : (
        <button
          type="button"
          aria-label={`Rename chat ${session.title}`}
          title="Rename chat"
          className="min-w-0 truncate rounded-md px-1 py-0.5 text-left type-base text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
          onClick={beginRename}
        >
          {session.title}
        </button>
      )}

      <NativeControlMenuButton
        open={menuOpen}
        onOpen={openSessionMenu}
        ariaLabel={`More actions for ${session.title}`}
        className="size-7 opacity-100"
      />
    </div>
  );
}
