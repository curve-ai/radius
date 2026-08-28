import * as React from "react"
import { cn } from "@/lib/utils"

type HotkeyBadgeVariant = "header" | "footer"

interface HotkeyBadgeProps extends React.HTMLAttributes<HTMLDivElement> {
  /**
   * The keyboard shortcut to display (e.g., "G then H", "⌘K", "/")
   * Can be a string or array of key parts
   */
  keys: string | string[]
  /**
   * Visual variant
   * - "header": Semi-transparent background, suitable for primary colored buttons
   * - "footer": Solid white background with border, suitable for muted buttons
   */
  variant?: HotkeyBadgeVariant
  /**
   * Text to display between keys (default: "then")
   */
  separator?: string
}

const HotkeyBadge = React.forwardRef<HTMLDivElement, HotkeyBadgeProps>(
  ({ className, keys, variant = "header", separator = "then", ...props }, ref) => {
    // Convert keys to array if it's a string
    const keyArray = typeof keys === "string" ? keys.split(" ") : keys

    const variantStyles = {
      header: "bg-foreground/10 text-foreground/70",
      footer: "border bg-secondary text-secondary-foreground",
    }

    return (
      <div
        ref={ref}
        className={cn(
          "hidden md:flex items-center justify-center gap-0.5 rounded px-1.5",
          variant === "header" ? "py-0.5" : "py-1",
          "text-xs font-medium",
          variantStyles[variant],
          className
        )}
        {...props}
      >
        {keyArray.map((key, index) => (
          <React.Fragment key={index}>
            {index > 0 && (
              <span className={cn(
                variant === "header" ? "text-xxs text-muted" : "text-xs"
              )}>
                {separator}
              </span>
            )}
            {key}
          </React.Fragment>
        ))}
      </div>
    )
  }
)
HotkeyBadge.displayName = "HotkeyBadge"

export { HotkeyBadge, type HotkeyBadgeProps, type HotkeyBadgeVariant }
