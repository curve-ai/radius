import {
  ArrowLeft,
  ChevronRight,
  CircleAlert,
  ExternalLink,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from "react";

import { ActivityIndicator } from "@renderer/components/ui/activity-indicator";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
  type Variants,
} from "@renderer/components/ui/motion";
import { SegmentedControl } from "@renderer/components/ui/segmented-control";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { cn } from "@renderer/lib/utils";
import type {
  DesktopConnector,
  DesktopConnectorCatalogCategory,
  DesktopConnectorCatalogCategoryPreview,
  DesktopConnectorCatalogEntry,
  DesktopConnectorEnabledTool,
} from "../../../../radius-api";

type ConnectorViewDirection = "back" | "forward";
type ConnectorViewMotionContext = {
  direction: ConnectorViewDirection;
  reduceMotion: boolean;
};
type PendingConnectorAction =
  | { kind: "custom" }
  | { kind: "install"; catalogId: string }
  | { kind: "connect"; installationId: string }
  | { kind: "disconnect" }
  | { kind: "delete" };

const CONNECTOR_VIEW_EASE = [0.23, 1, 0.32, 1] as const;
const CONNECTOR_VIEW_VARIANTS: Variants = {
  enter: ({
    direction,
    reduceMotion,
  }: ConnectorViewMotionContext): {
    opacity: number;
    pointerEvents: "none";
    transform: string;
  } => {
    const transform = reduceMotion
      ? "translateX(0px)"
      : direction === "forward"
        ? "translateX(8px)"
        : "translateX(-8px)";
    return { opacity: 0, pointerEvents: "none", transform };
  },
  center: {
    opacity: 1,
    pointerEvents: "auto",
    transform: "translateX(0px)",
  },
  exit: ({
    direction,
    reduceMotion,
  }: ConnectorViewMotionContext): {
    opacity: number;
    pointerEvents: "none";
    transform: string;
  } => {
    const transform = reduceMotion
      ? "translateX(0px)"
      : direction === "forward"
        ? "translateX(-8px)"
        : "translateX(8px)";
    return { opacity: 0, pointerEvents: "none", transform };
  },
};

function ConnectorSearch({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}): ReactNode {
  return (
    <div className="relative mt-7">
      <Search
        className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <Input
        type="search"
        value={value}
        aria-label="Search connectors"
        placeholder="Search connectors"
        className="h-11 rounded-full pl-11 text-base md:text-base"
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}

function connectionLabel(
  state: DesktopConnector["providers"][number]["connectionState"],
): string {
  switch (state) {
    case "connected":
      return "Connected on this Mac";
    case "disconnected":
      return "Disconnected on this Mac";
    case "needs_authentication":
      return "Authentication required";
    case "error":
      return "Connection error";
  }
}

function ConnectorLogo({
  label,
  logoUrl,
  small = false,
}: {
  label: string;
  logoUrl: string | null;
  small?: boolean;
}): ReactNode {
  const [failed, setFailed] = useState(false);
  return (
    <div
      className={cn(
        "flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-border bg-background shadow-sm",
        small ? "size-10" : "size-12",
      )}
      title={label}
    >
      {logoUrl && !failed ? (
        <img
          src={logoUrl}
          alt=""
          className="size-full object-contain"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <Plug className="size-4 text-muted-foreground" aria-hidden />
      )}
    </div>
  );
}

function CatalogRow({
  disabled,
  entry,
  installed,
  pending,
  onOpen,
  onInstall,
  onConnect,
}: {
  disabled: boolean;
  entry: DesktopConnectorCatalogEntry;
  installed: DesktopConnector | null;
  pending: boolean;
  onOpen: (id: string) => void;
  onInstall: (id: string) => void;
  onConnect: (installationId: string) => void;
}): ReactNode {
  const installable = entry.transport === "streamable_http" && entry.remoteUrl;
  const needsSetup =
    installed?.lifecycleState === "staged" ||
    installed?.providers.some(
      (provider) => provider.connectionState !== "connected",
    );
  return (
    <article className="grid min-h-[4.5rem] grid-cols-[minmax(0,1fr)_auto] items-center gap-2 rounded-md px-1 py-1 transition-colors hover:bg-accent focus-within:bg-accent">
      <button
        type="button"
        className="grid min-w-0 grid-cols-[2.5rem_minmax(0,1fr)] items-center gap-3 rounded-md py-2 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring"
        onClick={() => onOpen(entry.id)}
      >
        <ConnectorLogo label={entry.title} logoUrl={entry.logoUrl} small />
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-foreground">
            {entry.title}
          </span>
          <span className="mt-0.5 block truncate text-sm text-muted-foreground">
            {entry.description}
          </span>
        </span>
      </button>
      {installed ? (
        needsSetup ? (
          <Button
            type="button"
            size="xs"
            variant="secondary"
            disabled={disabled}
            onClick={() => onConnect(installed.id)}
          >
            {pending ? "Connecting" : "Finish setup"}
          </Button>
        ) : (
          <span className="px-2 text-xs text-muted-foreground">Installed</span>
        )
      ) : installable ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={disabled}
          onClick={() => onInstall(entry.id)}
        >
          Install
        </Button>
      ) : (
        <span className="px-2 text-xs text-muted-foreground">Local only</span>
      )}
    </article>
  );
}

