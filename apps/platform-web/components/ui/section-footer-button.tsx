import * as React from "react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { HotkeyBadge } from "@/components/ui/hotkey-badge"
import Link from "next/link"

interface SectionFooterButtonProps
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

const SectionFooterButton = React.forwardRef<
  HTMLAnchorElement,
  SectionFooterButtonProps
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
      <div className="w-full">
        <Button
          asChild
          className={cn(
            "w-full text-muted-foreground hover:text-foreground transition-colors text-center",
            "px-4 py-3 bg-muted rounded-t-none border-0 border-t",
            className
          )}
          variant="outline"
        >
          <Link
            ref={ref}
            href={href}
            className="flex items-center justify-between gap-1 w-full"
            {...props}
          >
            <span className="font-medium">{children}</span>
            {hotkey && (
              <HotkeyBadge
                keys={hotkey}
                variant="footer"
                separator={hotkeysSeparator}
              />
            )}
          </Link>
        </Button>
      </div>
    )
  }
)
SectionFooterButton.displayName = "SectionFooterButton"

export { SectionFooterButton, type SectionFooterButtonProps }
