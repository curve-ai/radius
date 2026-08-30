export const CHAT_TURN_TOP_GAP_PX = 24;
export const CHAT_RESPONSE_EDGE_GAP_PX = 24;
const CHAT_FOLLOW_CANCEL_KEYS = new Set([
  "ArrowUp",
  "ArrowDown",
  "PageUp",
  "PageDown",
  "Home",
  "End",
  " ",
]);

export function submittedTurnScrollLayout({
  anchorTop,
  composerHeight,
  contentEnd,
  viewportHeight,
}: {
  anchorTop: number;
  composerHeight: number;
  contentEnd: number;
  viewportHeight: number;
}): {
  anchorScrollTop: number;
  turnSpacerHeight: number;
} {
  const anchorScrollTop = Math.max(0, anchorTop - CHAT_TURN_TOP_GAP_PX);
  const baseBottomPadding = composerHeight + CHAT_RESPONSE_EDGE_GAP_PX;
  const turnSpacerHeight = Math.max(
    0,
    Math.ceil(
      anchorScrollTop + viewportHeight - contentEnd - baseBottomPadding,
    ),
  );

  return { anchorScrollTop, turnSpacerHeight };
}

export function isChatFollowCancelKey(key: string): boolean {
  return CHAT_FOLLOW_CANCEL_KEYS.has(key);
}
