export const ACTION_TOOL_PANEL_BACKSPACE_SHORTCUT = "Backspace";

type ActionToolPanelBackspaceEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "isComposing"
  | "key"
  | "metaKey"
  | "repeat"
  | "shiftKey"
  | "target"
>;

interface EmptyInputBackspaceEvent {
  altKey: boolean;
  ctrlKey: boolean;
  defaultPrevented: boolean;
  key: string;
  metaKey: boolean;
  nativeEvent: {
    isComposing: boolean;
  };
  repeat: boolean;
  shiftKey: boolean;
}

const ACTION_TOOL_PANEL_EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';

function isBlockedBackspaceTarget(target: EventTarget | null): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  const isEditable =
    target.isContentEditable ||
    Boolean(target.closest(ACTION_TOOL_PANEL_EDITABLE_SELECTOR));
  if (isEditable) return true;

  const dialog = target.closest('[role="dialog"]');
  return Boolean(dialog && !target.closest('[data-slot="action-tool-panel"]'));
}

export function isActionToolPanelBackspaceShortcut(
  event: ActionToolPanelBackspaceEvent,
): boolean {
  return (
    event.key === ACTION_TOOL_PANEL_BACKSPACE_SHORTCUT &&
    !event.defaultPrevented &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.isComposing &&
    !isBlockedBackspaceTarget(event.target)
  );
}

export function isEmptyInputBackspace(
  event: EmptyInputBackspaceEvent,
  value: string,
): boolean {
  return (
    value.length === 0 &&
    event.key === ACTION_TOOL_PANEL_BACKSPACE_SHORTCUT &&
    !event.defaultPrevented &&
    !event.repeat &&
    !event.altKey &&
    !event.ctrlKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !event.nativeEvent.isComposing
  );
}
