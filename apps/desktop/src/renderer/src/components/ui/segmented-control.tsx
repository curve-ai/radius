import { useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import {
  LayoutGroup,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import { cn } from "@renderer/lib/utils";

export interface SegmentedControlOption<T extends string> {
  id: T;
  label: string;
  disabled?: boolean;
}

interface SegmentedControlProps<T extends string> {
  options: ReadonlyArray<SegmentedControlOption<T>>;
  value: T;
  onChange: (value: T) => void;
  ariaLabel: string;
  className?: string;
  size?: "sm" | "md";
}

export function SegmentedControl<T extends string>({
  options,
  value,
  onChange,
  ariaLabel,
  className,
  size = "sm",
}: SegmentedControlProps<T>): ReactNode {
  const groupId = useId();
  const reducedMotion = useReducedMotion();
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const moveSelection = (
    event: KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void => {
    const enabledIndexes = options.flatMap((option, index) =>
      option.disabled ? [] : [index],
    );
    const enabledPosition = enabledIndexes.indexOf(currentIndex);
    if (enabledPosition === -1) return;

    let nextPosition: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextPosition = (enabledPosition + 1) % enabledIndexes.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextPosition =
        (enabledPosition - 1 + enabledIndexes.length) % enabledIndexes.length;
    } else if (event.key === "Home") {
      nextPosition = 0;
    } else if (event.key === "End") {
      nextPosition = enabledIndexes.length - 1;
    }

    if (nextPosition === null) return;
    event.preventDefault();
    const nextIndex = enabledIndexes[nextPosition];
    const nextOption = options[nextIndex];
    if (!nextOption) return;
    onChange(nextOption.id);
    buttonRefs.current[nextIndex]?.focus();
  };

  return (
    <LayoutGroup id={groupId}>
      <div
        role="tablist"
        aria-label={ariaLabel}
        className={cn(
          "relative inline-flex max-w-full items-center rounded-full border border-border bg-card p-0.5",
          className,
        )}
      >
        {options.map((option, index) => {
          const selected = value === option.id;
          return (
            <button
              key={option.id}
              ref={(element) => {
                buttonRefs.current[index] = element;
              }}
              type="button"
              role="tab"
              aria-selected={selected}
              tabIndex={selected ? 0 : -1}
              disabled={option.disabled}
              className={cn(
                "relative inline-flex shrink-0 items-center justify-center rounded-full text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50",
                size === "md" ? "h-8 px-4" : "h-7 px-3",
                selected
                  ? "text-foreground"
                  : "text-muted-foreground hover:text-foreground",
                option.disabled && "cursor-not-allowed opacity-50",
              )}
              onClick={() => onChange(option.id)}
              onKeyDown={(event) => moveSelection(event, index)}
            >
              {selected ? (
                <motion.span
                  layoutId="segmented-control-indicator"
                  className="absolute inset-0 rounded-full bg-accent"
                  transition={{
                    duration: reducedMotion ? 0 : 0.18,
                    ease: [0.23, 1, 0.32, 1],
                  }}
                  aria-hidden
                />
              ) : null}
              <span className="relative whitespace-nowrap">{option.label}</span>
            </button>
          );
        })}
      </div>
    </LayoutGroup>
  );
}
