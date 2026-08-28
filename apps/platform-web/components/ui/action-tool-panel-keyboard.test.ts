import { describe, expect, test } from "bun:test";
import {
  isActionToolPanelBackspaceShortcut,
  isEmptyInputBackspace,
} from "./action-tool-panel-keyboard";

function backspaceEvent(
  overrides: Partial<Parameters<typeof isEmptyInputBackspace>[0]> = {},
) {
  return {
    altKey: false,
    ctrlKey: false,
    defaultPrevented: false,
    key: "Backspace",
    metaKey: false,
    nativeEvent: { isComposing: false },
    repeat: false,
    shiftKey: false,
    ...overrides,
  };
}

describe("isEmptyInputBackspace", () => {
  test("navigates only from an empty input", () => {
    expect(isEmptyInputBackspace(backspaceEvent(), "")).toBe(true);
    expect(isEmptyInputBackspace(backspaceEvent(), "1")).toBe(false);
  });

  test("ignores modified, repeated, composing, and handled events", () => {
    for (const event of [
      backspaceEvent({ altKey: true }),
      backspaceEvent({ ctrlKey: true }),
      backspaceEvent({ defaultPrevented: true }),
      backspaceEvent({ key: "Delete" }),
      backspaceEvent({ metaKey: true }),
      backspaceEvent({ nativeEvent: { isComposing: true } }),
      backspaceEvent({ repeat: true }),
      backspaceEvent({ shiftKey: true }),
    ]) {
      expect(isEmptyInputBackspace(event, "")).toBe(false);
    }
  });
});

describe("isActionToolPanelBackspaceShortcut", () => {
  test("accepts an unmodified Backspace outside an editor", () => {
    expect(
      isActionToolPanelBackspaceShortcut({
        altKey: false,
        ctrlKey: false,
        defaultPrevented: false,
        isComposing: false,
        key: "Backspace",
        metaKey: false,
        repeat: false,
        shiftKey: false,
        target: null,
      }),
    ).toBe(true);
  });

  test("ignores modified, repeated, composing, and handled events", () => {
    const event = {
      altKey: false,
      ctrlKey: false,
      defaultPrevented: false,
      isComposing: false,
      key: "Backspace",
      metaKey: false,
      repeat: false,
      shiftKey: false,
      target: null,
    };

    for (const overrides of [
      { altKey: true },
      { ctrlKey: true },
      { defaultPrevented: true },
      { isComposing: true },
      { key: "Delete" },
      { metaKey: true },
      { repeat: true },
      { shiftKey: true },
    ]) {
      expect(
        isActionToolPanelBackspaceShortcut({ ...event, ...overrides }),
      ).toBe(false);
    }
  });
});
