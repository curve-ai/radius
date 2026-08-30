import { Check, Copy, Maximize2 } from "lucide-react";
import { useEffect, useId, useRef, useState, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { useCopyFeedback } from "./copy-feedback";
import { MessageCodeBlock } from "./message-code-block";
import {
  MAX_DIAGRAM_CHARACTERS,
  mermaidSourceError,
} from "./message-diagram-policy";

let mermaidRenderQueue = Promise.resolve();

function useDarkTheme(): boolean {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = (): void => setDark(root.classList.contains("dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(root, { attributeFilter: ["class"], attributes: true });
    return () => observer.disconnect();
  }, []);

  return dark;
}

async function renderMermaid(
  id: string,
  source: string,
  dark: boolean,
): Promise<string> {
  const sourceError = mermaidSourceError(source);
  if (sourceError) throw new Error(sourceError);

  const task = mermaidRenderQueue.then(async () => {
    const [{ default: mermaid }, { default: DOMPurify }] = await Promise.all([
      import("mermaid"),
      import("dompurify"),
    ]);
    mermaid.initialize({
      startOnLoad: false,
      securityLevel: "strict",
      suppressErrorRendering: true,
      theme: dark ? "dark" : "neutral",
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      maxTextSize: MAX_DIAGRAM_CHARACTERS,
      maxEdges: 500,
    });
    const valid = await mermaid.parse(source, { suppressErrors: true });
    if (!valid) throw new Error("Diagram syntax is invalid");
    const { svg } = await mermaid.render(id, source);
    const sanitized = DOMPurify.sanitize(svg, {
      USE_PROFILES: { svg: true, svgFilters: true },
      FORBID_TAGS: ["foreignObject", "script"],
      ALLOW_DATA_ATTR: false,
    });
    if (!sanitized.trim().startsWith("<svg")) {
      throw new Error("Diagram output was blocked");
    }
    return sanitized;
  });
  mermaidRenderQueue = task.then(
    () => undefined,
    () => undefined,
  );
  return task;
}

function DiagramSvg({
  className,
  source,
  svg,
}: {
  className?: string;
  source: string;
  svg: string;
}): ReactNode {
  return (
    <div
      role="img"
      aria-label={`Mermaid diagram: ${source.split("\n", 1)[0] ?? "diagram"}`}
      className={cn(
        "radius-message-diagram flex min-w-0 items-center justify-center overflow-auto bg-background p-4",
        className,
      )}
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}

export function MessageDiagram({
  controlsEnabled = true,
  source,
}: {
  controlsEnabled?: boolean;
  source: string;
}): ReactNode {
  const diagramId = `radius-mermaid-${useId().replace(/[^a-z0-9]/gi, "")}`;
  const dark = useDarkTheme();
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [rendered, setRendered] = useState<{
    dark: boolean;
    error: string | null;
    source: string;
    svg: string | null;
  } | null>(null);
  const { copied, copyText } = useCopyFeedback();

  useEffect(() => {
    let active = true;
    void renderMermaid(diagramId, source, dark).then(
      (result) => {
        if (active) {
          setRendered({ dark, error: null, source, svg: result });
        }
      },
      (reason: unknown) => {
        if (active) {
          setRendered({
            dark,
            error:
              reason instanceof Error ? reason.message : "Diagram unavailable",
            source,
            svg: null,
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [dark, diagramId, source]);

  const current =
    rendered?.dark === dark && rendered.source === source ? rendered : null;
  const error = current?.error ?? null;
  const svg = current?.svg ?? null;

  if (error) {
    return (
      <div className="my-4">
        <p className="mb-2 text-xs text-muted-foreground">{error}</p>
        <MessageCodeBlock
          code={source}
          language="mermaid"
          controlsEnabled={controlsEnabled}
        />
      </div>
    );
  }

  if (!svg) {
    return (
      <div className="my-4 overflow-hidden rounded-md border border-border bg-muted/35">
        <div className="flex min-h-32 items-center justify-center text-sm text-muted-foreground">
          Rendering diagram
        </div>
      </div>
    );
  }

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <div className="group/diagram relative my-4 pr-8">
        <div className="overflow-hidden rounded-md border border-border">
          <DiagramSvg source={source} svg={svg} />
          <details className="border-t border-border/70 px-3 py-2 text-xs text-muted-foreground">
            <summary className="cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring">
              View diagram source
            </summary>
            <pre className="mt-2 overflow-auto whitespace-pre-wrap font-mono text-[0.75rem] leading-5 text-foreground">
              {source}
            </pre>
          </details>
        </div>

        {controlsEnabled ? (
          <div className="radius-message-block-controls pointer-events-none absolute right-0 top-2 flex flex-col gap-2 opacity-0 transition-opacity duration-150 group-hover/diagram:opacity-100 group-focus-within/diagram:opacity-100 motion-reduce:duration-100">
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  ref={expandButtonRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Expand diagram"
                  onClick={() => setExpanded(true)}
                  className="pointer-events-auto size-6 rounded-md text-muted-foreground hover:text-foreground [&>svg]:size-3!"
                >
                  <Maximize2 data-icon="inline-start" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Expand diagram
              </TooltipContent>
            </Tooltip>

            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={copied ? "Diagram copied" : "Copy diagram source"}
                  onClick={() => void copyText(source)}
                  className="pointer-events-auto size-6 rounded-md text-muted-foreground hover:text-foreground [&>svg]:size-3!"
                >
                  {copied ? (
                    <Check data-icon="inline-start" aria-hidden />
                  ) : (
                    <Copy data-icon="inline-start" aria-hidden />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                {copied ? "Diagram copied" : "Copy diagram source"}
              </TooltipContent>
            </Tooltip>
          </div>
        ) : null}
      </div>

      {controlsEnabled ? (
        <DialogContent
          className="h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            expandButtonRef.current?.focus();
          }}
        >
          <DialogTitle className="sr-only">Expanded diagram</DialogTitle>
          <DiagramSvg
            source={source}
            svg={svg}
            className="h-full min-h-0 p-8 pt-12"
          />
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
