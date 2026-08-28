import * as React from "react"
import { cn } from "@/lib/utils"

const Section = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("bg-card rounded-lg border", className)}
    {...props}
  />
))
Section.displayName = "Section"

const SectionHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      "px-4 py-3 border-b flex flex-wrap items-center justify-between gap-4",
      className
    )}
    {...props}
  />
))
SectionHeader.displayName = "SectionHeader"

const SectionHeaderContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("flex flex-col", className)} {...props} />
))
SectionHeaderContent.displayName = "SectionHeaderContent"

const SectionHeaderTop = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center justify-between gap-4 flex-1 min-w-0", className)}
    {...props}
  />
))
SectionHeaderTop.displayName = "SectionHeaderTop"

const SectionHeaderControls = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-4 w-full md:w-auto justify-end", className)}
    {...props}
  />
))
SectionHeaderControls.displayName = "SectionHeaderControls"

const SectionTitle = React.forwardRef<
  HTMLHeadingElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <h2
    ref={ref}
    className={cn("text-base font-normal", className)}
    {...props}
  />
))
SectionTitle.displayName = "SectionTitle"

const SectionDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p
    ref={ref}
    className={cn("text-sm text-muted-foreground", className)}
    {...props}
  />
))
SectionDescription.displayName = "SectionDescription"

const SectionAction = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("flex items-center gap-2", className)}
    {...props}
  />
))
SectionAction.displayName = "SectionAction"

const SectionContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("px-4 py-3", className)} {...props} />
))
SectionContent.displayName = "SectionContent"

const SectionFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn("px-4 py-3 border-t", className)}
    {...props}
  />
))
SectionFooter.displayName = "SectionFooter"

const SectionDivider = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn("border-t", className)} {...props} />
))
SectionDivider.displayName = "SectionDivider"

// Re-export button components for convenience
export { HotkeyBadge } from "@/components/ui/hotkey-badge"
export { SectionFooterButton } from "@/components/ui/section-footer-button"
export { SectionHeaderAction } from "@/components/ui/section-header-action"

export {
  Section,
  SectionHeader,
  SectionHeaderTop,
  SectionHeaderContent,
  SectionHeaderControls,
  SectionTitle,
  SectionDescription,
  SectionAction,
  SectionContent,
  SectionFooter,
  SectionDivider,
}
