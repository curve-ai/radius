import type { MarkdownLinkPreviewResolution } from "../radius-api";
import { BoundedLru } from "./bounded-lru";

const SUCCESS_TTL_MS = 60 * 60 * 1_000;
const FAILURE_TTL_MS = 60 * 1_000;
const MAX_CONCURRENT = 4;
const MAX_PENDING = 128;

export function markdownLinkOrigin(href: string): string | null {
  try {
    const url = new URL(href);
    return url.protocol === "https:" && !url.username && !url.password
      ? url.origin
      : null;
  } catch {
    return null;
  }
}

/** Favicon-only metadata is shared by origin, never page titles or previews. */
export class MarkdownLinkPreviewCache {
  private readonly cache = new BoundedLru<{
    expiresAt: number;
    result: MarkdownLinkPreviewResolution;
  }>(64, 16 * 1024 * 1024);
  private readonly pending = new Map<
    string,
    Promise<MarkdownLinkPreviewResolution>
  >();
  private readonly queue: (() => void)[] = [];
  private active = 0;

  constructor(
    private readonly load: (
      href: string,
    ) => Promise<MarkdownLinkPreviewResolution>,
    private readonly now: () => number = Date.now,
  ) {}

  get(href: string): MarkdownLinkPreviewResolution | undefined {
    const origin = markdownLinkOrigin(href);
    const entry = origin ? this.cache.get(origin) : undefined;
    return entry && entry.expiresAt > this.now() ? entry.result : undefined;
  }

  resolve(href: string): Promise<MarkdownLinkPreviewResolution> {
    const origin = markdownLinkOrigin(href);
    if (!origin) {
      return Promise.resolve({ state: "blocked", reason: "unsafe_url" });
    }
    const cached = this.get(href);
    if (cached) return Promise.resolve(cached);
    const pending = this.pending.get(origin);
    if (pending) return pending;
    if (this.pending.size >= MAX_PENDING) {
      return Promise.resolve({ state: "unavailable" });
    }

    const result = new Promise<MarkdownLinkPreviewResolution>((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        // Defer invocation so synchronous failures also settle and free the slot.
        void Promise.resolve()
          .then(() => this.load(href))
          .catch((): MarkdownLinkPreviewResolution => ({
            state: "unavailable",
          }))
          .then((value) => {
            const hasIcon =
              value.state === "ready" &&
              (value.faviconDataUrl || value.faviconDarkDataUrl);
            this.cache.set(
              origin,
              {
                result: value,
                expiresAt:
                  this.now() + (hasIcon ? SUCCESS_TTL_MS : FAILURE_TTL_MS),
              },
              JSON.stringify(value).length,
            );
            this.pending.delete(origin);
            this.active -= 1;
            resolve(value);
            this.drain();
          });
      });
    });
    this.pending.set(origin, result);
    this.drain();
    return result;
  }

  private drain(): void {
    while (this.active < MAX_CONCURRENT && this.queue.length > 0) {
      this.queue.shift()?.();
    }
  }
}
