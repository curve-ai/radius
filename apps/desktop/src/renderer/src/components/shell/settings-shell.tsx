import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Cloud, Search, Settings, SunMoon } from "lucide-react";

import { cn } from "@renderer/lib/utils";
import {
  SETTINGS_SECTIONS,
  SETTINGS_SECTION_IDS,
  type SettingsSectionId,
} from "./settings-sections";

const settingsNavigation = [
  {
    group: "Workspace",
    items: [
      {
        id: SETTINGS_SECTIONS.general.id,
        label: SETTINGS_SECTIONS.general.label,
        keywords: "local storage platform",
        icon: Settings,
      },
      {
        id: SETTINGS_SECTIONS.appearance.id,
        label: SETTINGS_SECTIONS.appearance.label,
        keywords: "theme system light dark color scheme",
        icon: SunMoon,
      },
    ],
  },
  {
    group: "Connections",
    items: [
      {
        id: SETTINGS_SECTIONS.dataSync.id,
        label: SETTINGS_SECTIONS.dataSync.label,
        keywords: "cloud provider backup sessions artifacts",
        icon: Cloud,
      },
    ],
  },
] as const;

export function SettingsShell({
  onBack,
  children,
}: {
  onBack: () => void;
  children: ReactNode;
}): ReactNode {
  const mainContentRef = useRef<HTMLElement>(null);
  const programmaticScrollTimeoutRef = useRef<number | null>(null);
  const [query, setQuery] = useState("");
  const [activeItem, setActiveItem] = useState<SettingsSectionId>(
    SETTINGS_SECTIONS.general.id,
  );
  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleGroups = useMemo(
    () =>
      settingsNavigation
        .map((group) => ({
          ...group,
          items: group.items.filter((item) =>
            `${item.label} ${item.keywords}`
              .toLocaleLowerCase()
              .includes(normalizedQuery),
          ),
        }))
        .filter((group) => group.items.length > 0),
    [normalizedQuery],
  );

  useEffect(() => {
    const main = mainContentRef.current;
    if (!main) return;

    let frame = 0;
    const syncActiveSection = (): void => {
      const activationTop = main.getBoundingClientRect().top + 96;
      let nextSection: SettingsSectionId = SETTINGS_SECTION_IDS[0];

      for (const id of SETTINGS_SECTION_IDS) {
        const section = document.getElementById(id);
        if (section && section.getBoundingClientRect().top <= activationTop) {
          nextSection = id;
        }
      }
      setActiveItem((current) =>
        current === nextSection ? current : nextSection,
      );
    };
    const handleScroll = (): void => {
      if (programmaticScrollTimeoutRef.current !== null) return;
      window.cancelAnimationFrame(frame);
      frame = window.requestAnimationFrame(syncActiveSection);
    };

    syncActiveSection();
    main.addEventListener("scroll", handleScroll, { passive: true });
    return () => {
      main.removeEventListener("scroll", handleScroll);
      window.cancelAnimationFrame(frame);
      if (programmaticScrollTimeoutRef.current !== null) {
        window.clearTimeout(programmaticScrollTimeoutRef.current);
      }
    };
  }, []);

  const navigateTo = (id: SettingsSectionId): void => {
    setActiveItem(id);
    if (programmaticScrollTimeoutRef.current !== null) {
      window.clearTimeout(programmaticScrollTimeoutRef.current);
    }
    programmaticScrollTimeoutRef.current = window.setTimeout(() => {
      programmaticScrollTimeoutRef.current = null;
    }, 500);
    document.getElementById(id)?.scrollIntoView({
      behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches
        ? "auto"
        : "smooth",
      block: "start",
    });
  };

  return (
    <div className="relative flex h-dvh min-h-0 bg-transparent text-foreground">
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[80] focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:text-background"
      >
        Skip to content
      </a>

      <aside className="radius-settings-sidebar-material relative z-10 flex h-full w-72 shrink-0 flex-col border-r border-sidebar-border px-3 text-sidebar-foreground">
        <div className="electron-window-drag absolute inset-x-0 top-0 h-8" />
        <button
          type="button"
          className="mt-12 flex h-9 w-fit items-center gap-2 rounded-md px-2 text-sm text-muted-foreground transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/50"
          onClick={onBack}
        >
          <ArrowLeft className="size-4" aria-hidden />
          Back to Radius
        </button>

        <label className="relative mt-4 block">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <span className="sr-only">Search settings</span>
          <input
            type="search"
            value={query}
            placeholder="Search settings…"
            className="h-9 w-full rounded-full border border-sidebar-border bg-background/90 pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-sidebar-ring/40"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>

        <nav
          className="mt-5 min-h-0 flex-1 overflow-y-auto pb-6"
          aria-label="Settings"
        >
          {visibleGroups.map((group) => (
            <div key={group.group} className="mb-5">
              <p className="mb-1 px-2 text-xs text-muted-foreground">
                {group.group}
              </p>
              <div className="space-y-0.5">
                {group.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={activeItem === item.id ? "page" : undefined}
                    className={cn(
                      "flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring/40",
                      activeItem === item.id
                        ? "bg-sidebar-accent text-sidebar-accent-foreground"
                        : "hover:bg-sidebar-accent/60",
                    )}
                    onClick={() => navigateTo(item.id)}
                  >
                    <item.icon className="size-4 shrink-0" aria-hidden />
                    <span>{item.label}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
          {visibleGroups.length === 0 && (
            <p className="px-2 text-sm text-muted-foreground">
              No settings found.
            </p>
          )}
        </nav>
      </aside>

      <div className="relative min-w-0 flex-1 bg-background">
        <div className="electron-window-drag absolute inset-x-0 top-0 z-20 h-8" />
        <main
          ref={mainContentRef}
          id="main-content"
          className="h-full overflow-y-auto outline-none focus:outline-none focus-visible:outline-none"
          tabIndex={-1}
        >
          {children}
        </main>
      </div>
    </div>
  );
}
