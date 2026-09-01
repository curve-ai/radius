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
import { cn } from "@renderer/lib/utils";

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

export function MessageImageGallery({
  children,
}: {
  children: ReactNode;
}): ReactNode {
  return (
    <div className="my-4 flex flex-wrap items-start gap-2 [&>figure]:my-0">
      {children}
    </div>
  );
}

export function MessageImageUnavailable({
  alt,
  href,
  reason,
}: {
  alt: string;
  href: string | null;
  reason: string;
}): ReactNode {
  const label = alt || reason;
  const content = (
    <>
      <ImageOff aria-hidden className="size-3.5 shrink-0" />
      <span>{label}</span>
    </>
  );
  return (
    <figure className="my-3 w-fit max-w-full">
      <figcaption>
        {href ? (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            title={href}
            aria-label={`${label}: ${reason}`}
            className="inline-flex items-center gap-1.5 rounded-sm text-sm text-muted-foreground no-underline decoration-muted-foreground/40 underline-offset-[3px] transition-colors hover:text-foreground hover:underline focus-visible:text-foreground focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            {content}
          </a>
        ) : (
          <span
            title={reason}
            aria-label={`${label}: ${reason}`}
            className="inline-flex items-center gap-1.5 text-sm text-muted-foreground"
          >
            {content}
          </span>
        )}
      </figcaption>
    </figure>
  );
}

export function MessageImage({
  alt,
  artifact,
  caption,
  resolveEnabled = true,
  size = "assistant",
  src,
  title,
}: {
  alt: string;
  caption?: string | null;
  resolveEnabled?: boolean;
  size?: "assistant" | "user";
  title?: string;
} & (
  | { src: string; artifact?: never }
  | { src?: never; artifact: { id: string; sessionId: string } }
)): ReactNode {
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const visibleCaption = caption === undefined ? alt : caption;
  const [expanded, setExpanded] = useState(false);
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const [resolved, setResolved] = useState<{
    resolution: MarkdownMediaResolution;
    src: string;
  } | null>(null);
  const artifactId = artifact?.id;
  const artifactSessionId = artifact?.sessionId;
  const sourceKey = artifact
    ? `radius-artifact:${artifact.sessionId}:${artifact.id}`
    : src;
  const immediateSource = artifact ? null : localImageSource(sourceKey);
  const resolution =
    resolved && resolved.src === sourceKey ? resolved.resolution : null;
  const resolvedSource =
    immediateSource ??
    (resolution?.state === "ready" ? resolution.dataUrl : null);
  const previewBounds =
    size === "user" ? "max-h-24 max-w-40" : "max-h-32 max-w-60";
  const placeholderBounds = size === "user" ? "h-20 w-36" : "h-32 w-60";

  useEffect(() => {
    let active = true;
    if (immediateSource || !resolveEnabled) return undefined;

    const pending =
      artifactId && artifactSessionId
        ? window.radius.resolveSessionArtifactImage({
            artifactId,
            sessionId: artifactSessionId,
          })
        : window.radius.resolveMarkdownMedia(sourceKey);
    void pending.then(
      (result) => {
        if (active) setResolved({ resolution: result, src: sourceKey });
      },
      () => {
        if (active) {
          setResolved({
            resolution: { state: "unavailable" },
            src: sourceKey,
          });
        }
      },
    );
    return () => {
      active = false;
    };
  }, [
    artifactId,
    artifactSessionId,
    immediateSource,
    resolveEnabled,
    sourceKey,
  ]);

  if (!resolvedSource && resolution === null) {
    return (
      <figure
        className="my-4 w-fit max-w-full"
        data-image-resolution={resolveEnabled ? undefined : "deferred"}
      >
        <Skeleton className={cn("max-w-full rounded-md", placeholderBounds)} />
        {visibleCaption ? (
          <figcaption className="mt-1.5 text-xs text-muted-foreground">
            {visibleCaption}
          </figcaption>
        ) : null}
      </figure>
    );
  }

  if (!resolvedSource || failedSource === resolvedSource) {
    const reason = unavailableLabel(resolution);
    const unavailableHref =
      !artifact &&
      src.startsWith("https://") &&
      !(resolution?.state === "blocked" && resolution.reason === "unsafe_url")
        ? src
        : null;
    return (
      <MessageImageUnavailable
        alt={alt}
        href={unavailableHref}
        reason={reason}
      />
    );
  }

  return (
    <Dialog open={expanded} onOpenChange={setExpanded}>
      <figure className="group/image relative my-4 w-fit max-w-full">
        <Tooltip disableHoverableContent>
          <TooltipTrigger asChild>
            <Button
              ref={expandButtonRef}
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Expand image"
              onClick={() => setExpanded(true)}
              className="group/preview relative h-auto w-auto max-w-full cursor-zoom-in overflow-visible rounded-md p-0 hover:bg-transparent"
            >
              <img
                src={resolvedSource}
                alt={alt}
                title={title}
                loading="lazy"
                decoding="async"
                onError={() => setFailedSource(resolvedSource)}
                className={cn(
                  "max-w-full rounded-md border border-border bg-background object-contain",
                  previewBounds,
                )}
              />
              <span className="radius-message-block-controls pointer-events-none absolute right-1.5 top-1.5 flex size-6 items-center justify-center rounded-md bg-background/90 text-muted-foreground opacity-0 shadow-sm backdrop-blur-sm transition-[color,opacity] duration-150 group-hover/preview:text-foreground group-hover/preview:opacity-100 group-focus-visible/preview:text-foreground group-focus-visible/preview:opacity-100 motion-reduce:duration-100">
                <Maximize2 aria-hidden className="size-3!" />
              </span>
            </Button>
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            Expand image
          </TooltipContent>
        </Tooltip>
        {visibleCaption ? (
          <figcaption className="mt-1.5 text-xs text-muted-foreground">
            {visibleCaption}
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
