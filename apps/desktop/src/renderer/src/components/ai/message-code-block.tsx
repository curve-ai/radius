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

const MAX_HIGHLIGHT_CHARACTERS = 100_000;
const MAX_HIGHLIGHT_LINES = 5_000;

function plainCode(code: string): ReactNode {
  return <code>{code}</code>;
}

function HighlightedCode({
  code,
  language,
}: {
  code: string;
  language: string | null;
}): ReactNode {
  const highlightable =
    Boolean(language) &&
    code.length <= MAX_HIGHLIGHT_CHARACTERS &&
    code.split("\n", MAX_HIGHLIGHT_LINES + 1).length <= MAX_HIGHLIGHT_LINES;
  const [highlight, setHighlight] = useState<{
    code: string;
    html: string;
    language: string;
  } | null>(null);

  useEffect(() => {
    let active = true;
    if (!language || !highlightable) return undefined;

    void import("shiki/bundle/web")
      .then(({ codeToHtml }) =>
        codeToHtml(code, {
          lang: language,
          themes: { dark: "github-dark", light: "github-light" },
        }),
      )
      .then((highlighted) => {
        if (active) setHighlight({ code, html: highlighted, language });
      })
      .catch(() => undefined);

    return () => {
      active = false;
    };
  }, [code, highlightable, language]);

  if (
    !highlightable ||
    highlight?.code !== code ||
    highlight.language !== language
  ) {
    return plainCode(code);
  }
  return (
    <div
      className="radius-message-code-highlight"
      // Shiki escapes code and generates this markup from bundled grammars.
      dangerouslySetInnerHTML={{ __html: highlight.html }}
    />
  );
}

export function MessageCodeBlock({
  code,
  controlsEnabled = true,
  language,
}: {
  code: string;
  controlsEnabled?: boolean;
  language: string | null;
}): ReactNode {
  const labelId = useId();
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const { copied, copyText } = useCopyFeedback();
  const languageLabel = language?.trim() || "Plain text";

  const codeSurface = (expandedView = false): ReactNode => (
    <div
      className={cn(
        "min-w-0 overflow-auto bg-muted/55 font-mono text-[0.8125rem] leading-5",
        expandedView ? "h-full p-6 pt-12" : "max-h-[32rem] p-3",
      )}
    >
      <HighlightedCode code={code} language={language} />
    </div>
  );

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <div className="group/code relative my-4 pr-8">
        <div className="overflow-hidden rounded-md border border-border bg-background">
          <div className="flex min-h-8 items-center border-b border-border/70 px-3 text-xs text-muted-foreground">
            <span id={labelId}>{languageLabel}</span>
          </div>
          <div role="region" aria-labelledby={labelId}>
            {codeSurface()}
          </div>
        </div>

        {controlsEnabled ? (
          <div className="radius-message-block-controls pointer-events-none absolute right-0 top-2 flex flex-col gap-2 opacity-0 transition-opacity duration-150 group-hover/code:opacity-100 group-focus-within/code:opacity-100 motion-reduce:duration-100">
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  ref={expandButtonRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Expand code"
                  onClick={() => setExpanded(true)}
                  className="pointer-events-auto size-6 rounded-md text-muted-foreground hover:text-foreground [&>svg]:size-3!"
                >
                  <Maximize2 data-icon="inline-start" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Expand code
              </TooltipContent>
            </Tooltip>

            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={copied ? "Code copied" : "Copy code"}
                  onClick={() => void copyText(code)}
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
                {copied ? "Code copied" : "Copy code"}
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
          <DialogTitle className="sr-only">Expanded code</DialogTitle>
          {codeSurface(true)}
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
