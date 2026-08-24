import {
  Bot,
  Boxes,
  Clock3,
  FolderOpen,
  LayoutDashboard,
  Paperclip,
  Plug,
} from "lucide-react";
import {
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactNode,
} from "react";

import { appendAttachmentFiles } from "@renderer/components/ai/attachment-files";
import { ChatComposer } from "@renderer/components/ai/chat-composer";
import { ProjectComposerMenu } from "@renderer/components/shell/project-composer-menu";
import { useProjects } from "@renderer/components/shell/project-context-value";
import type { WorkspaceView } from "@renderer/components/shell/types";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@renderer/components/ui/card";

type ContentView = Exclude<WorkspaceView, "settings">;
type EmptyStateView = Exclude<ContentView, "workspace">;

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
  plugins: {
    title: "No plugins installed",
    description:
      "Add local capabilities when you are ready to extend what Radius can do.",
    icon: Plug,
  },
  agents: {
    title: "No agents connected",
    description:
      "Connect an agent runtime or package when you are ready to start working locally.",
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

function NewChatPage(): ReactNode {
  const dragDepthRef = useRef(0);
  const [attachments, setAttachments] = useState<File[]>([]);
  const [fileDragActive, setFileDragActive] = useState(false);
  const [prompt, setPrompt] = useState("");
  const { activeProject } = useProjects();
  const attachmentsDisabled = !activeProject?.rootPath;

  const addAttachments = (files: readonly File[]): void => {
    if (attachmentsDisabled || files.length === 0) return;

    setAttachments((current) => appendAttachmentFiles(current, files));
  };

  const handleDragEnter = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    if (attachmentsDisabled) return;
    dragDepthRef.current += 1;
    setFileDragActive(true);
  };

  const handleDragOver = (event: ReactDragEvent<HTMLElement>): void => {
    if (!dataTransferContainsFiles(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = attachmentsDisabled ? "none" : "copy";
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
    if (attachmentsDisabled) return;
    addAttachments(Array.from(event.dataTransfer.files));
  };

  return (
    <section
      aria-labelledby="new-chat-heading"
      className="relative h-full min-h-[36rem]"
      onDragEnter={handleDragEnter}
      onDragLeave={handleDragLeave}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
    >
      {fileDragActive ? (
        <div
          role="status"
          className="pointer-events-none absolute inset-4 z-50 flex items-center justify-center rounded-[1.25rem] border-2 border-dashed border-brand/40 bg-background/95 text-foreground shadow-sm"
        >
          <div className="flex items-center gap-2 text-sm">
            <Paperclip className="size-4 text-muted-foreground" aria-hidden />
            Drop files to attach
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex h-full w-full max-w-page flex-col px-4 pb-3 sm:px-6">
        <div className="flex min-h-0 flex-1 items-center justify-center pb-8">
          <h1
            id="new-chat-heading"
            className="-translate-y-3 type-lg text-foreground"
          >
            What would you like to work on?
          </h1>
        </div>

        <div className="mx-auto w-full max-w-reader shrink-0">
          <ChatComposer
            autoFocus
            disabled={!activeProject?.rootPath}
            attachments={attachments}
            value={prompt}
            workspaceLabel={activeProject?.name ?? "Select a project"}
            workspaceMenu={<ProjectComposerMenu />}
            onAddAttachments={addAttachments}
            onRemoveAttachment={(index) =>
              setAttachments((current) =>
                current.filter((_, currentIndex) => currentIndex !== index),
              )
            }
            onValueChange={setPrompt}
          />
        </div>
      </div>
    </section>
  );
}

export function WorkspacePage({ view }: { view: ContentView }): ReactNode {
  if (view === "workspace") {
    return <NewChatPage />;
  }

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
