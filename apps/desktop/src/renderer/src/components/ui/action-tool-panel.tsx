"use client";

import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { Separator } from "@renderer/components/ui/separator";
import { motion, useReducedMotion } from "@renderer/components/ui/motion";
import { cn } from "@renderer/lib/utils";

const ACTION_TOOL_PANEL_MIN_CANVAS_WIDTH_PX = 640;
const ACTION_TOOL_PANEL_COMPACT_WIDTH_PX = 332;
const ACTION_TOOL_PANEL_COMPACT_CLEARANCE_PX = 32;
const ACTION_TOOL_PANEL_EXPANDED_MIN_WIDTH_PX = 512;

type ActionToolPanelSurface = "desktop" | "popover";
type ActionToolPanelTransitionBehavior = "animate" | "instant";

const ACTION_TOOL_PANEL_EASE = [0.23, 1, 0.32, 1] as const;

const ACTION_TOOL_PANEL_VIEWPORT_CLASS =
  "flex max-h-[calc(100dvh-5rem)] flex-col";

export function actionToolPanelShellWidthClass(
  surface: ActionToolPanelSurface,
  expanded: boolean,
): string {
  if (surface === "desktop") {
    return expanded
      ? "w-[max(32rem,min(44cqw,42rem,calc(100cqw-40rem)))]"
      : "w-[20.75rem] min-[1680px]:w-[21rem]";
  }

  return expanded
    ? "w-[min(36rem,calc(100vw-1.5rem))]"
    : "w-[min(19rem,calc(100vw-1.5rem))]";
}

export function actionToolPanelDesktopFits(
  workbenchWidth: number | null,
  expanded: boolean,
): boolean {
  if (workbenchWidth === null) return false;

  const panelWidth = expanded
    ? ACTION_TOOL_PANEL_EXPANDED_MIN_WIDTH_PX
    : ACTION_TOOL_PANEL_COMPACT_WIDTH_PX +
      ACTION_TOOL_PANEL_COMPACT_CLEARANCE_PX;

  return workbenchWidth >= ACTION_TOOL_PANEL_MIN_CANVAS_WIDTH_PX + panelWidth;
}

export function actionToolPanelShouldAnimate(
  reduceMotion: boolean | null,
  behavior: ActionToolPanelTransitionBehavior,
): boolean {
  return reduceMotion !== true && behavior === "animate";
}

function ActionToolPanel({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel"
      className={cn(
        "overflow-hidden rounded-2xl border border-border bg-transparent text-popover-foreground shadow-md",
        className,
      )}
      {...props}
    />
  );
}

interface ActionToolPanelShellProps extends Omit<
  React.ComponentProps<typeof motion.div>,
  "children"
> {
  surface: ActionToolPanelSurface;
  expanded?: boolean;
  panelClassName?: string;
  sharedLayoutId?: string;
  transitionBehavior?: ActionToolPanelTransitionBehavior;
  children: React.ReactNode;
}

/**
 * Shared viewport shell for every compact and expanded research-tool mode.
 * Width, height, margins, and popover background live here so search, filing
 * evidence, and future detail views cannot drift into separate panel shells.
 */
function ActionToolPanelShell({
  surface,
  expanded = false,
  panelClassName,
  sharedLayoutId,
  transitionBehavior = "animate",
  className,
  style,
  children,
  ...props
}: ActionToolPanelShellProps) {
  const reduceMotion = useReducedMotion();
  const animateLayout = actionToolPanelShouldAnimate(
    reduceMotion,
    transitionBehavior,
  );

  return (
    <motion.div
      data-slot="action-tool-panel-shell"
      data-surface={surface}
      data-expanded={expanded ? "true" : "false"}
      layout={animateLayout ? "size" : false}
      layoutId={animateLayout ? sharedLayoutId : undefined}
      transition={{
        layout: {
          duration: 0.18,
          ease: ACTION_TOOL_PANEL_EASE,
        },
      }}
      style={{ transformOrigin: "top right", ...style }}
      className={cn(
        actionToolPanelShellWidthClass(surface, expanded),
        surface === "desktop" &&
          "sticky top-14 shrink-0 self-start pb-3 pl-3 pr-4 pt-3 min-[1680px]:pl-4",
        className,
      )}
      {...props}
    >
      <ActionToolPanel
        className={cn(
          ACTION_TOOL_PANEL_VIEWPORT_CLASS,
          surface === "popover" && "bg-background",
          expanded && "h-[calc(100dvh-5rem)]",
          panelClassName,
        )}
      >
        {children}
      </ActionToolPanel>
    </motion.div>
  );
}

