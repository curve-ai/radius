import {
  Archive,
  Check,
  Ellipsis,
  Folder,
  Pin,
  SquarePen,
  X,
  type LucideIcon,
} from "lucide-react";
import { useState, type ReactNode } from "react";

import {
  ActionToolPanelButton,
  ActionToolPanelGroup,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
  ActionToolPanelSeparator,
} from "@renderer/components/ui/action-tool-panel";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";

function ProjectActionRow({
  icon: Icon,
  label,
  disabledReason,
  onSelect,
}: {
  icon: LucideIcon;
  label: string;
  disabledReason?: string;
  onSelect?: () => void;
}): ReactNode {
  const disabled = Boolean(disabledReason);
  return (
    <ActionToolPanelButton
      type="button"
      disabled={disabled}
      title={disabledReason}
      className="rounded-md px-2.5"
      onClick={onSelect}
    >
      <ActionToolPanelItemIcon>
        <Icon aria-hidden />
      </ActionToolPanelItemIcon>
      <ActionToolPanelItemContent>
        <ActionToolPanelItemLabel>{label}</ActionToolPanelItemLabel>
      </ActionToolPanelItemContent>
    </ActionToolPanelButton>
  );
}

export function ProjectActionMenu({
  projectName,
  hasUnreadChats,
  pinned,
  revealAvailable,
  onEdit,
  onMarkAllRead,
  onReveal,
  onTogglePin,
}: {
  projectName: string;
  hasUnreadChats: boolean;
  pinned: boolean;
  revealAvailable: boolean;
  onEdit: () => void;
  onMarkAllRead: () => void;
  onReveal: () => void;
  onTogglePin: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const select = (action: () => void): void => {
    action();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`More actions for ${projectName}`}
          title="More actions"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/project:opacity-100 group-focus-within/project:opacity-100 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
        >
          <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        aria-label={`${projectName} actions`}
        className="w-60 rounded-lg border-border/70 bg-popover p-1.5 shadow-xl"
      >
        <ActionToolPanelGroup className="p-0">
          <ProjectActionRow
            icon={Pin}
            label={pinned ? "Unpin" : "Pin"}
            onSelect={() => select(onTogglePin)}
          />
          <ProjectActionRow
            icon={SquarePen}
            label="Rename"
            onSelect={() => select(onEdit)}
          />
          <ActionToolPanelSeparator className="my-1" />
          <ProjectActionRow
            icon={Folder}
            label="Reveal in Finder"
            disabledReason={
              revealAvailable ? undefined : "Link a local folder first"
            }
            onSelect={revealAvailable ? () => select(onReveal) : undefined}
          />
          <ActionToolPanelSeparator className="my-1" />
          <ProjectActionRow
            icon={Check}
            label="Mark all as read"
            disabledReason={hasUnreadChats ? undefined : "No unread chats"}
            onSelect={hasUnreadChats ? () => select(onMarkAllRead) : undefined}
          />
          <ProjectActionRow
            icon={Archive}
            label="Archive chats"
            disabledReason="Project chat archiving is not implemented yet"
          />
          <ActionToolPanelSeparator className="my-1" />
          <ProjectActionRow
            icon={X}
            label="Remove project"
            disabledReason="Project removal semantics are not defined yet"
          />
        </ActionToolPanelGroup>
      </PopoverContent>
    </Popover>
  );
}

export function RecentsActionMenu({
  hasUnreadChats,
  onMarkAllRead,
}: {
  hasUnreadChats: boolean;
  onMarkAllRead: () => void;
}): ReactNode {
  const [open, setOpen] = useState(false);
  const select = (action: () => void): void => {
    action();
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="More actions for Recents"
          title="More actions"
          className="flex size-6 items-center justify-center rounded-md text-muted-foreground opacity-0 outline-none transition-[background-color,color,opacity] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:opacity-100 focus-visible:ring-1 focus-visible:ring-sidebar-ring group-hover/recents:opacity-100 group-focus-within/recents:opacity-100 data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground data-[state=open]:opacity-100"
        >
          <Ellipsis className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="right"
        align="start"
        sideOffset={6}
        collisionPadding={8}
        aria-label="Recents actions"
        className="w-60 rounded-lg border-border/70 bg-popover p-1.5 shadow-xl"
      >
        <ActionToolPanelGroup className="p-0">
          <ProjectActionRow
            icon={Check}
            label="Mark all as read"
            disabledReason={hasUnreadChats ? undefined : "No unread chats"}
            onSelect={hasUnreadChats ? () => select(onMarkAllRead) : undefined}
          />
          <ActionToolPanelSeparator className="my-1" />
          <ProjectActionRow
            icon={Archive}
            label="Archive chats"
            disabledReason="Bulk chat archiving needs a recovery view first"
          />
        </ActionToolPanelGroup>
      </PopoverContent>
    </Popover>
  );
}
