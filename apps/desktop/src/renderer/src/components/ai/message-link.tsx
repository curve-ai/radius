import { useEffect, useRef, useState, type ReactNode } from "react";

import type { MarkdownLinkPreviewResolution } from "../../../../radius-api";
import { MessageFileIcon } from "./message-file-icon";
import { messageFileName } from "./message-file-icon-utils";
import { isMessageFileHref } from "./message-link-utils";

const LINK_CLASS_NAME =
  "rounded-sm text-brand no-underline decoration-brand/40 underline-offset-[3px] transition-colors hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

export function MessageLink({
  children,
  href,
  sessionId,
}: {
  children: ReactNode;
  href: string;
  sessionId?: string;
}): ReactNode {
  const containerRef = useRef<HTMLSpanElement>(null);
  const requestedRef = useRef(false);
  const [resolution, setResolution] =
    useState<MarkdownLinkPreviewResolution | null>(null);
  const [failedFavicons, setFailedFavicons] = useState<readonly string[]>([]);
  const file = isMessageFileHref(href);

  useEffect(() => {
    if (file || !href.startsWith("https://")) return undefined;
    let active = true;
    requestedRef.current = false;
    const load = (): void => {
      if (requestedRef.current) return;
      requestedRef.current = true;
      void window.radius.resolveMarkdownLinkPreview(href).then(
        (result) => {
          if (active) setResolution(result);
        },
        () => {
          if (active) setResolution({ state: "unavailable" });
        },
      );
    };
    if (!("IntersectionObserver" in window) || !containerRef.current) {
      load();
      return () => {
        active = false;
      };
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          load();
          observer.disconnect();
        }
      },
      { rootMargin: "160px" },
    );
    observer.observe(containerRef.current);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, [file, href]);

  if (file) {
    const fileName = messageFileName(href);
    return (
      <span
        ref={containerRef}
        className="inline-flex min-w-0 items-baseline gap-1"
      >
        <MessageFileIcon fileName={fileName} />
        <a
          href={href}
          title={href}
          className={LINK_CLASS_NAME}
          onClick={(event) => {
            event.preventDefault();
            if (sessionId) {
              void window.radius
                .openSessionFile({ href, sessionId })
                .catch(() => undefined);
            }
          }}
        >
          {children}
        </a>
      </span>
    );
  }

  const metadata = resolution?.state === "ready" ? resolution : null;
  const favicon = metadata?.faviconDataUrl;
  const faviconDark = metadata?.faviconDarkDataUrl;
  const visibleFavicon =
    favicon && !failedFavicons.includes(favicon)
      ? favicon
      : faviconDark && !failedFavicons.includes(faviconDark)
        ? faviconDark
        : null;
  const visibleFaviconDark =
    faviconDark && !failedFavicons.includes(faviconDark) ? faviconDark : null;
  return (
    <span ref={containerRef} className="inline">
      <a
        href={href}
        title={href}
        target="_blank"
        rel="noreferrer"
        className={`inline-flex min-w-0 items-baseline gap-1 ${LINK_CLASS_NAME}`}
      >
        {visibleFavicon ? (
          <picture className="inline-flex size-3.5 shrink-0 self-center">
            {visibleFaviconDark && visibleFaviconDark !== visibleFavicon ? (
              <source
                media="(prefers-color-scheme: dark)"
                srcSet={visibleFaviconDark}
              />
            ) : null}
            <img
              src={visibleFavicon}
              alt=""
              aria-hidden
              className="radius-message-favicon size-3.5 rounded-[3px] object-contain"
              onError={(event) => {
                const failed = event.currentTarget.currentSrc;
                setFailedFavicons((current) =>
                  current.includes(failed) ? current : [...current, failed],
                );
              }}
            />
          </picture>
        ) : null}
        <span>{children}</span>
      </a>
    </span>
  );
}
