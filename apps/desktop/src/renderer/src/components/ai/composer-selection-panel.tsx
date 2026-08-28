import { Check, ChevronRight } from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import {
  ActionToolPanelButton,
  ActionToolPanelGroup,
  ActionToolPanelItem,
  ActionToolPanelItemContent,
  ActionToolPanelItemLabel,
  ActionToolPanelItemMeta,
} from "@renderer/components/ui/action-tool-panel";
import { Button } from "@renderer/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";

const SELECTION_VALUE_EASE = [0.23, 1, 0.32, 1] as const;

export type ComposerSelectionOption = {
  id: string;
  label: string;
};

export type ComposerSelectionItem = {
  emptyState: {
    actionHref?: string;
    actionLabel: string;
  };
  id: string;
  label: string;
  onSelect: (optionId: string) => void;
  options: readonly ComposerSelectionOption[];
  selectedOptionId: string | null;
  valueLabel: string;
};

export function ComposerSelectionPanel({
  items,
  openItemId,
  onOpenItemChange,
  onRequestClose,
}: {
  items: readonly ComposerSelectionItem[];
  openItemId: string | null;
  onOpenItemChange: (itemId: string | null) => void;
  onRequestClose: () => void;
}): ReactNode {
  const reduceMotion = useReducedMotion();
  const openMethodRef = useRef<"keyboard" | "pointer">("pointer");
  const valueEnterTransform =
    reduceMotion === true ? "translateY(0px)" : "translateY(2px)";
  const valueExitTransform =
    reduceMotion === true ? "translateY(0px)" : "translateY(-2px)";

  const markKeyboardOpen = (
    event: KeyboardEvent<HTMLButtonElement>,
    itemId: string,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      openMethodRef.current = "keyboard";
      return;
    }

    if (event.key === "ArrowRight") {
      event.preventDefault();
      openMethodRef.current = "keyboard";
      onOpenItemChange(itemId);
    }
  };

  return (
    <PopoverContent
      side="top"
      align="end"
      sideOffset={8}
      collisionPadding={12}
      className="w-72 rounded-[1rem]"
    >
      <ActionToolPanelGroup className="p-0">
        {items.map((item) => {
          const categoryLabel = (
            <ActionToolPanelItemContent>
              <ActionToolPanelItemLabel>{item.label}</ActionToolPanelItemLabel>
            </ActionToolPanelItemContent>
          );
          const categoryMeta = (
            <>
              <ActionToolPanelItemMeta
                aria-hidden
                className="relative max-w-32 overflow-hidden text-sm group-hover/action-tool-button:text-muted-foreground group-focus-visible/action-tool-button:text-muted-foreground"
              >
                <AnimatePresence initial={false} mode="popLayout">
                  <motion.span
                    key={item.valueLabel}
                    initial={{
                      opacity: 0,
                      transform: valueEnterTransform,
                    }}
                    animate={{ opacity: 1, transform: "translateY(0px)" }}
                    exit={{
                      opacity: 0,
                      transform: valueExitTransform,
                      transition: {
                        duration: 0.1,
                        ease: SELECTION_VALUE_EASE,
                      },
                    }}
                    transition={{
                      duration: reduceMotion === true ? 0.1 : 0.16,
                      ease: SELECTION_VALUE_EASE,
                    }}
                    className="block truncate"
                  >
                    {item.valueLabel}
                  </motion.span>
                </AnimatePresence>
              </ActionToolPanelItemMeta>
              <span className="sr-only">{item.valueLabel}</span>
            </>
          );

          if (item.options.length < 2) {
            return (
              <ActionToolPanelItem
                key={item.id}
                className="min-h-9 gap-2 px-2 py-1"
              >
                {categoryLabel}
                {item.options.length === 0 && item.emptyState.actionHref ? (
                  <Button
                    asChild
                    variant="link"
                    size="sm"
                    className="h-auto max-w-40 shrink-0 justify-end truncate p-0 text-sm text-muted-foreground"
                  >
                    <a
                      href={item.emptyState.actionHref}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {item.emptyState.actionLabel}
                    </a>
                  </Button>
                ) : (
                  categoryMeta
                )}
              </ActionToolPanelItem>
            );
          }

          return (
            <Popover
              key={item.id}
              open={openItemId === item.id}
              onOpenChange={(nextOpen) =>
                onOpenItemChange(nextOpen ? item.id : null)
              }
            >
              <PopoverTrigger asChild>
                <ActionToolPanelButton
                  type="button"
                  className="min-h-9 rounded-md px-2 py-1"
                  onPointerEnter={() => {
                    openMethodRef.current = "pointer";
                    onOpenItemChange(item.id);
                  }}
                  onKeyDown={(event) => markKeyboardOpen(event, item.id)}
                  onClick={(event) => {
                    event.preventDefault();
                    const selectedIndex = item.options.findIndex(
                      (option) => option.id === item.selectedOptionId,
                    );
                    const nextIndex =
                      selectedIndex < 0
                        ? 0
                        : (selectedIndex + 1) % item.options.length;
                    const nextOption = item.options[nextIndex];
                    if (nextOption) item.onSelect(nextOption.id);
                  }}
                >
                  {categoryLabel}
                  {categoryMeta}
                  <ChevronRight
                    className="size-4 shrink-0 text-muted-foreground"
                    aria-hidden
                  />
                </ActionToolPanelButton>
              </PopoverTrigger>
              <PopoverContent
                side="right"
                align="center"
                sideOffset={4}
                collisionPadding={12}
                className="w-72 rounded-[1rem]"
                onOpenAutoFocus={(event) => {
                  if (openMethodRef.current === "pointer") {
                    event.preventDefault();
                  }
                }}
              >
                <ActionToolPanelGroup className="gap-px p-0">
                  {item.options.map((option) => {
                    const selected = option.id === item.selectedOptionId;
                    return (
                      <ActionToolPanelButton
                        key={option.id}
                        type="button"
                        selected={selected}
                        className="min-h-9 items-center rounded-md px-2 py-1"
                        onClick={() => {
                          item.onSelect(option.id);
                          onRequestClose();
                        }}
                      >
                        <ActionToolPanelItemContent>
                          <ActionToolPanelItemLabel className="truncate">
                            {option.label}
                          </ActionToolPanelItemLabel>
                        </ActionToolPanelItemContent>
                        {selected ? (
                          <Check
                            className="size-4 shrink-0 text-muted-foreground"
                            aria-hidden
                          />
                        ) : null}
                      </ActionToolPanelButton>
                    );
                  })}
                </ActionToolPanelGroup>
              </PopoverContent>
            </Popover>
          );
        })}
      </ActionToolPanelGroup>
    </PopoverContent>
  );
}
