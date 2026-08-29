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
  DesktopConnectorCatalogEntry,
  DesktopConnectorEnabledTool,
} from "../../../../radius-api";

type CatalogCategory = DesktopConnectorCatalogEntry["category"];
type ConnectorViewDirection = "back" | "forward";
type ConnectorViewMotionContext = {
  direction: ConnectorViewDirection;
  reduceMotion: boolean;
};

type CatalogSection = {
  category: CatalogCategory;
  entries: DesktopConnectorCatalogEntry[];
  key: string;
  label: string;
};

const CATEGORY_LABELS: Record<CatalogCategory, string> = {
  productivity: "Productivity",
  developer_tools: "Developer tools",
  data: "Data",
  finance: "Finance",
  communication: "Communication",
  other: "More connectors",
};

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
  entry,
  installed,
  pending,
  onOpen,
  onInstall,
}: {
  entry: DesktopConnectorCatalogEntry;
  installed: DesktopConnector | null;
  pending: boolean;
  onOpen: (id: string) => void;
  onInstall: (id: string) => void;
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
            disabled
            title="Authentication setup is not available for this connector yet"
          >
            Finish setup
          </Button>
        ) : (
          <span className="px-2 text-xs text-muted-foreground">Installed</span>
        )
      ) : installable ? (
        <Button
          type="button"
          size="xs"
          variant="secondary"
          disabled={pending}
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
  installed,
  tools,
  toolsLoading,
  pending,
  onBack,
  onInstall,
}: {
  backLabel: string;
  entry: DesktopConnectorCatalogEntry;
  installed: DesktopConnector | null;
  tools: DesktopConnectorEnabledTool[];
  toolsLoading: boolean;
  pending: boolean;
  onBack: () => void;
  onInstall: (id: string) => void;
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
              <div key={provider.id}>
                <p className="text-sm text-foreground">{provider.label}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {connectionLabel(provider.connectionState)},{" "}
                  {provider.toolCount} enabled tools
                </p>
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
  const reduceMotion = useReducedMotion();
  const [addOpen, setAddOpen] = useState(false);
  const [addName, setAddName] = useState("");
  const [addUrl, setAddUrl] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<DesktopConnectorCatalogEntry[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [connectors, setConnectors] = useState<DesktopConnector[]>([]);
  const [deleteTarget, setDeleteTarget] = useState<DesktopConnector | null>(
    null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [catalogNextCursor, setCatalogNextCursor] = useState<string | null>(
    null,
  );
  const [selectedCategory, setSelectedCategory] =
    useState<CatalogCategory | null>(null);
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
  const loadRequestRef = useRef(0);

  const load = useCallback(
    async (search: string, category: CatalogCategory | null): Promise<void> => {
      const requestId = ++loadRequestRef.current;
      setLoading(true);
      const [localResult, catalogResult] = await Promise.allSettled([
        window.radius.listConnectors(),
        window.radius.listConnectorCatalog({
          ...(category ? { category } : {}),
          ...(search ? { search } : {}),
        }),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (localResult.status === "fulfilled") {
        setConnectors(localResult.value);
        setError(null);
      } else {
        setError(
          localResult.reason instanceof Error
            ? localResult.reason.message
            : "Connectors could not be loaded",
        );
      }
      if (catalogResult.status === "fulfilled") {
        setCatalog(catalogResult.value.connectors);
        setCatalogNextCursor(catalogResult.value.nextCursor);
        setCatalogError(null);
      } else {
        setCatalog([]);
        setCatalogNextCursor(null);
        setCatalogError("The public connector catalog is unavailable");
      }
      setLoading(false);
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(
      () => void load(query, selectedCategory),
      250,
    );
    return () => window.clearTimeout(timer);
  }, [load, query, selectedCategory]);

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
  const catalogSections = useMemo(() => {
    const sections: CatalogSection[] = [];
    const categories = new Map<
      CatalogCategory,
      DesktopConnectorCatalogEntry[]
    >();
    for (const entry of catalog) {
      const values = categories.get(entry.category) ?? [];
      values.push(entry);
      categories.set(entry.category, values);
    }
    for (const [category, entries] of categories) {
      sections.push({
        category,
        entries,
        key: `category-${category}`,
        label: CATEGORY_LABELS[category],
      });
    }
    return sections;
  }, [catalog]);
  const selectedEntry = useMemo(
    () => catalog.find((entry) => entry.id === selectedCatalogId) ?? null,
    [catalog, selectedCatalogId],
  );
  const selectedInstalled = selectedEntry
    ? (installedByCatalogId.get(selectedEntry.sourceServerName) ?? null)
    : null;

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
    void load(query, selectedCategory);
  };

  const openConnector = (catalogId: string): void => {
    setViewDirection("forward");
    setSelectedCatalogId(catalogId);
  };

  const closeConnector = (): void => {
    setViewDirection("back");
    setSelectedCatalogId(null);
  };

  const openCategory = (category: CatalogCategory): void => {
    setViewDirection("forward");
    setCatalog([]);
    setCatalogNextCursor(null);
    setCatalogError(null);
    setQuery("");
    setSelectedCategory(category);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };

  const closeCategory = (): void => {
    setViewDirection("back");
    setCatalog([]);
    setCatalogNextCursor(null);
    setCatalogError(null);
    setQuery("");
    setSelectedCategory(null);
    document.getElementById("main-content")?.scrollTo({ top: 0 });
  };

  const loadMore = async (): Promise<void> => {
    if (!selectedCategory || !catalogNextCursor || loadingMore) return;
    const requestId = loadRequestRef.current;
    setLoadingMore(true);
    try {
      const result = await window.radius.listConnectorCatalog({
        category: selectedCategory,
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
        setCatalogError("More connectors could not be loaded");
      }
    } finally {
      setLoadingMore(false);
    }
  };

  const installCustom = async (
    event: FormEvent<HTMLFormElement>,
  ): Promise<void> => {
    event.preventDefault();
    setPendingAction("custom");
    setAddError(null);
    try {
      await window.radius.installConnector({ name: addName, url: addUrl });
      await load(query, selectedCategory);
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
    setPendingAction(id);
    try {
      await window.radius.installCatalogConnector(id);
      await load(query, selectedCategory);
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

  const remove = async (): Promise<void> => {
    if (!deleteTarget) return;
    setPendingAction(deleteTarget.id);
    try {
      await window.radius.deleteConnector(deleteTarget.id);
      setDeleteTarget(null);
      await load(query, selectedCategory);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Connector deletion failed",
      );
    } finally {
      setPendingAction(null);
    }
  };

  let viewKey: string;
  let viewDepth: 0 | 1 | 2;
  let viewContent: ReactNode;

  if (selectedEntry) {
    viewKey = `detail:${selectedEntry.id}`;
    viewDepth = 2;
    viewContent = (
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-9">
        <ConnectorDetailView
          backLabel={
            selectedCategory
              ? CATEGORY_LABELS[selectedCategory]
              : "All connectors"
          }
          entry={selectedEntry}
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
        />
      </section>
    );
  } else if (selectedCategory) {
    const categoryLabel = CATEGORY_LABELS[selectedCategory];
    viewKey = `category:${selectedCategory}`;
    viewDepth = 1;
    viewContent = (
      <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-7 sm:px-8 sm:pt-9">
        <Button type="button" variant="ghost" size="sm" onClick={closeCategory}>
          <ArrowLeft className="size-3.5" aria-hidden />
          All connectors
        </Button>

        <h2 className="mt-7 type-lg text-foreground">{categoryLabel}</h2>
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
            {Array.from({ length: 10 }, (_, index) => (
              <Skeleton key={index} className="h-[4.5rem] w-full" />
            ))}
          </div>
        ) : catalog.length > 0 ? (
          <>
            <div className="mt-8 grid border-t border-border min-[900px]:grid-cols-2 min-[900px]:gap-x-8">
              {catalog.map((entry) => (
                <CatalogRow
                  key={entry.id}
                  entry={entry}
                  installed={
                    installedByCatalogId.get(entry.sourceServerName) ?? null
                  }
                  pending={pendingAction !== null}
                  onOpen={openConnector}
                  onInstall={(id) => void installCatalogEntry(id)}
                />
              ))}
            </div>
            {catalogNextCursor ? (
              <div className="mt-7 flex justify-center">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={loadingMore}
                  onClick={() => void loadMore()}
                >
                  {loadingMore ? "Loading" : "Load more"}
                </Button>
              </div>
            ) : null}
          </>
        ) : !loading && !catalogError ? (
          <div className="py-14 text-center">
            <p className="text-sm text-foreground">
              No {categoryLabel.toLowerCase()} match this search
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Try a product name, service, or capability.
            </p>
          </div>
        ) : null}
      </section>
    );
  } else {
    viewKey = "root";
    viewDepth = 0;
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
            onDelete={setDeleteTarget}
          />
        ) : (
          <>
            {needsSetup.length > 0 ? (
              <NeedsSetupSection connectors={needsSetup} />
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

            {catalogSections.map((section) => {
              const sectionId = `connector-section-${section.label
                .replace(/\s+/g, "-")
                .toLowerCase()}`;
              return (
                <section
                  key={section.key}
                  className="mt-9"
                  aria-labelledby={sectionId}
                >
                  <div className="flex items-center justify-between gap-4">
                    <h3 id={sectionId} className="type-md-sm text-foreground">
                      {section.label}
                    </h3>
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      onClick={() => openCategory(section.category)}
                    >
                      Show more
                      <ChevronRight className="size-3.5" aria-hidden />
                    </Button>
                  </div>
                  <div className="mt-3 grid border-t border-border min-[900px]:grid-cols-2 min-[900px]:gap-x-8">
                    {section.entries.map((entry) => (
                      <CatalogRow
                        key={entry.id}
                        entry={entry}
                        installed={
                          installedByCatalogId.get(entry.sourceServerName) ??
                          null
                        }
                        pending={pendingAction !== null}
                        onOpen={openConnector}
                        onInstall={(id) => void installCatalogEntry(id)}
                      />
                    ))}
                  </div>
                </section>
              );
            })}

            {!loading && !catalogError && catalogSections.length === 0 ? (
              <div className="py-14 text-center">
                <p className="text-sm text-foreground">
                  {query
                    ? "No connectors match this search"
                    : "No public connectors found"}
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  {query
                    ? "Try a product name, service, or capability."
                    : "Refresh after the public catalog has been synchronized."}
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
    reduceMotion: reduceMotion === true,
  };

  return (
    <>
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
            duration: reduceMotion === true ? 0.1 : 0.16,
            ease: CONNECTOR_VIEW_EASE,
          }}
          data-connector-view-depth={viewDepth}
          className="w-full"
        >
          {viewContent}
        </motion.div>
      </AnimatePresence>

      <Dialog
        open={addOpen}
        onOpenChange={(open) => {
          if (pendingAction !== "custom") {
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
                  placeholder="openbudget.sh"
                  maxLength={120}
                  disabled={pendingAction === "custom"}
                  onChange={(event) => setAddName(event.target.value)}
                />
              </label>
              <label className="grid gap-2 text-sm text-foreground">
                <span className="font-medium">MCP server URL</span>
                <Input
                  type="url"
                  autoComplete="url"
                  value={addUrl}
                  placeholder="https://api.openbudget.sh/mcp"
                  disabled={pendingAction === "custom"}
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
                  disabled={pendingAction === "custom"}
                >
                  Cancel
                </Button>
              </DialogClose>
              <Button
                type="submit"
                disabled={
                  pendingAction === "custom" ||
                  !addName.trim() ||
                  !addUrl.trim()
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
}: {
  connectors: DesktopConnector[];
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
              disabled
              title="Authentication setup is not available for this connector yet"
            >
              Finish setup
            </Button>
          </div>
        ))}
      </div>
    </section>
  );
}

function CustomConnectorSection({
  connectors,
  onDelete,
}: {
  connectors: DesktopConnector[];
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
                <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">
                  {connector.description}
                </p>
              </div>
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
