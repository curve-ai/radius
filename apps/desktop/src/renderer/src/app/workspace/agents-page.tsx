import {
  Bot,
  CircleAlert,
  CircleCheck,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
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

const AGENT_AUTH_STATE_EASE = [0.23, 1, 0.32, 1] as const;

function safeAgentError(cause: unknown): string {
  if (!(cause instanceof Error)) return "Agent sign-in could not be completed";
  if (cause.message.includes("FX_LOGIN_TIMEOUT")) {
    return "Codex sign-in timed out. Try connecting again.";
  }
  if (cause.message.includes("FX_BINARY_NOT_INSTALLED")) {
    return "The fx runtime is not installed in this Radius build.";
  }
  return "Agent sign-in could not be completed.";
}

function authenticationLabel(agent: DesktopAgentSummary): string {
  switch (agent.authentication.state) {
    case "connected":
      return agent.models.length > 0
        ? `${agent.authentication.detail}. ${agent.models.length} models available.`
        : agent.authentication.detail;
    case "expired":
      return "Codex authentication expired. Sign in again to continue.";
    case "error":
      return "Codex authentication needs attention.";
    case "not_required":
      return "Ready on this Mac.";
    case "needs_authentication":
      return "Sign in to a Codex subscription to use fx on this Mac.";
  }
}

export function AgentsPage(): ReactNode {
  const reduceMotion = useReducedMotion();
  const [agents, setAgents] = useState<DesktopAgentSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingAgentId, setPendingAgentId] = useState<string | null>(null);
  const enterTransform =
    reduceMotion === true ? "translateY(0px)" : "translateY(2px)";
  const exitTransform =
    reduceMotion === true ? "translateY(0px)" : "translateY(-2px)";

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    try {
      setAgents(await window.radius.listAgents());
      setError(null);
    } catch (cause) {
      setError(safeAgentError(cause));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => void load());
    return () => window.cancelAnimationFrame(frame);
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
      setError(safeAgentError(cause));
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
      setError(safeAgentError(cause));
    } finally {
      setPendingAgentId(null);
    }
  };

  return (
    <section className="mx-auto w-full max-w-6xl px-5 pb-20 pt-10 sm:px-8 sm:pt-12">
      <div className="flex items-start justify-between gap-6">
        <div className="min-w-0">
          <h2 className="type-md-lg text-foreground">Agents</h2>
          <p className="mt-2 max-w-2xl text-base text-muted-foreground">
            Agents delivered to this Radius installation appear here. Sign in
            only when an agent requires an account on this Mac.
          </p>
        </div>
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

      <section className="mt-9" aria-labelledby="installed-agents-heading">
        <h3
          id="installed-agents-heading"
          className="type-md-sm text-foreground"
        >
          Installed
        </h3>
        <div className="mt-3 border-t border-border">
          {loading && agents.length === 0 ? (
            <div className="flex min-h-20 items-center gap-3 border-b border-border py-3">
              <Skeleton className="size-10 shrink-0 rounded-md" />
              <div className="min-w-0 flex-1 space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-3 w-64 max-w-full" />
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
              const StatusIcon = connected ? CircleCheck : ShieldCheck;
              const authenticationStateKey = `${agent.authentication.state}:${pending ? "pending" : "settled"}`;
              return (
                <div
                  key={agent.id}
                  className="flex min-h-20 items-center gap-3 border-b border-border py-3"
                >
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                    <Bot className="size-5" aria-hidden />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="truncate text-sm font-medium text-foreground">
                        {agent.label}
                      </p>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {agent.detail}
                      </span>
                    </div>
                    <div className="relative mt-1 min-h-5">
                      <AnimatePresence initial={false} mode="popLayout">
                        <motion.p
                          key={`status:${authenticationStateKey}`}
                          initial={{ opacity: 0, transform: enterTransform }}
                          animate={{
                            opacity: 1,
                            transform: "translateY(0px)",
                          }}
                          exit={{
                            opacity: 0,
                            transform: exitTransform,
                            transition: {
                              duration: 0.1,
                              ease: AGENT_AUTH_STATE_EASE,
                            },
                          }}
                          transition={{
                            duration: reduceMotion === true ? 0.1 : 0.16,
                            ease: AGENT_AUTH_STATE_EASE,
                          }}
                          className="flex items-center gap-1.5 text-sm text-muted-foreground"
                        >
                          <StatusIcon
                            className="size-3.5 shrink-0"
                            aria-hidden
                          />
                          <span>{authenticationLabel(agent)}</span>
                        </motion.p>
                      </AnimatePresence>
                    </div>
                  </div>
                  <div className="relative flex min-h-8 w-36 shrink-0 justify-end">
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.div
                        key={`action:${authenticationStateKey}`}
                        initial={{ opacity: 0, transform: enterTransform }}
                        animate={{
                          opacity: 1,
                          transform: "translateY(0px)",
                        }}
                        exit={{
                          opacity: 0,
                          transform: exitTransform,
                          transition: {
                            duration: 0.1,
                            ease: AGENT_AUTH_STATE_EASE,
                          },
                        }}
                        transition={{
                          duration: reduceMotion === true ? 0.1 : 0.16,
                          ease: AGENT_AUTH_STATE_EASE,
                        }}
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

      <div className="mt-8 flex items-start gap-3 border-t border-border pt-5 text-sm text-muted-foreground">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" aria-hidden />
        <p className="max-w-2xl">
          Radius encrypts reusable credentials with the operating system. Agent
          runtimes receive a temporary profile only while authenticating or
          working.
        </p>
      </div>
    </section>
  );
}
