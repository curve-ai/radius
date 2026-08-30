import {
  CircleAlert,
  Info,
  Lightbulb,
  ShieldAlert,
  TriangleAlert,
} from "lucide-react";
import { useRef, type KeyboardEvent, type ReactNode } from "react";

import {
  Alert,
  AlertDescription,
  AlertTitle,
} from "@renderer/components/ui/alert";

const DIRECTIVE_PRESENTATION = {
  caution: { icon: ShieldAlert, label: "Caution" },
  important: { icon: CircleAlert, label: "Important" },
  note: { icon: Info, label: "Note" },
  tip: { icon: Lightbulb, label: "Tip" },
  warning: { icon: TriangleAlert, label: "Warning" },
} as const;

type CalloutKind = keyof typeof DIRECTIVE_PRESENTATION;

export function MessageDirective({
  children,
  kind,
  name,
  title,
}: {
  children: ReactNode;
  kind: string;
  name: string;
  title: string;
}): ReactNode {
  const detailsRef = useRef<HTMLDetailsElement>(null);

  if (kind === "details") {
    return (
      <details
        ref={detailsRef}
        className="my-4 overflow-hidden rounded-md border border-border bg-background"
        onKeyDown={(event: KeyboardEvent<HTMLDetailsElement>) => {
          if (event.key !== "Escape" || !event.currentTarget.open) return;
          event.preventDefault();
          event.currentTarget.open = false;
          event.currentTarget.querySelector("summary")?.focus();
        }}
      >
        <summary className="cursor-pointer px-3 py-2 text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-ring">
          {title || "Details"}
        </summary>
        <div className="border-t border-border/70 px-3 py-2 text-sm">
          {children}
        </div>
      </details>
    );
  }

  if (!Object.prototype.hasOwnProperty.call(DIRECTIVE_PRESENTATION, kind)) {
    return (
      <div className="my-4 rounded-md border border-border bg-muted/35 px-3 py-2 text-sm">
        <code className="font-mono text-xs text-muted-foreground">
          :::{name}
          {title ? `[${title}]` : ""}
        </code>
        <div className="my-2">{children}</div>
        <code className="font-mono text-xs text-muted-foreground">:::</code>
      </div>
    );
  }

  const presentation = DIRECTIVE_PRESENTATION[kind as CalloutKind];
  const Icon = presentation.icon;
  return (
    <Alert role="note" className="my-4 rounded-md bg-muted/35 px-3 py-2">
      <Icon aria-hidden />
      <AlertTitle className="font-normal">
        {title || presentation.label}
      </AlertTitle>
      <AlertDescription className="text-foreground">
        {children}
      </AlertDescription>
    </Alert>
  );
}