function ActionToolPanelHeader({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-header"
      className={cn(
        "flex min-h-11 items-center justify-between gap-3 px-3 py-2.5",
        className,
      )}
      {...props}
    />
  );
}

function ActionToolPanelTitle({
  className,
  ...props
}: React.ComponentProps<"h2">) {
  return (
    <h2
      data-slot="action-tool-panel-title"
      className={cn("text-sm font-normal text-muted-foreground", className)}
      {...props}
    />
  );
}

function ActionToolPanelContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-content"
      className={cn(
        "flex min-h-0 flex-col overflow-x-hidden overflow-y-auto overscroll-contain",
        className,
      )}
      {...props}
    />
  );
}

interface ActionToolPanelLoadTransitionProps {
  loading: boolean;
  fallback: React.ReactNode;
  children: React.ReactNode;
}

function ActionToolPanelLoadTransition({
  loading,
  fallback,
  children,
}: ActionToolPanelLoadTransitionProps) {
  const [showFallback, setShowFallback] = React.useState(loading);
  const [showReady, setShowReady] = React.useState(false);

  React.useEffect(() => {
    let readyFrame: number | undefined;
    let fallbackTimeout: number | undefined;

    if (loading) {
      setShowFallback(true);
      setShowReady(false);
    } else {
      setShowFallback(true);
      setShowReady(false);
      readyFrame = window.requestAnimationFrame(() => setShowReady(true));
      fallbackTimeout = window.setTimeout(() => setShowFallback(false), 100);
    }

    return () => {
      if (readyFrame !== undefined) {
        window.cancelAnimationFrame(readyFrame);
      }
      if (fallbackTimeout !== undefined) {
        window.clearTimeout(fallbackTimeout);
      }
    };
  }, [loading]);

  return (
    <div
      data-slot="action-tool-panel-load-transition"
      className="grid min-h-0 flex-1"
    >
      {(loading || showFallback) && (
        <div
          aria-hidden={!loading}
          inert={!loading}
          className={cn(
            "col-start-1 row-start-1 flex min-h-0 flex-col transition-opacity duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:duration-100 [&>[data-slot=action-tool-panel-content]]:flex-1",
            loading ? "opacity-100" : "pointer-events-none opacity-0",
          )}
        >
          {fallback}
        </div>
      )}

      {!loading && (
        <div
          aria-hidden={!showReady}
          inert={!showReady}
          className={cn(
            "col-start-1 row-start-1 flex min-h-0 flex-col transition-[opacity,transform] duration-[160ms] ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transform-none motion-reduce:duration-100 [&>[data-slot=action-tool-panel-content]]:flex-1",
            showReady
              ? "translate-y-0 opacity-100"
              : "pointer-events-none translate-y-0.5 opacity-0",
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function handleActionToolPanelGroupKeyDown(
  event: React.KeyboardEvent<HTMLDivElement>,
) {
  if (
    event.defaultPrevented ||
    event.altKey ||
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    !["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
  ) {
    return;
  }

  const target = event.target;
  if (!(target instanceof HTMLElement)) return;

  const currentItem = target.closest<HTMLElement>(
    '[data-slot="action-tool-panel-button"]',
  );
  if (!currentItem || !event.currentTarget.contains(currentItem)) return;

  const items = Array.from(
    event.currentTarget.querySelectorAll<HTMLElement>(
      '[data-slot="action-tool-panel-button"]:not([disabled])',
    ),
  ).filter(
    (item) =>
      item.getAttribute("aria-disabled") !== "true" &&
      item.closest("[inert]") === null,
  );
  const currentIndex = items.indexOf(currentItem);
  if (currentIndex < 0 || items.length < 2) return;

  let nextIndex: number;
  if (event.key === "Home") {
    nextIndex = 0;
  } else if (event.key === "End") {
    nextIndex = items.length - 1;
  } else {
    const direction = event.key === "ArrowDown" ? 1 : -1;
    nextIndex = (currentIndex + direction + items.length) % items.length;
  }

  event.preventDefault();
  items[nextIndex]?.focus();
}

function ActionToolPanelGroup({
  className,
  onKeyDown,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-group"
      className={cn("flex flex-col gap-px p-3 md:p-1.5", className)}
      onKeyDown={(event) => {
        onKeyDown?.(event);
        handleActionToolPanelGroupKeyDown(event);
      }}
      {...props}
    />
  );
}

function ActionToolPanelGroupLabel({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-group-label"
      className={cn(
        "px-2 pb-2 pt-1 text-sm font-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

interface ActionToolPanelButtonProps extends React.ComponentPropsWithoutRef<"button"> {
  asChild?: boolean;
  selected?: boolean;
}

function ActionToolPanelButton({
  asChild = false,
  selected,
  className,
  ...props
}: ActionToolPanelButtonProps) {
  const Comp = asChild ? Slot : "button";

  return (
    <Comp
      data-slot="action-tool-panel-button"
      data-selected={selected ? "true" : "false"}
      aria-current={asChild && selected ? "page" : undefined}
      aria-pressed={!asChild && selected !== undefined ? selected : undefined}
      className={cn(
        "group/action-tool-button flex min-h-11 w-full items-center gap-3 rounded-xl px-2 py-2 text-left text-sm text-foreground transition-[background-color,color,transform] duration-100 ease-[cubic-bezier(0.23,1,0.32,1)] hover:bg-accent hover:text-foreground focus-visible:bg-accent focus-visible:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98] motion-reduce:transition-none data-[selected=true]:bg-accent data-[selected=true]:text-foreground md:min-h-8 md:gap-2 md:py-1",
        className,
      )}
      {...props}
    />
  );
}

function ActionToolPanelItem({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-item"
      className={cn(
        "flex min-h-11 items-center gap-3 rounded-md px-2 py-1.5",
        className,
      )}
      {...props}
    />
  );
}

function ActionToolPanelItemIcon({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="action-tool-panel-item-icon"
      className={cn(
        "flex size-7 shrink-0 items-center justify-center text-foreground md:size-5 [&_svg]:size-4 md:[&_svg]:size-3.5",
        className,
      )}
      {...props}
    />
  );
}

function ActionToolPanelItemContent({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-item-content"
      className={cn("min-w-0 flex-1", className)}
      {...props}
    />
  );
}

function ActionToolPanelItemLabel({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="action-tool-panel-item-label"
      className={cn("block text-sm font-normal text-foreground", className)}
      {...props}
    />
  );
}

function ActionToolPanelItemMeta({
  className,
  ...props
}: React.ComponentProps<"span">) {
  return (
    <span
      data-slot="action-tool-panel-item-meta"
      className={cn(
        "shrink-0 text-xs font-normal text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ActionToolPanelShortcut({
  className,
  ...props
}: React.ComponentProps<"kbd">) {
  return (
    <kbd
      data-slot="action-tool-panel-shortcut"
      aria-hidden
      className={cn(
        "inline-flex h-5 min-w-5 shrink-0 items-center justify-center rounded border border-border bg-background px-1.5 font-sans text-[10px] font-normal leading-none text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}

function ActionToolPanelFooter({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="action-tool-panel-footer"
      className={cn("flex min-h-11 items-center gap-3 px-4 py-2.5", className)}
      {...props}
    />
  );
}

function ActionToolPanelSeparator({
  className,
  ...props
}: React.ComponentProps<typeof Separator>) {
  return (
    <div className="px-3">
      <Separator
        data-slot="action-tool-panel-separator"
        className={className}
        {...props}
      />
    </div>
  );
}

export {
  ActionToolPanel,
  ActionToolPanelButton,
  ActionToolPanelContent,
  ActionToolPanelFooter,
  ActionToolPanelGroup,
  ActionToolPanelGroupLabel,
  ActionToolPanelHeader,
  ActionToolPanelItem,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
  ActionToolPanelItemMeta,
  ActionToolPanelLoadTransition,
  ActionToolPanelShortcut,
  ActionToolPanelSeparator,
  ActionToolPanelShell,
  ActionToolPanelTitle,
};
export type { ActionToolPanelSurface };
export type { ActionToolPanelTransitionBehavior };
