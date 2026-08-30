import { ImageOff, Maximize2 } from "lucide-react";
import { useEffect, useRef, useState, type ReactNode } from "react";

import type { MarkdownMediaResolution } from "../../../../radius-api";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Skeleton } from "@renderer/components/ui/skeleton";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@renderer/components/ui/tooltip";

const MAX_INLINE_IMAGE_URL_LENGTH = 7 * 1024 * 1024;
const SAFE_DATA_IMAGE = /^data:image\/(?:avif|gif|jpeg|png|webp);base64,/i;

function localImageSource(src: string): string | null {
  if (src.startsWith("blob:")) return src;
  if (src.length <= MAX_INLINE_IMAGE_URL_LENGTH && SAFE_DATA_IMAGE.test(src)) {
    return src;
  }
  return null;
}

function unavailableLabel(resolution: MarkdownMediaResolution | null): string {
  if (resolution?.state === "blocked") {
    if (resolution.reason === "too_large") return "Image is too large";
    if (resolution.reason === "unsupported_type") {
      return "Image type is not supported";
    }
    return "Image URL was blocked";
  }
  return "Image is unavailable";
}

export function MessageImage({
  alt,
  src,
  title,
}: {
  alt: string;
  src: string;
  title?: string;
}): ReactNode {
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{
    resolution: MarkdownMediaResolution;
    src: string;
  } | null>(null);
  const immediateSource = localImageSource(src);
  const resolution = resolved?.src === src ? resolved.resolution : null;
  const resolvedSource =
    immediateSource ??
    (resolution?.state === "ready" ? resolution.dataUrl : null);

  useEffect(() => {
    let active = true;
    if (immediateSource) return undefined;

    void window.radius.resolveMarkdownMedia(src).then(
      (result) => {
        if (active) setResolved({ resolution: result, src });
      },
      () => {
        if (active) {
          setResolved({ resolution: { state: "unavailable" }, src });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [immediateSource, src]);

  if (!resolvedSource && resolution === null) {
    return (
      <figure className="my-4 max-w-xl">
        <Skeleton className="min-h-32 w-full rounded-md" />
        {alt ? (
          <figcaption className="mt-1.5 text-xs text-muted-foreground">
            {alt}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (!resolvedSource || failedSource === resolvedSource) {
    return (
      <figure className="my-4 flex min-h-24 max-w-xl items-center gap-3 rounded-md border border-border bg-muted/35 px-4 py-3 text-sm text-muted-foreground">
        <ImageOff aria-hidden className="shrink-0" />
        <figcaption>
          <span className="block text-foreground">
            {alt || unavailableLabel(resolution)}
          </span>
          {alt ? <span>{unavailableLabel(resolution)}</span> : null}
        </figcaption>
      </figure>
    );
  }

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <figure className="group/image relative my-4 max-w-xl pr-8">
        <img
          src={resolvedSource}
          alt={alt}
          title={title}
          loading="lazy"
          decoding="async"
          onError={() => setFailedSource(resolvedSource)}
          className="max-h-[32rem] max-w-full rounded-md border border-border bg-background object-contain"
        />
        <div className="radius-message-block-controls pointer-events-none absolute right-0 top-2 opacity-0 transition-opacity duration-150 group-hover/image:opacity-100 group-focus-within/image:opacity-100 motion-reduce:duration-100">
          <Tooltip disableHoverableContent>
            <TooltipTrigger asChild>
              <Button
                ref={expandButtonRef}
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Expand image"
                onClick={() => setExpanded(true)}
                className="pointer-events-auto size-6 rounded-md text-muted-foreground hover:text-foreground [&>svg]:size-3!"
              >
                <Maximize2 data-icon="inline-start" aria-hidden />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6}>
              Expand image
            </TooltipContent>
          </Tooltip>
        </div>
        {alt ? (
          <figcaption className="mt-1.5 text-xs text-muted-foreground">
            {alt}
          </figcaption>
        ) : null}
      </figure>

      <DialogContent
        className="h-[calc(100dvh-1.5rem)] w-[calc(100vw-1.5rem)] max-w-none gap-0 overflow-hidden p-0 sm:max-w-none"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          expandButtonRef.current?.focus();
        }}
      >
        <DialogTitle className="sr-only">Expanded image</DialogTitle>
        <div className="flex min-h-0 items-center justify-center overflow-auto p-8 pt-12">
          <img
            src={resolvedSource}
            alt={alt}
            className="max-h-full max-w-full object-contain"
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
