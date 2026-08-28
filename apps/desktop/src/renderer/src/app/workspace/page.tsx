import {
  Bot,
  Boxes,
  CircleAlert,
  Clock3,
  FolderOpen,
  LayoutDashboard,
  MessageSquareText,
  Paperclip,
  RefreshCw,
} from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { appendAttachmentFiles } from "@renderer/components/ai/attachment-files";
import {
  ChatComposer,
  type ChatAccessMode,
} from "@renderer/components/ai/chat-composer";
import { SessionThread } from "@renderer/components/ai/session-thread";
import { PlanProgress } from "@renderer/components/ai/plan-progress";
import { buildSessionPlanPresentation } from "@renderer/components/ai/session-transcript";
import { ProjectComposerMenu } from "@renderer/components/shell/project-composer-menu";
import {
  useProjects,
  type ActiveProjectSession,
} from "@renderer/components/shell/project-context-value";
import type { WorkspaceView } from "@renderer/components/shell/types";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";
import { InlineFeedbackTransition } from "@renderer/components/ui/inline-feedback-transition";
import {
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { cloudPageUrl } from "@renderer/lib/cloud-links";
import type {
  DesktopAgentSummary,
  SessionTranscriptEvent,
} from "../../../../radius-api";
import { ConnectorsPage } from "./connectors-page";
import { AgentsPage } from "./agents-page";

type ContentView = Exclude<WorkspaceView, "settings">;
type EmptyStateView = Exclude<ContentView, "workspace" | "connectors">;

const CLOUD_PERMISSIONS_URL = cloudPageUrl("/permissions");
const WORKSPACE_FEEDBACK_EASE = [0.23, 1, 0.32, 1] as const;

const viewContent: Record<
  EmptyStateView,
  { title: string; description: string; icon: typeof LayoutDashboard }
> = {
  scheduled: {
    title: "No scheduled tasks yet",
    description:
      "Create recurring local work and review each run from this computer.",
    icon: Clock3,
  },
  agents: {
    title: "No agents available",
    description: "This Radius distribution has no bundled or assigned agents.",
    icon: Bot,
  },
  projects: {
    title: "No projects yet",
    description:
      "Projects will keep local workspaces, sessions, and artifacts together.",
    icon: FolderOpen,
  },
  artifacts: {
    title: "No artifacts yet",
    description:
      "Files and outputs created by agents will appear here with provenance.",
    icon: Boxes,
  },
  activity: {
    title: "No recent activity",
    description:
      "Tool calls, approvals, errors, and session events will appear here.",
    icon: LayoutDashboard,
  },
};

function dataTransferContainsFiles(dataTransfer: DataTransfer): boolean {
  return Array.from(dataTransfer.types).includes("Files");
}

let cachedDesktopAgents: DesktopAgentSummary[] = [];

function useDesktopAgents(): {
  agents: DesktopAgentSummary[];
  error: string | null;
  models: DesktopAgentSummary["models"];
  selectedAgentId: string | null;
  selectedModelId: string | null;
  selectedThinkingEffortId: string | null;
  setSelectedAgentId(agentId: string): void;
  setSelectedModelId(modelId: string): void;
  setSelectedThinkingEffortId(thinkingEffortId: string): void;
} {
  const [agents, setAgents] =
    useState<DesktopAgentSummary[]>(cachedDesktopAgents);
  const [error, setError] = useState<string | null>(null);
  const [selectedAgentId, setSelectedAgentIdState] = useState<string | null>(
    cachedDesktopAgents[0]?.id ?? null,
  );
  const [selectedModelId, setSelectedModelIdState] = useState<string | null>(
    cachedDesktopAgents[0]?.defaultModelId ??
      cachedDesktopAgents[0]?.models[0]?.id ??
      null,
  );
  const [selectedThinkingEffortId, setSelectedThinkingEffortId] = useState<
    string | null
  >(
    cachedDesktopAgents[0]?.models.find(
      (model) =>
        model.id ===
        (cachedDesktopAgents[0]?.defaultModelId ??
          cachedDesktopAgents[0]?.models[0]?.id),
    )?.defaultThinkingEffortId ?? null,
  );

  const selectModelForAgent = (
    agent: DesktopAgentSummary | null,
    modelId: string | null,
  ): void => {
    const model = agent?.models.find((candidate) => candidate.id === modelId);
    setSelectedModelIdState(model?.id ?? null);
    setSelectedThinkingEffortId(
      model?.defaultThinkingEffortId ?? model?.thinkingEfforts?.[0]?.id ?? null,
    );
  };

  useEffect(() => {
    let disposed = false;
    void window.radius
      .listAgents()
      .then((nextAgents) => {
        if (disposed) return;
        const usableAgents = nextAgents.filter(
          (agent) =>
            agent.authentication.state === "connected" ||
            agent.authentication.state === "not_required",
        );
        cachedDesktopAgents = usableAgents;
        setAgents(usableAgents);
        const agent = usableAgents[0] ?? null;
        setSelectedAgentIdState(agent?.id ?? null);
        selectModelForAgent(
          agent,
          agent?.defaultModelId ?? agent?.models[0]?.id ?? null,
        );
        setError(null);
      })
      .catch((cause) => {
        if (disposed) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "Local agents could not be loaded",
        );
      });
    return () => {
      disposed = true;
    };
  }, []);

  const selectedAgent =
    agents.find((agent) => agent.id === selectedAgentId) ?? null;
  const setSelectedAgentId = (agentId: string): void => {
    const agent = agents.find((candidate) => candidate.id === agentId);
    setSelectedAgentIdState(agentId);
    selectModelForAgent(
      agent ?? null,
      agent?.defaultModelId ?? agent?.models[0]?.id ?? null,
    );
  };
  const setSelectedModelId = (modelId: string): void => {
    selectModelForAgent(selectedAgent, modelId);
  };

  return {
    agents,
    error,
    models: selectedAgent?.models ?? [],
    selectedAgentId,
    selectedModelId,
    selectedThinkingEffortId,
    setSelectedAgentId,
    setSelectedModelId,
    setSelectedThinkingEffortId,
  };
}

