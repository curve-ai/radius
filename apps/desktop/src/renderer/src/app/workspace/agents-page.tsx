import { Bot, CircleAlert, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { cn } from "@renderer/lib/utils";
import type { DesktopAgentSummary } from "../../../../radius-api";
import { agentErrorMessage } from "./agent-errors";

const AGENT_AUTH_STATE_EASE = [0.23, 1, 0.32, 1] as const;
const AGENT_UPDATED_AT_FORMATTER = new Intl.DateTimeFormat(undefined, {
  month: "short",
  day: "numeric",
  year: "numeric",
});

function agentUpdatedMetadata(updatedAt?: string | null): {
  label: string;
  title?: string;
} {
  if (!updatedAt) return { label: "Updated recently" };
  const date = new Date(updatedAt);
  if (Number.isNaN(date.getTime())) return { label: "Updated recently" };
  return {
    label: `Updated ${AGENT_UPDATED_AT_FORMATTER.format(date)}`,
    title: date.toLocaleString(),
  };
}

export function AgentsPage(): ReactNode {
  const reduceMotion = useReducedMotion() === true;
  const [agents, setAgents] = useState<DesktopAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const enterTransform = reduceMotion ? "translateY(0px)" : "translateY(2px)";
  const exitTransform = reduceMotion ? "translateY(0px)" : "translateY(-2px)";
  const authStateMotionProps = {
    initial: { opacity: 0, transform: enterTransform },
    animate: { opacity: 1, transform: "translateY(0px)" },
    exit: {
      opacity: 0,
      transform: exitTransform,
      transition: {
        duration: 0.1,
        ease: AGENT_AUTH_STATE_EASE,
      },
    },
    transition: {
      duration: reduceMotion ? 0.1 : 0.16,
      ease: AGENT_AUTH_STATE_EASE,
    },
  };

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setAgents(await window.radius.listAgents());
      setError(null);
    } catch (cause) {
      setError(
        agentErrorMessage(
          cause,
          "Agents could not be loaded. Restart Radius and try again.",
        ),
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    const unsubscribe = window.radius.onAgentsChanged(() => void load());
    return () => {
      window.cancelAnimationFrame(frame);
      unsubscribe();
    };
  }, [load]);

  const connect = async (agentId: string): Promise<void> => {
    setPendingAgentId(agentId);
    setError(null);
    try {
      const updated = await window.radius.connectAgentAuthentication(agentId);
      setAgents((current) =>
        current.map((agent) => (agent.id === updated.id ? updated : agent)),
      );
    } catch (cause) {
      setError(
        agentErrorMessage(
          cause,
          "Agent sign-in could not be completed. Try again.",
        ),
      );
    } finally {
      setPendingAgentId(null);
    }
  };

  const disconnect = async (agentId: string): Promise<void> => {
    setPendingAgentId(agentId);
    setError(null);
    try {
      const updated =
        await window.radius.disconnectAgentAuthentication(agentId);
      setAgents((current) =>
        current.map((agent) => (agent.id === updated.id ? updated : agent)),
      );
    } catch (cause) {
      setError(
        agentErrorMessage(
          cause,
          "Agent sign-out could not be completed. Try again.",
        ),
      );
    } finally {
      setPendingAgentId(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
      <div className="flex items-start justify-between gap-6">
        <h2 className="min-w-0 type-lg text-foreground">Agents</h2>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          aria-label="Refresh agents"
          title="Refresh agents"
          disabled={loading || pendingAgentId !== null}
          onClick={() => void load()}
        >
          <RefreshCw
            className={cn("size-4", loading && "animate-spin")}
            aria-hidden
          />
        </Button>
      </div>

      {error ? (
        <div
          role="alert"
          className="mt-5 flex items-center gap-2 text-sm text-negative"
        >
          <CircleAlert className="size-4 shrink-0" aria-hidden />
          <span>{error}</span>
        </div>
      ) : null}

      <section className="mt-7" aria-label="Installed agents">
        <div>
          {loading && agents.length === 0 ? (
            <div className="flex min-h-14 items-center gap-2.5 py-2">
              <Skeleton className="size-8 shrink-0 rounded-md" />
              <div className="flex min-w-0 flex-1 items-center gap-2">
                <Skeleton className="h-5 w-20 shrink-0" />
                <Skeleton className="h-3 w-24 shrink-0" />
                <Skeleton className="h-3 w-52 max-w-full" />
              </div>
              <Skeleton className="h-8 w-20 rounded-full" />
            </div>
          ) : agents.length === 0 ? (
            <div className="py-12 text-center">
              <p className="text-sm text-foreground">No agents delivered</p>
              <p className="mt-1 text-sm text-muted-foreground">
                This Radius distribution has no bundled or assigned agents.
              </p>
            </div>
          ) : (
            agents.map((agent) => {
              const connected =
                agent.authentication.state === "connected" ||
                agent.authentication.state === "not_required";
              const pending = pendingAgentId === agent.id;
              const authenticationStateKey = agent.authentication.state;
              const actionStateKey = `${authenticationStateKey}:${pending ? "pending" : "settled"}`;
              const updated = agentUpdatedMetadata(agent.updatedAt);
              return (
                <div
                  key={agent.id}
                  className="flex min-h-14 items-center gap-2.5 py-2"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Bot className="size-4" aria-hidden />
                  </div>
                  <div className="relative flex min-w-0 flex-1 items-center gap-2">
                    <p className="min-w-0 truncate text-base font-medium text-foreground">
                      {agent.label}
                    </p>
                    {agent.releaseVersion ? (
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {agent.releaseVersion}
                      </span>
                    ) : null}
                    <span
                      className="min-w-0 flex-1 truncate text-sm text-muted-foreground"
                      title={updated.title}
                    >
                      {updated.label}
                    </span>
                  </div>
                  <div className="relative flex min-h-8 w-36 shrink-0 justify-end">
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.div
                        key={`action:${actionStateKey}`}
                        {...authStateMotionProps}
                        className="flex min-h-8 items-center justify-end"
                      >
                        {connected &&
                        agent.authentication.state !== "not_required" ? (
                          <Button
                            type="button"
                            size="xs"
                            variant="ghost"
                            disabled={pending}
                            onClick={() => void disconnect(agent.id)}
                          >
                            {pending ? "Signing out" : "Sign out"}
                          </Button>
                        ) : agent.authentication.state ===
                          "not_required" ? null : (
                          <Button
                            type="button"
                            size="sm"
                            variant="secondary"
                            disabled={pending}
                            onClick={() => void connect(agent.id)}
                          >
                            {pending ? "Waiting for browser" : "Sign in"}
                          </Button>
                        )}
                      </motion.div>
                    </AnimatePresence>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>
    </section>
  );
}
