import { Check, Copy, Maximize2 } from "lucide-react";
import { useRef, useState, type ComponentProps, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Table } from "@renderer/components/ui/table";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";
import { cn } from "@renderer/lib/utils";
import { useCopyFeedback } from "./copy-feedback";
import { tableRowsAsMarkdown } from "./message-markdown-normalize";

function tableRows(table: HTMLTableElement): string[][] {
  const rows = Array.from(table.rows).map((row) =>
    Array.from(row.cells).map((cell) =>
      (cell.textContent ?? "").trim().replace(/\s+/g, " "),
    ),
  );
  return rows;
}

export function MessageTable({
  className,
  controlsEnabled = true,
  fullWidth = false,
  ...props
}: ComponentProps<"table"> & {
  controlsEnabled?: boolean;
  fullWidth?: boolean;
}): ReactNode {
  const containerRef = useRef<HTMLDivElement>(null);
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const { copied, copyText } = useCopyFeedback();

  const copyTable = async (): Promise<void> => {
    const table = containerRef.current?.querySelector("table");
    if (!table) return;

    await copyText(tableRowsAsMarkdown(tableRows(table)));
  };

  const tableClassName = cn("min-w-max text-left text-sm", className);

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <div
        className={cn(
          "radius-message-table-layout group/table relative my-5 pr-8",
          fullWidth && "radius-message-table-breakout",
        )}
      >
        <div
          ref={containerRef}
          className="radius-message-table overflow-hidden rounded-md border border-border bg-background"
        >
          <Table {...props} className={tableClassName} />
        </div>

        {controlsEnabled ? (
          <div className="radius-message-table-controls pointer-events-none absolute right-0 top-2 flex flex-col gap-2 opacity-0 transition-opacity duration-150 group-hover/table:opacity-100 group-focus-within/table:opacity-100 motion-reduce:duration-100">
            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  ref={expandButtonRef}
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Expand table"
                  onClick={() => setExpanded(true)}
                  className="pointer-events-auto size-6 rounded-md text-muted-foreground hover:text-foreground [&>svg]:size-3!"
                >
                  <Maximize2 data-icon="inline-start" aria-hidden />
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" sideOffset={6}>
                Expand table
              </TooltipContent>
            </Tooltip>

            <Tooltip disableHoverableContent>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={copied ? "Table copied" : "Copy table"}
                  onClick={() => void copyTable()}
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
                {copied ? "Table copied" : "Copy table"}
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
          <DialogTitle className="sr-only">Expanded table</DialogTitle>
          <div className="min-h-0 overflow-auto px-6 pb-6 pt-12">
            <div className="overflow-hidden rounded-md border border-border bg-background">
              <Table {...props} className={tableClassName} />
            </div>
          </div>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}
