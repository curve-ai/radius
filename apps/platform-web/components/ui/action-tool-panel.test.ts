import { describe, expect, test } from "bun:test";
import {
  actionToolPanelDesktopFits,
  actionToolPanelShellWidthClass,
  actionToolPanelShouldAnimate,
} from "./action-tool-panel";

describe("actionToolPanelShellWidthClass", () => {
  test("keeps the compact rail beside the minimum reader canvas", () => {
    expect(actionToolPanelDesktopFits(null, false)).toBe(false);
    expect(actionToolPanelDesktopFits(1003, false)).toBe(false);
    expect(actionToolPanelDesktopFits(1004, false)).toBe(true);
  });

  test("moves expanded tools to the popover until both panes fit", () => {
    expect(actionToolPanelDesktopFits(1151, true)).toBe(false);
    expect(actionToolPanelDesktopFits(1152, true)).toBe(true);
  });

  test("responds to the navigator width at the same viewport size", () => {
    const viewportWidth = 1280;

    expect(actionToolPanelDesktopFits(viewportWidth - 256, false)).toBe(true);
    expect(actionToolPanelDesktopFits(viewportWidth - 256, true)).toBe(false);
    expect(actionToolPanelDesktopFits(viewportWidth - 48, true)).toBe(true);
  });

  test("shares compact and expanded desktop widths", () => {
    expect(actionToolPanelShellWidthClass("desktop", false)).toContain(
      "w-[20.75rem]",
    );
    expect(actionToolPanelShellWidthClass("desktop", true)).toContain(
      "calc(100cqw-40rem)",
    );
  });

  test("keeps popover widths inside the viewport", () => {
    expect(actionToolPanelShellWidthClass("popover", false)).toContain(
      "calc(100vw-1.5rem)",
    );
    expect(actionToolPanelShellWidthClass("popover", true)).toContain(
      "w-[min(36rem",
    );
  });

  test("keeps keyboard and reduced-motion transitions immediate", () => {
    expect(actionToolPanelShouldAnimate(false, "animate")).toBe(true);
    expect(actionToolPanelShouldAnimate(null, "animate")).toBe(true);
    expect(actionToolPanelShouldAnimate(true, "animate")).toBe(false);
    expect(actionToolPanelShouldAnimate(false, "instant")).toBe(false);
  });
});