function NewChatPage(): ReactNode {
  const dragDepthRef = useRef(0);
  const reduceMotion = useReducedMotion();
  const [attachments, setAttachments] = useState<File[]>([]);
  const [accessMode, setAccessMode] = useState<ChatAccessMode>("full");
  const [fileDragActive, setFileDragActive] = useState(false);
  const [prompt, setPrompt] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    agents,
    error: agentsError,
    models,
    selectedAgentId,
    selectedModelId,
    selectedThinkingEffortId,
    setSelectedAgentId,
    setSelectedModelId,
    setSelectedThinkingEffortId,
  } = useDesktopAgents();
  const { activateSession, activeProject } = useProjects();

  const addAttachments = (files: readonly File[]): void => {
    if (files.length === 0) return;

    setAttachments((current) => appendAttachmentFiles(current, files));
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setFileDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
  };

  const handleDragLeave = (event: ReactDragEvent<HTMLElement>): void => {
    if (dragDepthRef.current === 0) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setFileDragActive(false);
  };

  const handleDrop = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setFileDragActive(false);
    addAttachments(Array.from(event.dataTransfer.files));
  };

  const handleSubmit = async (submittedPrompt: string): Promise<void> => {
    if (!selectedAgentId || submitting) return;
    if (attachments.length > 0) {
      setSubmitError(
        "File attachments are not available in the local agent preview yet.",
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await window.radius.startAgentPrompt({
        accessMode,
        agentId: selectedAgentId,
        modelId: selectedModelId,
        prompt: submittedPrompt,
        projectId: activeProject?.id ?? null,
        thinkingEffortId: selectedThinkingEffortId,
      });
      setPrompt("");
      setAttachments([]);
      await activateSession(result.sessionId);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : "The local agent could not be started",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-labelledby="new-chat-heading"
      className="relative h-full min-h-0"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      <AnimatePresence initial={false}>
        {fileDragActive ? (
          <motion.div
            key="file-drop-overlay"
            role="status"
            initial={{
              opacity: 0,
              transform: reduceMotion === true ? "scale(1)" : "scale(0.99)",
            }}
            animate={{ opacity: 1, transform: "scale(1)" }}
            exit={{
              opacity: 0,
              transform: reduceMotion === true ? "scale(1)" : "scale(0.99)",
              transition: {
                duration: 0.1,
                ease: WORKSPACE_FEEDBACK_EASE,
              },
            }}
            transition={{
              duration: reduceMotion === true ? 0.1 : 0.125,
              ease: WORKSPACE_FEEDBACK_EASE,
            }}
            className="pointer-events-none absolute inset-4 z-50 flex items-center justify-center rounded-[1.25rem] border-2 border-dashed border-brand/40 bg-background/95 text-foreground shadow-sm"
          >
            <div className="flex items-center gap-2 text-sm">
              <Paperclip className="size-4 text-muted-foreground" aria-hidden />
              Drop files to attach
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
      <div className="mx-auto flex h-full w-full max-w-page flex-col px-4 pb-3 sm:px-6">
        <div className="flex min-h-0 flex-1 items-center justify-center pb-8">
          <h1
            id="new-chat-heading"
            className="mx-auto w-full max-w-reader -translate-y-3 text-center type-md text-foreground sm:type-lg"
          >
            What would you like to work on?
          </h1>
        </div>

        <div className="mx-auto w-full max-w-reader shrink-0">
          <ChatComposer
            accessLearnMoreHref={CLOUD_PERMISSIONS_URL}
            accessMode={accessMode}
            autoFocus
            attachments={attachments}
            connectedAgents={agents}
            connectedModels={models}
            disabled={submitting}
            selectedAgentId={selectedAgentId ?? undefined}
            selectedModelId={selectedModelId ?? undefined}
            selectedThinkingEffortId={selectedThinkingEffortId ?? undefined}
            value={prompt}
            workspaceLabel={activeProject?.name ?? "Select a project"}
            workspaceMenu={<ProjectComposerMenu />}
            onAccessModeChange={setAccessMode}
            onAddAttachments={addAttachments}
            onRemoveAttachment={(index) =>
              setAttachments((current) =>
                current.filter((_, currentIndex) => currentIndex !== index),
              )
            }
            onSelectedAgentChange={setSelectedAgentId}
            onSelectedModelChange={setSelectedModelId}
            onSelectedThinkingEffortChange={setSelectedThinkingEffortId}
            onSubmit={
              selectedAgentId
                ? ({ prompt: submittedPrompt }) =>
                    void handleSubmit(submittedPrompt)
                : undefined
            }
            onValueChange={setPrompt}
          />
          <InlineFeedbackTransition>
            {submitError || agentsError ? (
              <p role="alert" className="mt-2 px-4 text-xs text-negative">
                {submitError ?? agentsError}
              </p>
            ) : null}
          </InlineFeedbackTransition>
        </div>
      </div>
    </section>
  );
}

function SessionPage({
  activeSession,
}: {
  activeSession: ActiveProjectSession;
}): ReactNode {
  const [attachments, setAttachments] = useState<File[]>([]);
  const [accessMode, setAccessMode] = useState<ChatAccessMode>("full");
  const [events, setEvents] = useState<SessionTranscriptEvent[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [prompt, setPrompt] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const {
    agents,
    error: agentsError,
    models,
    selectedAgentId,
    selectedModelId,
    selectedThinkingEffortId,
    setSelectedAgentId,
    setSelectedModelId,
    setSelectedThinkingEffortId,
  } = useDesktopAgents();
  const { project, session } = activeSession;
  const planPresentation = useMemo(
    () => buildSessionPlanPresentation(events),
    [events],
  );
  const activePlan = planPresentation.activePlan;

  useEffect(() => {
    let disposed = false;

    const load = async (initial: boolean): Promise<void> => {
      if (initial) setLoading(true);
      try {
        const nextEvents = await window.radius.listSessionTranscript(
          session.id,
        );
        if (disposed) return;
        setEvents(nextEvents);
        setError(null);
      } catch (cause) {
        if (disposed) return;
        setError(
          cause instanceof Error
            ? cause.message
            : "The session transcript could not be loaded",
        );
      } finally {
        if (initial && !disposed) setLoading(false);
      }
    };

    void load(true);
    const timer =
      session.status === "active"
        ? window.setInterval(() => void load(false), 1_500)
        : null;

    return () => {
      disposed = true;
      if (timer !== null) window.clearInterval(timer);
    };
  }, [refreshKey, session.id, session.status]);

  const addAttachments = (files: readonly File[]): void => {
    if (files.length === 0) return;
    setAttachments((current) => appendAttachmentFiles(current, files));
  };

  const handleSubmit = async (submittedPrompt: string): Promise<void> => {
    if (!selectedAgentId || submitting) return;
    if (attachments.length > 0) {
      setSubmitError(
        "File attachments are not available in the local agent preview yet.",
      );
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    try {
      await window.radius.startAgentPrompt({
        accessMode,
        agentId: selectedAgentId,
        modelId: selectedModelId,
        prompt: submittedPrompt,
        projectId: project?.id ?? null,
        sessionId: session.id,
        thinkingEffortId: selectedThinkingEffortId,
      });
      setPrompt("");
      setAttachments([]);
      setRefreshKey((current) => current + 1);
    } catch (cause) {
      setSubmitError(
        cause instanceof Error
          ? cause.message
          : "The local agent could not be started",
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <section
      aria-label={session.title}
      className="flex h-full min-h-0 flex-col"
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex w-full max-w-reader flex-col px-4 py-8 sm:px-6 sm:py-10">
          {loading ? (
            <div aria-label="Loading session" className="flex flex-col gap-7">
              <div className="flex justify-end">
                <Skeleton className="h-16 w-[72%] rounded-md" />
              </div>
              <div className="space-y-2">
                <Skeleton className="h-4 w-28" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-[84%]" />
              </div>
            </div>
          ) : error && events.length === 0 ? (
            <div
              role="alert"
              className="flex min-h-72 flex-col items-center justify-center text-center"
            >
              <CircleAlert className="mb-3 size-5 text-negative" aria-hidden />
              <p className="type-base text-foreground">
                This session could not be opened
              </p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                {error}
              </p>
              <button
                type="button"
                onClick={() => setRefreshKey((current) => current + 1)}
                className="mt-4 flex h-8 items-center gap-2 rounded-full border border-border px-3 text-xs font-medium text-foreground transition-[background-color,transform] duration-150 hover:bg-accent active:scale-[0.98]"
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Try again
              </button>
            </div>
          ) : events.length === 0 ? (
            <div className="flex min-h-72 flex-col items-center justify-center text-center">
              <MessageSquareText
                className="mb-3 size-5 text-muted-foreground"
                aria-hidden
              />
              <p className="type-base text-foreground">No messages yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                This session is ready when an agent runtime appends its first
                message.
              </p>
            </div>
          ) : (
            <SessionThread
              events={events}
              planPresentation={planPresentation}
            />
          )}

          <InlineFeedbackTransition>
            {error && events.length > 0 ? (
              <div
                role="status"
                className="mt-6 flex items-center gap-2 rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground"
              >
                <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                New session activity could not be loaded. Radius will keep the
                transcript already on screen.
              </div>
            ) : null}
          </InlineFeedbackTransition>
        </div>
      </div>

      <div className="shrink-0 bg-background px-4 pb-3 pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-reader">
          {activePlan ? (
            <div className="mb-2 flex justify-center">
              <PlanProgress plan={activePlan} />
            </div>
          ) : null}
          <ChatComposer
            accessLearnMoreHref={CLOUD_PERMISSIONS_URL}
            accessMode={accessMode}
            attachments={attachments}
            connectedAgents={agents}
            connectedModels={models}
            disabled={submitting}
            selectedAgentId={selectedAgentId ?? undefined}
            selectedModelId={selectedModelId ?? undefined}
            selectedThinkingEffortId={selectedThinkingEffortId ?? undefined}
            value={prompt}
            workspaceLabel={project?.name}
            onAccessModeChange={setAccessMode}
            onAddAttachments={addAttachments}
            onRemoveAttachment={(index) =>
              setAttachments((current) =>
                current.filter((_, currentIndex) => currentIndex !== index),
              )
            }
            onSelectedAgentChange={setSelectedAgentId}
            onSelectedModelChange={setSelectedModelId}
            onSelectedThinkingEffortChange={setSelectedThinkingEffortId}
            onSubmit={
              selectedAgentId
                ? ({ prompt: submittedPrompt }) =>
                    void handleSubmit(submittedPrompt)
                : undefined
            }
            onValueChange={setPrompt}
          />
          <InlineFeedbackTransition>
            {submitError || agentsError ? (
              <p role="alert" className="mt-2 px-4 text-xs text-negative">
                {submitError ?? agentsError}
              </p>
            ) : null}
          </InlineFeedbackTransition>
        </div>
      </div>
    </section>
  );
}

export function WorkspacePage({ view }: { view: ContentView }): ReactNode {
  const { activeSession } = useProjects();

  if (view === "workspace") {
    return activeSession ? (
      <SessionPage activeSession={activeSession} />
    ) : (
      <NewChatPage />
    );
  }

  if (view === "connectors") return <ConnectorsPage />;
  if (view === "agents") return <AgentsPage />;

  const content = viewContent[view];
  const ViewIcon = content.icon;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-12 pt-10 sm:px-6 sm:pb-16 sm:pt-12">
      <Card className="overflow-hidden rounded-sm bg-transparent shadow-none">
        <CardHeader>
          <div className="mb-2 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <ViewIcon aria-hidden />
          </div>
          <CardTitle>{content.title}</CardTitle>
          <CardDescription>{content.description}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  );
}
