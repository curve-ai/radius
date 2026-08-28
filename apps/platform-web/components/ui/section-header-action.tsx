import * as React from "react"
import { cn } from "@/lib/utils"
import { HotkeyBadge } from "@/components/ui/hotkey-badge"
import Link from "next/link"

interface SectionHeaderActionProps
  extends React.AnchorHTMLAttributes<HTMLAnchorElement> {
  /**
   * The destination URL
   */
  href: string
  /**
   * Button text/label
   */
  children: React.ReactNode
  /**
   * Optional keyboard shortcut to display
   * Can be a string like "G H" or array like ["G", "H"]
   */
  hotkey?: string | string[]
  /**
   * Text to display between hotkeys (default: "then")
   */
  hotkeysSeparator?: string
}

const SectionHeaderAction = React.forwardRef<
  HTMLAnchorElement,
  SectionHeaderActionProps
>(
  (
    {
      className,
      href,
      children,
      hotkey,
      hotkeysSeparator = "then",
      ...props
    },
    ref
  ) => {
    return (
      <Link
        ref={ref}
        href={href}
        className={cn(
          "w-[140px] md:w-auto px-3 md:pl-2 md:pr-1 py-1.5 md:py-1",
          "flex items-center justify-center gap-1.5",
          "text-xs font-medium rounded-md",
          "bg-primary text-primary-foreground",
          "transition-colors hover:bg-primary/90",
          className
        )}
        {...props}
      >
        {children}
        {hotkey && (
          <HotkeyBadge
            keys={hotkey}
            variant="header"
            separator={hotkeysSeparator}
          />
        )}
      </Link>
    )
  }
)
SectionHeaderAction.displayName = "SectionHeaderAction"

export { SectionHeaderAction, type SectionHeaderActionProps }
