import { useEffect, useRef, type ReactNode } from "react";

import { SettingsPage } from "@renderer/app/settings/page";
import { WorkspacePage } from "@renderer/app/workspace/page";
import { SettingsShell } from "@renderer/components/shell/settings-shell";
import { WorkspaceShell } from "@renderer/components/shell/workspace-shell";
import { useWorkspaceNavigation } from "@renderer/components/shell/navigation-context";
import { useIsPresent } from "@renderer/components/shell/route-presence";
import { WorkspaceNavigationProvider } from "@renderer/components/shell/workspace-navigation-provider";
import { ProjectProvider } from "@renderer/components/shell/project-context";
import { ThemeProvider } from "@renderer/components/shell/theme-provider";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";

const SETTINGS_ROUTE_EASE = [0.23, 1, 0.32, 1] as const;

function RouteSurface({
  kind,
  reduceMotion,
  children,
}: {
  kind: "settings" | "workspace";
  reduceMotion: boolean;
  children: ReactNode;
}): ReactNode {
  const isPresent = useIsPresent();
  const surfaceRef = useRef<HTMLDivElement>(null);
  const initialTransform =
    !reduceMotion && kind === "settings"
      ? "translateX(-8px)"
      : "translateX(0px)";

  useEffect(() => {
    if (!isPresent) return;

    const frame = window.requestAnimationFrame(() => {
      surfaceRef.current?.querySelector<HTMLElement>("#main-content")?.focus();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [isPresent]);

  return (
    <motion.div
      ref={surfaceRef}
      data-route-surface={kind}
      aria-hidden={!isPresent}
      inert={!isPresent}
      initial={{
        opacity: 0,
        transform: initialTransform,
        pointerEvents: "none",
      }}
      animate={{
        opacity: 1,
        transform: "translateX(0px)",
        pointerEvents: "auto",
      }}
      exit={{
        opacity: 0,
        transform: initialTransform,
        pointerEvents: "none",
      }}
      transition={{
        duration: reduceMotion ? 0.1 : 0.16,
        ease: SETTINGS_ROUTE_EASE,
      }}
      className="absolute inset-0"
    >
      {children}
    </motion.div>
  );
}

function AppContent(): ReactNode {
  const { activeView, canGoBack, goBack, navigate } = useWorkspaceNavigation();
  const reduceMotion = useReducedMotion();
  const routeKind = activeView === "settings" ? "settings" : "workspace";

  return (
    <div className="relative h-dvh overflow-hidden">
      <AnimatePresence initial={false} mode="sync">
        <RouteSurface
          key={routeKind}
          kind={routeKind}
          reduceMotion={reduceMotion === true}
        >
          {activeView === "settings" ? (
            <SettingsShell
              onBack={canGoBack ? goBack : () => navigate("workspace")}
            >
              <SettingsPage />
            </SettingsShell>
          ) : (
            <WorkspaceShell>
              <WorkspacePage view={activeView} />
            </WorkspaceShell>
          )}
        </RouteSurface>
      </AnimatePresence>
    </div>
  );
}

export function App(): ReactNode {
  return (
    <ThemeProvider>
      <WorkspaceNavigationProvider>
        <ProjectProvider>
          <AppContent />
        </ProjectProvider>
      </WorkspaceNavigationProvider>
    </ThemeProvider>
  );
}