function installStatus(connector: DesktopConnector | null): string {
  if (!connector) return "Not installed";
  if (
    connector.lifecycleState === "staged" ||
    connector.providers.length === 0 ||
    connector.providers.some(
      (provider) => provider.connectionState !== "connected",
    )
  ) {
    return "Needs setup";
  }
  return "Installed";
}

function ConnectorDetailView({
  backLabel,
  entry,
  categoryLabels,
  installed,
  tools,
  toolsLoading,
  pending,
  onBack,
  onInstall,
  onConnect,
  onDisconnect,
}: {
  backLabel: string;
  entry: DesktopConnectorCatalogEntry;
  categoryLabels: string[];
  installed: DesktopConnector | null;
  tools: DesktopConnectorEnabledTool[];
  toolsLoading: boolean;
  pending: boolean;
  onBack: () => void;
  onInstall: (id: string) => void;
  onConnect: (installationId: string) => void;
  onDisconnect: (providerId: string) => void;
}): ReactNode {
  const installable = entry.transport === "streamable_http" && entry.remoteUrl;
  const published = entry.publishedAt
    ? new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(
        new Date(entry.publishedAt),
      )
    : null;

  return (
    <>
      <Button type="button" variant="ghost" size="sm" onClick={onBack}>
        <ArrowLeft className="size-3.5" aria-hidden />
        {backLabel}
      </Button>

      <div className="mt-7 flex items-start gap-4">
        <ConnectorLogo label={entry.title} logoUrl={entry.logoUrl} />
        <div className="min-w-0 flex-1">
          <h2 className="type-md-lg text-foreground">{entry.title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            {installStatus(installed)}
          </p>
        </div>
        {!installed && installable ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onInstall(entry.id)}
          >
            Install
          </Button>
        ) : installed && installStatus(installed) === "Needs setup" ? (
          <Button
            type="button"
            size="sm"
            disabled={pending}
            onClick={() => onConnect(installed.id)}
          >
            {pending ? "Connecting" : "Finish setup"}
          </Button>
        ) : null}
      </div>

      <p className="mt-6 max-w-3xl text-base leading-relaxed text-foreground">
        {entry.description}
      </p>

      <section
        className="mt-9 border-t border-border pt-6"
        aria-labelledby="connector-tools-heading"
      >
        <div className="flex items-baseline justify-between gap-4">
          <h3
            id="connector-tools-heading"
            className="type-md-sm text-foreground"
          >
            Enabled tools
          </h3>
          <span className="text-sm text-muted-foreground">{tools.length}</span>
        </div>
        {toolsLoading ? (
          <div className="mt-4 grid gap-2">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : tools.length > 0 ? (
          <div className="mt-4 grid gap-2 sm:grid-cols-2">
            {tools.map((tool) => (
              <div
                key={`${tool.providerId}:${tool.name}`}
                className="rounded-md bg-muted px-3 py-2"
              >
                <p className="text-sm text-foreground">{tool.name}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {tool.providerLabel}
                </p>
              </div>
            ))}
          </div>
        ) : (
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">
            {installed
              ? "No tools are enabled yet. Tools appear after authentication and discovery."
              : "Install this connector to authenticate and discover its MCP tools."}
          </p>
        )}
      </section>

      {installed?.providers.length ? (
        <section
          className="mt-9 border-t border-border pt-6"
          aria-labelledby="connector-connections-heading"
        >
          <h3
            id="connector-connections-heading"
            className="type-md-sm text-foreground"
          >
            Connections
          </h3>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {installed.providers.map((provider) => (
              <div key={provider.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-foreground">{provider.label}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">
                    {connectionLabel(provider.connectionState)},{" "}
                    {provider.toolCount} enabled tools
                  </p>
                </div>
                {provider.connectionState === "connected" ? (
                  <Button
                    type="button"
                    size="xs"
                    variant="secondary"
                    disabled={pending}
                    onClick={() => onDisconnect(provider.id)}
                  >
                    Disconnect
                  </Button>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section
        className="mt-9 border-t border-border pt-6"
        aria-labelledby="connector-details-heading"
      >
        <h3
          id="connector-details-heading"
          className="type-md-sm text-foreground"
        >
          Details
        </h3>
        <dl className="mt-4 grid gap-x-8 gap-y-5 sm:grid-cols-2">
          <div>
            <dt className="text-xs text-muted-foreground">
              Official server name
            </dt>
            <dd className="mt-1 break-all text-sm text-foreground">
              {entry.sourceServerName}
            </dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Version</dt>
            <dd className="mt-1 text-sm text-foreground">{entry.version}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted-foreground">Transport</dt>
            <dd className="mt-1 text-sm text-foreground">Streamable HTTP</dd>
          </div>
          {categoryLabels.length > 0 ? (
            <div>
              <dt className="text-xs text-muted-foreground">Categories</dt>
              <dd className="mt-1 text-sm text-foreground">
                {categoryLabels.join(", ")}
              </dd>
            </div>
          ) : null}
          {published ? (
            <div>
              <dt className="text-xs text-muted-foreground">Published</dt>
              <dd className="mt-1 text-sm text-foreground">{published}</dd>
            </div>
          ) : null}
          {entry.remoteUrl ? (
            <div className="sm:col-span-2">
              <dt className="text-xs text-muted-foreground">MCP endpoint</dt>
              <dd className="mt-1 break-all text-sm text-foreground">
                {entry.remoteUrl}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-5 flex flex-wrap gap-2">
          {entry.websiteUrl ? (
            <Button asChild variant="secondary" size="sm">
              <a href={entry.websiteUrl} target="_blank" rel="noreferrer">
                Website
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
          ) : null}
          {entry.repositoryUrl ? (
            <Button asChild variant="secondary" size="sm">
              <a href={entry.repositoryUrl} target="_blank" rel="noreferrer">
                Repository
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
            </Button>
          ) : null}
        </div>
      </section>
    </>
  );
}

export function ConnectorsPage(): ReactNode {
  const reduceMotion = useReducedMotion() === true;
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<DesktopConnectorCatalogEntry[]>([]);
  const [catalogCategories, setCatalogCategories] = useState<
    DesktopConnectorCatalogCategory[]
  >([]);
  const [categoryPreviews, setCategoryPreviews] = useState<
    DesktopConnectorCatalogCategoryPreview[]
  >([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<DesktopConnector[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DesktopConnector | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAction, setPendingAction] =
    useState<PendingConnectorAction | null>(null);
  const [query, setQuery] = useState("");
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(
    null,
  );
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(
    null,
  );
  const [selectedCatalogId, setSelectedCatalogId] = useState<string | null>(
    null,
  );
  const [viewDirection, setViewDirection] =
    useState<ConnectorViewDirection>("forward");
  const [scope, setScope] = useState<"public" | "custom">("public");
  const [enabledToolsState, setEnabledToolsState] = useState<{
    installationId: string;
    tools: DesktopConnectorEnabledTool[];
  } | null>(null);
  const catalogSentinelRef = useRef<HTMLDivElement>(null);
  const loadRequestRef = useRef(0);
  const loadingMoreRef = useRef(false);
  const pendingConnectionId =
    pendingAction?.kind === "connect" ? pendingAction.installationId : null;
  const customInstallPending = pendingAction?.kind === "custom";
  const isCatalogEntryPending = (
    entry: DesktopConnectorCatalogEntry,
    installed: DesktopConnector | null,
  ): boolean =>
    (pendingAction?.kind === "install" &&
      pendingAction.catalogId === entry.id) ||
    (pendingAction?.kind === "connect" &&
      pendingAction.installationId === installed?.id);

  const loadConnectors = useCallback(async (): Promise<void> => {
    try {
      setConnectors(await window.radius.listConnectors());
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connectors could not be loaded",
      );
    }
  }, []);

  const loadCatalog = useCallback(
    async (search: string, categoryId: string | null): Promise<void> => {
      const requestId = ++loadRequestRef.current;
      setLoading(true);
      try {
        const result = await window.radius.listConnectorCatalog({
          ...(categoryId ? { category: categoryId } : {}),
          ...(search ? { search } : {}),
        });
        if (requestId !== loadRequestRef.current) return;
        setCatalog(result.connectors);
        setCatalogCategories(result.categories);
        setCategoryPreviews(result.categoryPreviews);
        setCatalogNextCursor(result.nextCursor);
        setCatalogError(null);
      } catch {
        if (requestId !== loadRequestRef.current) return;
        setCatalog([]);
        setCatalogCategories([]);
        setCategoryPreviews([]);
        setCatalogNextCursor(null);
        setCatalogError("The public connector catalog is unavailable");
      } finally {
        if (requestId === loadRequestRef.current) setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => void loadConnectors(), 0);
    return () => window.clearTimeout(timer);
  }, [loadConnectors]);

  useEffect(() => {
    const timer = window.setTimeout(
      () => void loadCatalog(query, selectedCategoryId),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [loadCatalog, query, selectedCategoryId]);

  const installedByCatalogId = useMemo(
    () =>
      new Map(
        connectors
          .filter((connector) => connector.catalogExternalId)
          .map((connector) => [connector.catalogExternalId!, connector]),
      ),
    [connectors],
  );
  const customConnectors = useMemo(
    () => connectors.filter((connector) => connector.catalogSource === null),
    [connectors],
  );
  const needsSetup = useMemo(
    () =>
      connectors.filter(
        (connector) =>
          connector.lifecycleState === "staged" ||
          connector.providers.length === 0 ||
          connector.providers.some(
            (provider) => provider.connectionState !== "connected",
          ),
      ),
    [connectors],
  );
  const selectedEntry = useMemo(
    () =>
      catalog.find((entry) => entry.id === selectedCatalogId) ??
      categoryPreviews
        .flatMap((preview) => preview.connectors)
        .find((entry) => entry.id === selectedCatalogId) ??
      null,
    [catalog, categoryPreviews, selectedCatalogId],
  );
  const selectedInstalled = selectedEntry
    ? (installedByCatalogId.get(selectedEntry.sourceServerName) ?? null)
    : null;
  const selectedCategory =
    catalogCategories.find((category) => category.id === selectedCategoryId) ??
    null;
  const categoryLabelById = useMemo(
    () =>
      new Map(
        catalogCategories.map((category) => [category.id, category.label]),
      ),
    [catalogCategories],
  );

  useEffect(() => {
    let disposed = false;
    if (!selectedInstalled) return;
    void window.radius
      .listConnectorTools(selectedInstalled.id)
      .then((tools) => {
        if (!disposed) {
          setEnabledToolsState({
            installationId: selectedInstalled.id,
            tools,
          });
        }
      })
      .catch(() => {
        if (!disposed) {
          setEnabledToolsState({
            installationId: selectedInstalled.id,
            tools: [],
          });
        }
      });
    return () => {
      disposed = true;
    };
  }, [selectedInstalled]);

  const refresh = (): void => {
    void Promise.all([
      loadConnectors(),
      loadCatalog(query, selectedCategoryId),
    ]);
  };

  const openConnector = (catalogId: string): void => {
    setViewDirection("forward");
    setSelectedCatalogId(catalogId);
  };

  const closeConnector = (): void => {
    setViewDirection("back");
    setSelectedCatalogId(null);
  };

  const openCategory = (categoryId: string): void => {
    setViewDirection("forward");
    setCatalog([]);
    setCatalogNextCursor(null);
    setCatalogError(null);
    setQuery("");
    setSelectedCategoryId(categoryId);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };

  const closeCategory = (): void => {
    setViewDirection("back");
    setCatalog([]);
    setCatalogNextCursor(null);
    setCatalogError(null);
    setQuery("");
    setSelectedCategoryId(null);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };

  const loadMore = useCallback(async (): Promise<void> => {
    if (!catalogNextCursor || loadingMoreRef.current) return;
    const requestId = loadRequestRef.current;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    try {
      const result = await window.radius.listConnectorCatalog({
        ...(selectedCategoryId ? { category: selectedCategoryId } : {}),
        cursor: catalogNextCursor,
        ...(query ? { search: query } : {}),
      });
      if (requestId !== loadRequestRef.current) return;
      setCatalog((current) => {
        const byId = new Map(current.map((entry) => [entry.id, entry]));
        for (const entry of result.connectors) byId.set(entry.id, entry);
        return [...byId.values()];
      });
      setCatalogNextCursor(result.nextCursor);
      setCatalogError(null);
    } catch {
      if (requestId === loadRequestRef.current) {
        setCatalogError("Additional connectors could not be loaded");
      }
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [catalogNextCursor, query, selectedCategoryId]);

  useEffect(() => {
    const sentinel = catalogSentinelRef.current;
    if (
      !sentinel ||
      !catalogNextCursor ||
      scope !== "public" ||
      selectedCatalogId !== null ||
      (selectedCategoryId === null && !query)
    ) {
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) void loadMore();
      },
      { rootMargin: "1000px 0px" },
    );
    observer.observe(sentinel);

    return () => observer.disconnect();
  }, [
    catalogNextCursor,
    loadMore,
    query,
    scope,
    selectedCatalogId,
    selectedCategoryId,
  ]);

  const installCustom = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setPendingAction({ kind: "custom" });
    setAddError(null);
    try {
      await window.radius.installConnector({ name: addName, url: addUrl });
      await loadConnectors();
      setAddName("");
      setAddUrl("");
      setAddOpen(false);
      setScope("custom");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setAddError(
        message.includes("CONNECTOR_ENDPOINT_MUST_USE_HTTPS")
          ? "Use an HTTPS URL. HTTP is allowed only for localhost."
          : message.includes("CONNECTOR_ENDPOINT_CREDENTIALS_NOT_ALLOWED")
            ? "Remove credentials from the URL. Radius stores authentication separately."
            : message || "Connector installation failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const installCatalogEntry = async (id: string): Promise<void> => {
    setPendingAction({ kind: "install", catalogId: id });
    try {
      await window.radius.installCatalogConnector(id);
      await loadConnectors();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Connector installation failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const connectConnector = async (installationId: string): Promise<void> => {
    setPendingAction({ kind: "connect", installationId });
    setError(null);
    try {
      await window.radius.connectConnector(installationId);
      await loadConnectors();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "";
      setError(
        message.includes("MCP_OAUTH_CANCELLED")
          ? "Connector authorization was cancelled."
          : message.includes("MCP_OAUTH_TIMEOUT")
            ? "Connector authorization timed out. Try again."
            : message.includes("MCP_OAUTH_STATE_MISMATCH")
              ? "Connector authorization could not be verified."
              : message.includes("MCP_OAUTH_AUTHORIZATION_FAILED")
                ? "Connector authorization was not completed."
                : message || "Connector setup failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const disconnectConnector = async (providerId: string): Promise<void> => {
    setPendingAction({ kind: "disconnect" });
    setError(null);
    try {
      await window.radius.disconnectConnector(providerId);
      await loadConnectors();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Connector disconnect failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    setPendingAction({ kind: "delete" });
    try {
      await window.radius.deleteConnector(deleteTarget.id);
      setDeleteTarget(null);
      await loadConnectors();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Connector deletion failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  let viewKey: string;
  let viewContent: ReactNode;

  if (selectedEntry) {
    viewKey = `detail:${selectedEntry.id}`;
    viewContent = (
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-9">
        <ConnectorDetailView
          backLabel={selectedCategory?.label ?? "All connectors"}
          entry={selectedEntry}
          categoryLabels={selectedEntry.categoryIds.flatMap((categoryId) => {
            const label = categoryLabelById.get(categoryId);
            return label ? [label] : [];
          })}
          installed={selectedInstalled}
          tools={
            selectedInstalled &&
            enabledToolsState?.installationId === selectedInstalled.id
              ? enabledToolsState.tools
              : []
          }
          toolsLoading={Boolean(
            selectedInstalled &&
            enabledToolsState?.installationId !== selectedInstalled.id,
          )}
          pending={pendingAction !== null}
          onBack={closeConnector}
          onInstall={(id) => void installCatalogEntry(id)}
          onConnect={(installationId) => void connectConnector(installationId)}
          onDisconnect={(providerId) => void disconnectConnector(providerId)}
        />
      </section>
    );
  } else if (selectedCategory) {
    viewKey = `category:${selectedCategory.id}`;
    viewContent = (
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-9">
        <Button type="button" variant="ghost" size="sm" onClick={closeCategory}>
          <ArrowLeft className="size-3.5" aria-hidden />
          All connectors
        </Button>

        <h2 className="mt-7 type-lg text-foreground">
          {selectedCategory.label}
        </h2>
        <ConnectorSearch value={query} onChange={setQuery} />

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-center gap-2 text-sm text-negative"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        {catalogError ? (
          <div
            role="status"
            className="mt-5 flex items-center justify-between gap-4 border-y border-border py-3 text-sm text-muted-foreground"
          >
            <span>{catalogError}</span>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              onClick={refresh}
            >
              Retry
            </Button>
          </div>
        ) : null}

        {loading && catalog.length === 0 ? (
          <div className="mt-8 grid gap-3 min-[900px]:grid-cols-2 min-[900px]:gap-x-8">
            {Array.from({ length: 8 }, (_, index) => (
              <Skeleton key={index} className="h-[4.5rem] w-full" />
            ))}
          </div>
        ) : catalog.length > 0 ? (
          <>
            <div className="mt-8 grid border-t border-border pt-1 min-[900px]:grid-cols-2 min-[900px]:gap-x-8">
              {catalog.map((entry) => {
                const installed =
                  installedByCatalogId.get(entry.sourceServerName) ?? null;
                return (
                  <CatalogRow
                    key={entry.id}
                    disabled={pendingAction !== null}
                    entry={entry}
                    installed={installed}
                    pending={isCatalogEntryPending(entry, installed)}
                    onOpen={openConnector}
                    onInstall={(id) => void installCatalogEntry(id)}
                    onConnect={(id) => void connectConnector(id)}
                  />
                );
              })}
            </div>
            {catalogNextCursor ? (
              <div
                ref={catalogSentinelRef}
                className="h-px"
                aria-hidden="true"
              />
            ) : null}
            <div className="flex h-12 items-center justify-center">
              {loadingMore ? (
                <ActivityIndicator
                  label="Loading more connectors"
                  className="text-muted-foreground"
                />
              ) : null}
            </div>
          </>
        ) : !loading && !catalogError ? (
          <div className="py-14 text-center">
            <p className="text-sm text-foreground">
              {query
                ? "No connectors match this search"
                : `No ${selectedCategory.label.toLowerCase()} connectors found`}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {query
                ? "Try a product name, service, or capability."
                : "Return to all connectors and choose another category."}
            </p>
          </div>
        ) : null}
      </section>
    );
  } else {
    viewKey = "root";
    viewContent = (
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <h2 className="type-lg text-foreground">Connectors</h2>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button
              type="button"
              size="icon"
              variant="ghost"
              aria-label="Refresh connectors"
              title="Refresh connectors"
              disabled={loading}
              onClick={refresh}
            >
              <RefreshCw
                className={cn("size-4", loading && "animate-spin")}
                aria-hidden
              />
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={pendingAction !== null}
              onClick={() => {
                setAddError(null);
                setAddOpen(true);
              }}
            >
              <Plus className="size-3.5" aria-hidden />
              Add
            </Button>
          </div>
        </div>

        <ConnectorSearch value={query} onChange={setQuery} />

        {error ? (
          <div
            role="alert"
            className="mt-5 flex items-center gap-2 text-sm text-negative"
          >
            <CircleAlert className="size-4 shrink-0" aria-hidden />
            <span>{error}</span>
          </div>
        ) : null}

        <section
          className="mt-8"
          aria-labelledby="installed-connectors-heading"
        >
          <h3
            id="installed-connectors-heading"
            className="type-md-sm text-foreground"
          >
            Installed
          </h3>
          <div
            className={cn(
              "mt-3 flex items-center gap-3 overflow-x-auto",
              (loading || connectors.length > 0) && "min-h-12 pb-1",
            )}
          >
            {loading && connectors.length === 0 ? (
              Array.from({ length: 8 }, (_, index) => (
                <Skeleton key={index} className="size-12 shrink-0" />
              ))
            ) : connectors.length > 0 ? (
              connectors.map((connector) => (
                <ConnectorLogo
                  key={connector.id}
                  label={connector.displayName}
                  logoUrl={connector.logoUrl}
                />
              ))
            ) : (
              <p className="text-sm text-muted-foreground">
                No connectors installed yet.
              </p>
            )}
          </div>
        </section>

        <SegmentedControl
          className="mt-5"
          size="md"
          ariaLabel="Connector source"
          options={[
            { id: "public", label: "Public" },
            { id: "custom", label: "Custom" },
          ]}
          value={scope}
          onChange={setScope}
        />

        {scope === "custom" ? (
          <CustomConnectorSection
            connectors={customConnectors}
            disabled={pendingAction !== null}
            pendingId={pendingConnectionId}
            onConnect={(id) => void connectConnector(id)}
            onDelete={setDeleteTarget}
          />
        ) : (
          <>
            {needsSetup.some(
              (connector) => connector.catalogSource !== null,
            ) ? (
              <NeedsSetupSection
                connectors={needsSetup.filter(
                  (connector) => connector.catalogSource !== null,
                )}
                disabled={pendingAction !== null}
                pendingId={pendingConnectionId}
                onConnect={(id) => void connectConnector(id)}
              />
            ) : null}

            {catalogError ? (
              <div
                role="status"
                className="mt-5 flex items-center justify-between gap-4 border-y border-border py-3 text-sm text-muted-foreground"
              >
                <span>The public connector catalog is unavailable.</span>
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  onClick={refresh}
                >
                  Retry
                </Button>
              </div>
            ) : null}

            {query && catalog.length > 0 ? (
              <section
                className="mt-9"
                aria-labelledby="connector-search-results-heading"
              >
                <h3
                  id="connector-search-results-heading"
                  className="type-md-sm text-foreground"
                >
                  Search results
                </h3>
                <div className="mt-3 grid border-t border-border pt-1 min-[900px]:grid-cols-2 min-[900px]:gap-x-8">
                  {catalog.map((entry) => {
                    const installed =
                      installedByCatalogId.get(entry.sourceServerName) ?? null;
                    return (
                      <CatalogRow
                        key={entry.id}
                        disabled={pendingAction !== null}
                        entry={entry}
                        installed={installed}
                        pending={isCatalogEntryPending(entry, installed)}
                        onOpen={openConnector}
                        onInstall={(id) => void installCatalogEntry(id)}
                        onConnect={(id) => void connectConnector(id)}
                      />
                    );
                  })}
                </div>
                {catalogNextCursor ? (
                  <div
                    ref={catalogSentinelRef}
                    className="h-px"
                    aria-hidden="true"
                  />
                ) : null}
                <div className="flex h-12 items-center justify-center">
                  {loadingMore ? (
                    <ActivityIndicator
                      label="Loading more connectors"
                      className="text-muted-foreground"
                    />
                  ) : null}
                </div>
              </section>
            ) : null}

            {!query && categoryPreviews.length > 0
              ? categoryPreviews.map((preview) => {
                  const category = catalogCategories.find(
                    (value) => value.id === preview.categoryId,
                  );
                  if (!category || preview.connectors.length === 0) return null;
                  const headingId = `connector-category-${category.id}`;
                  return (
                    <section
                      key={category.id}
                      className="mt-9"
                      aria-labelledby={headingId}
                    >
                      <div className="flex items-center justify-between gap-4">
                        <h3
                          id={headingId}
                          className="type-md-sm text-foreground"
                        >
                          {category.label}
                        </h3>
                        <Button
                          type="button"
                          size="xs"
                          variant="ghost"
                          onClick={() => openCategory(category.id)}
                        >
                          See more
                          <ChevronRight className="size-3.5" aria-hidden />
                        </Button>
                      </div>
                      <div className="mt-3 grid border-t border-border pt-1 min-[900px]:grid-cols-2 min-[900px]:gap-x-8">
                        {preview.connectors.map((entry) => {
                          const installed =
                            installedByCatalogId.get(entry.sourceServerName) ??
                            null;
                          return (
                            <CatalogRow
                              key={entry.id}
                              disabled={pendingAction !== null}
                              entry={entry}
                              installed={installed}
                              pending={isCatalogEntryPending(entry, installed)}
                              onOpen={openConnector}
                              onInstall={(id) => void installCatalogEntry(id)}
                              onConnect={(id) => void connectConnector(id)}
                            />
                          );
                        })}
                      </div>
                    </section>
                  );
                })
              : null}

            {!query && loading && categoryPreviews.length === 0 ? (
              <div className="mt-9 grid gap-8">
                {Array.from({ length: 3 }, (_, index) => (
                  <div key={index}>
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="mt-3 h-36 w-full" />
                  </div>
                ))}
              </div>
            ) : null}

            {!loading && !catalogError && query && catalog.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-sm text-foreground">
                  No connectors match this search
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Try a product name, service, or capability.
                </p>
              </div>
            ) : null}

            {!loading &&
            !catalogError &&
            !query &&
            categoryPreviews.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-sm text-foreground">
                  No categorized connectors found
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Refresh after the category catalog has been synchronized.
                </p>
              </div>
            ) : null}
          </>
        )}
      </section>
    );
  }

  const viewMotionContext: ConnectorViewMotionContext = {
    direction: viewDirection,
    reduceMotion,
  };

  return (
    <>
      <div className="relative">
        <AnimatePresence
          initial={false}
          mode="popLayout"
          custom={viewMotionContext}
        >
          <motion.div
            key={viewKey}
            custom={viewMotionContext}
            variants={CONNECTOR_VIEW_VARIANTS}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{
              duration: reduceMotion ? 0.1 : 0.16,
              ease: CONNECTOR_VIEW_EASE,
            }}
            className="w-full"
          >
            {viewContent}
          </motion.div>
        </AnimatePresence>
      </div>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (!customInstallPending) {
            setAddOpen(open);
            if (!open) setAddError(null);
          }
        }}
      >
        <DialogContent showCloseButton={false} className="sm:max-w-xl">
          <form
            className="grid gap-5"
            onSubmit={(event) => void installCustom(event)}
          >
            <DialogHeader>
              <DialogTitle className="type-md font-normal">
                Add custom connector
              </DialogTitle>
              <DialogDescription className="leading-relaxed">
                Connect Radius to an MCP server you trust.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-4">
              <label className="grid gap-2 text-sm text-foreground">
                <span className="font-medium">Name</span>
                <Input
                  autoFocus
                  autoComplete="off"
                  value={addName}
                  placeholder="tools.example"
                  maxLength={120}
                  disabled={customInstallPending}
                  onChange={(event) => setAddName(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm text-foreground">
                <span className="font-medium">MCP server URL</span>
                <Input
                  type="url"
                  autoComplete="url"
                  value={addUrl}
                  placeholder="https://mcp.tools.example/mcp"
                  disabled={customInstallPending}
                  onChange={(event) => setAddUrl(event.target.value)}
                />
              </label>
            </div>

            <p className="text-sm leading-relaxed text-muted-foreground">
              Only add connectors from developers you trust. Tools exposed by
              this server can change over time.
            </p>

            {addError ? (
              <div
                role="alert"
                className="flex items-start gap-2 text-sm text-negative"
              >
                <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{addError}</span>
              </div>
            ) : null}

            <DialogFooter>
              <DialogClose asChild>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={customInstallPending}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  customInstallPending || !addName.trim() || !addUrl.trim()
                }
              >
                Add
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open && pendingAction === null) setDeleteTarget(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="type-md-sm font-normal">
              Delete {deleteTarget?.displayName}?
            </DialogTitle>
            <DialogDescription className="leading-relaxed">
              This deletes the connector from your profile and every computer.
              Historical tool activity remains in session history.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="secondary">
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="button"
              variant="destructive"
              disabled={pendingAction !== null}
              onClick={() => void remove()}
            >
              Delete connector
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

function NeedsSetupSection({
  connectors,
  disabled,
  pendingId,
  onConnect,
}: {
  connectors: DesktopConnector[];
  disabled: boolean;
  pendingId: string | null;
  onConnect: (installationId: string) => void;
}): ReactNode {
  return (
    <section className="mt-9" aria-labelledby="needs-setup-heading">
      <h3 id="needs-setup-heading" className="type-md-sm text-foreground">
        Needs setup
      </h3>
      <div className="mt-3 border-t border-border">
        {connectors.map((connector) => (
          <div
            key={connector.id}
            className="flex min-h-[4.75rem] items-center gap-3 border-b border-border py-3"
          >
            <ConnectorLogo
              label={connector.displayName}
              logoUrl={connector.logoUrl}
              small
            />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium text-foreground">
                {connector.displayName}
              </p>
              <p className="mt-0.5 text-sm text-muted-foreground">
                {connector.providers[0]
                  ? connectionLabel(connector.providers[0].connectionState)
                  : "No account connected on this Mac"}
              </p>
            </div>
            <Button
              type="button"
              size="xs"
              variant="secondary"
              disabled={disabled}
              onClick={() => onConnect(connector.id)}
            >
              {pendingId === connector.id ? "Connecting" : "Finish setup"}
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomConnectorSection({
  connectors,
  disabled,
  pendingId,
  onConnect,
  onDelete,
}: {
  connectors: DesktopConnector[];
  disabled: boolean;
  pendingId: string | null;
  onConnect: (installationId: string) => void;
  onDelete: (connector: DesktopConnector) => void;
}): ReactNode {
  return (
    <section className="mt-6" aria-labelledby="custom-connectors-heading">
      <h3 id="custom-connectors-heading" className="type-md-sm text-foreground">
        Custom connectors
      </h3>
      <div className="mt-3 border-t border-border">
        {connectors.length === 0 ? (
          <div className="py-8 text-center">
            <p className="text-sm text-foreground">No custom connectors</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Use Add to connect an MCP server by URL.
            </p>
          </div>
        ) : (
          connectors.map((connector) => (
            <div
              key={connector.id}
              className="flex min-h-[4.75rem] items-center gap-3 border-b border-border py-3"
            >
              <ConnectorLogo
                label={connector.displayName}
                logoUrl={connector.logoUrl}
                small
              />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-foreground">
                  {connector.displayName}
                </p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {connector.providers[0]
                    ? `${connectionLabel(connector.providers[0].connectionState)}, ${connector.providers[0].toolCount} enabled ${connector.providers[0].toolCount === 1 ? "tool" : "tools"}`
                    : "Needs setup"}
                </p>
                <p
                  className="mt-0.5 line-clamp-1 text-xs text-muted-foreground"
                  title={connector.description}
                >
                  {connector.description}
                </p>
              </div>
              {installStatus(connector) === "Needs setup" ? (
                <Button
                  type="button"
                  size="xs"
                  variant="secondary"
                  disabled={disabled}
                  onClick={() => onConnect(connector.id)}
                >
                  {pendingId === connector.id ? "Connecting" : "Finish setup"}
                </Button>
              ) : null}
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => onDelete(connector)}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Delete
              </Button>
            </div>
          ))
        )}
      </div>
    </section>
  );
}
