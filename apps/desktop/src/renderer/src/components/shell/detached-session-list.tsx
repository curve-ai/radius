import type { ReactNode } from "react";
import { useChatWindow } from "./chat-window-context";
import { useProjects } from "./project-context-value";
import { SessionSidebarRow } from "./workspace-session-list";
import { showSessionActionMenu } from "./session-action-menu-actions";
import {
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
} from "@renderer/components/ui/sidebar";
import type {
  NativeControlMenuPoint,
  ProjectSessionSummary,
} from "../../../../radius-api";

export function DetachedSessionList(): ReactNode {
  const { state, reportError } = useChatWindow();
  const {
    projects,
    recents,
    activeSession,
    selectSession,
    isSessionUnread,
    setSessionPinned,
    archiveSession,
    markSessionsUnread,
    requestSessionRename,
    loading,
  } = useProjects();
  const all = [...projects.flatMap((project) => project.sessions), ...recents];
  const menu = (
    session: ProjectSessionSummary,
    point: NativeControlMenuPoint,
  ): void => {
    const project = projects.find((candidate) =>
      candidate.sessions.some((item) => item.id === session.id),
    );
    void showSessionActionMenu(
      {
        canMarkUnread: session.lastAssistantMessageAt !== null,
        pinned: session.pinnedAt !== null,
        sessionId: session.id,
        title: session.title,
        workingDirectories: project?.roots.map((root) => root.rootPath) ?? [],
        onArchive: () => archiveSession(session.id),
        onMarkUnread: () => markSessionsUnread([session.id]),
        onRename: () => {
          selectSession(session.id);
          requestSessionRename(session.id);
        },
        onTogglePin: () =>
          setSessionPinned(session.id, session.pinnedAt === null),
      },
      point,
    ).catch(reportError);
  };
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <SidebarGroup className="pt-1">
        <SidebarGroupLabel className="font-normal">Chats</SidebarGroupLabel>
        <SidebarGroupContent>
          <SidebarMenu aria-label="Detached chats">
            {state.sessionIds.map((id) => {
              const session = all.find((item) => item.id === id);
              return session ? (
                <SessionSidebarRow
                  key={id}
                  session={session}
                  active={activeSession?.session.id === id}
                  layoutIntent={null}
                  pending={false}
                  unread={isSessionUnread(id)}
                  onSelect={selectSession}
                  onOpenMenu={menu}
                  onClose={(item) =>
                    void window.radius.chatWindows
                      .close(item.id)
                      .catch(reportError)
                  }
                  onArchive={(item) =>
                    void archiveSession(item.id).catch(reportError)
                  }
                  onSetPinned={(item) =>
                    void setSessionPinned(
                      item.id,
                      item.pinnedAt === null,
                    ).catch(reportError)
                  }
                />
              ) : null;
            })}
          </SidebarMenu>
        </SidebarGroupContent>
        {loading ? (
          <p role="status" className="px-2 py-2 text-sm text-muted-foreground">
            Loading chats…
          </p>
        ) : null}
      </SidebarGroup>
    </div>
  );
}
