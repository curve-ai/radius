import { FolderOpen, Search, SquarePen } from "lucide-react";
import { useMemo, useState, type KeyboardEvent, type ReactNode } from "react";

import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import {
  type WorkspaceSessionRecord,
  useProjects,
} from "@renderer/components/shell/project-context-value";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { cn } from "@renderer/lib/utils";
import { SessionStatus } from "./session-status";
import { useStartNewChat } from "./use-start-new-chat";

type SessionSearchItem = WorkspaceSessionRecord & {
  projectName: string;
};

function Shortcut({ children }: { children: ReactNode }): ReactNode {
  return (
    <span className="ml-auto shrink-0">
      <kbd className="ml-1 inline-flex rounded-md bg-muted px-1.5 py-0.5 font-sans text-xs font-normal leading-none tabular-nums text-muted-foreground">
        {children}
      </kbd>
    </span>
  );
}

export function WorkspaceSearchDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}): ReactNode {
  const { navigate } = useWorkspaceNavigation();
  const {
    error,
    loading,
    openCreateProjectDialog,
    projects,
    recents,
    selectSession,
  } = useProjects();
  const startNewChat = useStartNewChat();
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const commandKey = window.radius.platform === "darwin" ? "⌘" : "Ctrl ";
  const sessions = useMemo<SessionSearchItem[]>(
    () =>
      [
        ...projects.flatMap((project) =>
          project.sessions.map((session) => ({
            ...session,
            projectName: project.name,
          })),
        ),
        ...recents.map((session) => ({
          ...session,
          projectName: "Recents",
        })),
      ].sort((left, right) => {
        if (left.pinnedAt && right.pinnedAt) {
          return Date.parse(right.pinnedAt) - Date.parse(left.pinnedAt);
        }
        if (left.pinnedAt) return -1;
        if (right.pinnedAt) return 1;
        return Date.parse(right.updatedAt) - Date.parse(left.updatedAt);
      }),
    [projects, recents],
  );
  const filteredChats = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    if (!normalizedQuery) return sessions.slice(0, 9);

    return sessions
      .filter((session) =>
        `${session.title} ${session.projectName}`
          .toLocaleLowerCase()
          .includes(normalizedQuery),
      )
      .slice(0, 9);
  }, [query, sessions]);

  const closeDialog = (): void => onOpenChange(false);

  const handleOpenChange = (nextOpen: boolean): void => {
    onOpenChange(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setActiveIndex(0);
    }
  };

  const handleInputKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    const shortcutIndex = Number(event.key) - 1;
    if (
      (event.metaKey || event.ctrlKey) &&
      shortcutIndex >= 0 &&
      shortcutIndex < filteredChats.length
    ) {
      event.preventDefault();
      openSession(filteredChats[shortcutIndex]);
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredChats.length === 0 ? 0 : (current + 1) % filteredChats.length,
      );
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) =>
        filteredChats.length === 0
          ? 0
          : (current - 1 + filteredChats.length) % filteredChats.length,
      );
    }
    if (event.key === "Enter" && filteredChats[activeIndex]) {
      event.preventDefault();
      openSession(filteredChats[activeIndex]);
    }
  };

  const openSession = (session: SessionSearchItem): void => {
    selectSession(session.id);
    navigate("workspace");
    closeDialog();
  };

  const handleStartNewChat = (): void => {
    startNewChat();
    closeDialog();
  };

  const openProjectFolder = (): void => {
    closeDialog();
    openCreateProjectDialog();
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        showCloseButton={false}
        overlayClassName="bg-black/15 dark:bg-black/55"
        className="max-h-[calc(100dvh-3rem)] w-[calc(100%-2rem)] gap-0 overflow-hidden rounded-lg border-border/70 bg-background p-2 shadow-xl sm:max-w-[32.5rem]"
      >
        <DialogTitle className="sr-only">Search chats</DialogTitle>
        <DialogDescription className="sr-only">
          Search recent Radius chats or choose a quick action.
        </DialogDescription>

        <input
          autoFocus
          type="search"
          value={query}
          placeholder="Search chats"
          aria-label="Search chats"
          className="h-11 w-full bg-transparent px-2 text-base text-foreground outline-none placeholder:text-muted-foreground"
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
          }}
          onKeyDown={handleInputKeyDown}
        />

        <div className="min-h-0 overflow-y-auto">
          <p className="px-2 pb-1 pt-0.5 text-sm text-muted-foreground">
            Chats
          </p>
          <div role="listbox" aria-label="Chats" className="space-y-0.5">
            {filteredChats.map((chat, index) => (
              <button
                key={chat.id}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={cn(
                  "flex h-8 w-full items-center rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors focus-visible:ring-1 focus-visible:ring-ring",
                  index === activeIndex && "bg-accent",
                )}
                onClick={() => openSession(chat)}
                onMouseEnter={() => setActiveIndex(index)}
              >
                <SessionStatus status={chat.status} />
                <span className="min-w-0 flex-1 truncate">{chat.title}</span>
                <span className="ml-4 w-24 shrink-0 truncate text-right text-muted-foreground">
                  {chat.projectName}
                </span>
                <Shortcut>
                  {commandKey}
                  {index + 1}
                </Shortcut>
              </button>
            ))}
            {loading && sessions.length === 0 ? (
              <p className="px-7 py-6 text-sm text-muted-foreground">
                Loading chats…
              </p>
            ) : error && sessions.length === 0 ? (
              <p className="px-7 py-6 text-sm text-negative">{error}</p>
            ) : filteredChats.length === 0 ? (
              <p className="px-7 py-1.5 text-sm text-muted-foreground">
                {query.trim() ? "No chats found." : "No chats yet."}
              </p>
            ) : null}
          </div>

          <p className="px-2 pb-1 pt-3 text-sm text-muted-foreground">
            Quick actions
          </p>
          <div className="space-y-0.5 pb-0.5">
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              onClick={handleStartNewChat}
            >
              <SquarePen
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              <span>New chat</span>
              <Shortcut>{commandKey}N</Shortcut>
            </button>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              onClick={openProjectFolder}
            >
              <FolderOpen
                className="size-3.5 text-muted-foreground"
                aria-hidden
              />
              <span>Open folder</span>
              <Shortcut>{commandKey}O</Shortcut>
            </button>
            <button
              type="button"
              className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-1 focus-visible:ring-ring"
              onClick={closeDialog}
            >
              <Search className="size-3.5 text-muted-foreground" aria-hidden />
              <span>Search files</span>
              <Shortcut>{commandKey}P</Shortcut>
            </button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
