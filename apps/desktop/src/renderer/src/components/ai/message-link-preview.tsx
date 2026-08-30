import { ExternalLink } from "lucide-react";
import { useState, type ReactNode } from "react";

import type { MarkdownLinkPreviewResolution } from "../../../../radius-api";
import { Button } from "@renderer/components/ui/button";
import { Skeleton } from "@renderer/components/ui/skeleton";

function SafeExternalLink({
  children,
  className,
  href,
}: {
  children: ReactNode;
  className?: string;
  href: string;
}): ReactNode {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={className}>
      {children}
    </a>
  );
}

export function MessageLinkPreview({ url }: { url: string }): ReactNode {
  const [loading, setLoading] = useState(false);
  const [resolution, setResolution] =
    useState<MarkdownLinkPreviewResolution | null>(null);

  const loadPreview = async (): Promise<void> => {
    setLoading(true);
    try {
      setResolution(await window.radius.resolveMarkdownLinkPreview(url));
    } catch {
      setResolution({ state: "unavailable" });
    } finally {
      setLoading(false);
    }
  };

  if (resolution?.state === "ready") {
    return (
      <aside className="my-4 overflow-hidden rounded-md border border-border bg-background">
        {resolution.imageDataUrl ? (
          <img
            src={resolution.imageDataUrl}
            alt=""
            loading="lazy"
            decoding="async"
            className="max-h-48 w-full border-b border-border object-cover"
          />
        ) : null}
        <div className="flex flex-col gap-1.5 p-3">
          <SafeExternalLink
            href={resolution.finalUrl}
            className="flex items-center gap-1.5 rounded-sm text-sm text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          >
            <span>{resolution.title}</span>
            <ExternalLink aria-hidden className="shrink-0" />
          </SafeExternalLink>
          {resolution.description ? (
            <p className="line-clamp-3 text-sm text-muted-foreground">
              {resolution.description}
            </p>
          ) : null}
          <span className="text-xs text-muted-foreground">
            {resolution.siteName}
          </span>
        </div>
      </aside>
    );
  }

  if (loading) {
    return (
      <div className="my-4 flex flex-col gap-2 rounded-md border border-border p-3">
        <Skeleton className="h-4 w-2/5 rounded-sm" />
        <Skeleton className="h-3 w-4/5 rounded-sm" />
        <Skeleton className="h-3 w-1/4 rounded-sm" />
      </div>
    );
  }

  return (
    <div className="my-3 flex min-w-0 items-center gap-2">
      <SafeExternalLink
        href={url}
        className="min-w-0 truncate rounded-sm text-brand underline decoration-brand/35 underline-offset-2 transition-colors hover:decoration-brand focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        {url}
      </SafeExternalLink>
      {resolution === null ? (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => void loadPreview()}
          className="h-7 shrink-0 px-2 text-xs text-muted-foreground"
        >
          Preview link
        </Button>
      ) : (
        <span className="shrink-0 text-xs text-muted-foreground">
          Preview unavailable
        </span>
      )}
    </div>
  );
}
