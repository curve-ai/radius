type ShellShortcutEvent = Pick<
  KeyboardEvent,
  | "altKey"
  | "ctrlKey"
  | "defaultPrevented"
  | "isComposing"
  | "key"
  | "metaKey"
  | "repeat"
  | "shiftKey"
>;

function isPrimaryModifierShortcut(event: ShellShortcutEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey)
  );
}

export function isNavigatorToggleShortcut(event: ShellShortcutEvent): boolean {
  return isPrimaryModifierShortcut(event) && event.key.toLowerCase() === "b";
}

export function isToolPanelToggleShortcut(event: ShellShortcutEvent): boolean {
  return isPrimaryModifierShortcut(event) && event.key === "/";
}
