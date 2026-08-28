type ResearchShellShortcutEvent = Pick<
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

const RESEARCH_SHELL_EDITABLE_SELECTOR =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"], [role="dialog"]';

function isPrimaryModifierShortcut(event: ResearchShellShortcutEvent): boolean {
  return (
    !event.defaultPrevented &&
    !event.isComposing &&
    !event.repeat &&
    !event.altKey &&
    !event.shiftKey &&
    (event.metaKey || event.ctrlKey)
  );
}

function isResearchShellEditableTarget(
  target: ResearchShellShortcutEvent["target"],
): boolean {
  if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement)) {
    return false;
  }

  return (
    target.isContentEditable ||
    Boolean(target.closest(RESEARCH_SHELL_EDITABLE_SELECTOR))
  );
}

export function isNavigatorToggleShortcut(
  event: ResearchShellShortcutEvent,
): boolean {
  return isPrimaryModifierShortcut(event) && event.key.toLowerCase() === "b";
}

export function isToolPanelToggleShortcut(
  event: ResearchShellShortcutEvent,
): boolean {
  return isPrimaryModifierShortcut(event) && event.key === "/";
}

export function isResearchShellCommandSearchShortcut(
  event: ResearchShellShortcutEvent,
): boolean {
  return (
    isPrimaryModifierShortcut(event) &&
    event.key.toLowerCase() === "k" &&
    !isResearchShellEditableTarget(event.target)
  );
}

export function shouldIgnoreResearchShellSingleKeyShortcut(
  event: ResearchShellShortcutEvent,
): boolean {
  if (
    event.defaultPrevented ||
    event.isComposing ||
    event.repeat ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey
  ) {
    return true;
  }

  return isResearchShellEditableTarget(event.target);
}
