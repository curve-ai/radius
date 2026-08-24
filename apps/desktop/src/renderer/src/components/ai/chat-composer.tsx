import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  FileText,
  Folder,
  Hand,
  Paperclip,
  ShieldAlert,
  X,
} from "lucide-react";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
  type ReactNode,
} from "react";

import { attachmentFileKey } from "@renderer/components/ai/attachment-files";
import { ComposerContextMenu } from "@renderer/components/ai/composer-context-menu";
import {
  ActionToolPanelButton,
  ActionToolPanelGroup,
  ActionToolPanelGroupLabel,
  ActionToolPanelItemContent,
  ActionToolPanelItemIcon,
  ActionToolPanelItemLabel,
} from "@renderer/components/ui/action-tool-panel";
import { Button } from "@renderer/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";

const MAX_TEXTAREA_HEIGHT_PX = 160;

export type ChatAccessMode = "ask" | "full";

export type ConnectedAgent = {
  id: string;
  label: string;
  detail?: string;
};

export type ChatSubmission = {
  attachments: readonly File[];
  prompt: string;
};

export type ChatComposerProps = {
  acceptedFileTypes?: string;
  accessMode?: ChatAccessMode;
  attachments?: readonly File[];
  autoFocus?: boolean;
  className?: string;
  connectedAgents?: readonly ConnectedAgent[];
  defaultAccessMode?: ChatAccessMode;
  defaultSelectedAgentId?: string;
  defaultValue?: string;
  disabled?: boolean;
  onAccessModeChange?: (mode: ChatAccessMode) => void;
  onAddAttachments?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onSelectedAgentChange?: (agentId: string) => void;
  onSubmit?: (submission: ChatSubmission) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  selectedAgentId?: string;
  value?: string;
  workspaceLabel: string;
  workspaceMenu?: ReactNode;
};

const ACCESS_OPTIONS: readonly {
  description: string;
  icon: typeof Hand;
  label: string;
  mode: ChatAccessMode;
}[] = [
  {
    mode: "ask",
    label: "Ask for approval",
    description: "Ask before editing files or using the internet",
    icon: Hand,
  },
  {
    mode: "full",
    label: "Full access",
    description: "Allow access to the internet and files on this computer",
    icon: ShieldAlert,
  },
];

function AttachmentPreview({
  file,
  onRemove,
}: {
  file: File;
  onRemove?: () => void;
}): ReactNode {
  const [previewFailed, setPreviewFailed] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!file.type.startsWith("image/")) return;

    const objectUrl = URL.createObjectURL(file);
    const frame = requestAnimationFrame(() => setPreviewUrl(objectUrl));
    return () => {
      cancelAnimationFrame(frame);
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  return (
    <div
      className="group/attachment relative size-20 overflow-hidden rounded-[0.875rem] border border-border bg-muted"
      title={file.name}
    >
      {previewUrl && !previewFailed ? (
        <img
          src={previewUrl}
          alt={file.name}
          draggable={false}
          className="size-full object-cover"
          onError={() => setPreviewFailed(true)}
        />
      ) : (
        <div className="flex size-full flex-col items-center justify-center gap-1.5 px-2 text-center text-muted-foreground">
          <FileText className="size-5" aria-hidden />
          <span className="w-full truncate text-[0.6875rem] leading-4">
            {file.name}
          </span>
        </div>
      )}
      {onRemove ? (
        <Button
          type="button"
          size="icon"
          aria-label={`Remove ${file.name}`}
          title={`Remove ${file.name}`}
          className="absolute right-1 top-1 size-6 bg-foreground text-background shadow-sm hover:bg-foreground/90"
          onClick={onRemove}
        >
          <X className="size-3.5" aria-hidden />
        </Button>
      ) : null}
    </div>
  );
}

export function ChatComposer({
  acceptedFileTypes,
  accessMode,
  attachments = [],
  autoFocus = false,
  className,
  connectedAgents = [],
  defaultAccessMode = "full",
  defaultSelectedAgentId,
  defaultValue = "",
  disabled = false,
  onAccessModeChange,
  onAddAttachments,
  onRemoveAttachment,
  onSelectedAgentChange,
  onSubmit,
  onValueChange,
  placeholder = "Do anything",
  selectedAgentId,
  value,
  workspaceLabel,
  workspaceMenu,
}: ChatComposerProps): ReactNode {
  const promptId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [accessPopoverOpen, setAccessPopoverOpen] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [uncontrolledAccessMode, setUncontrolledAccessMode] =
    useState<ChatAccessMode>(defaultAccessMode);
  const [uncontrolledAgentId, setUncontrolledAgentId] = useState<string | null>(
    defaultSelectedAgentId ?? connectedAgents[0]?.id ?? null,
  );
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const prompt = value ?? uncontrolledValue;
  const selectedAccessMode = accessMode ?? uncontrolledAccessMode;
  const resolvedAgentId = selectedAgentId ?? uncontrolledAgentId;
  const selectedAgent =
    connectedAgents.find((agent) => agent.id === resolvedAgentId) ??
    connectedAgents[0] ??
    null;
  const hasSubmission = prompt.trim().length > 0 || attachments.length > 0;
  const canSubmit = hasSubmission && Boolean(onSubmit) && !disabled;
  const selectedAccess =
    ACCESS_OPTIONS.find((option) => option.mode === selectedAccessMode) ??
    ACCESS_OPTIONS[1];
  const SelectedAccessIcon = selectedAccess.icon;

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) return;

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, MAX_TEXTAREA_HEIGHT_PX)}px`;
  }, [prompt]);

  const updatePrompt = (nextValue: string): void => {
    if (value === undefined) setUncontrolledValue(nextValue);
    onValueChange?.(nextValue);
  };

  const selectAccessMode = (nextMode: ChatAccessMode): void => {
    if (accessMode === undefined) setUncontrolledAccessMode(nextMode);
    onAccessModeChange?.(nextMode);
    setAccessPopoverOpen(false);
  };

  const selectAgent = (agentId: string): void => {
    if (selectedAgentId === undefined) setUncontrolledAgentId(agentId);
    onSelectedAgentChange?.(agentId);
    setAgentPopoverOpen(false);
  };

  const submitPrompt = (): void => {
    if (!canSubmit || !onSubmit) return;

    onSubmit({ prompt: prompt.trim(), attachments });
    if (value === undefined) setUncontrolledValue("");
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    submitPrompt();
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (
      event.key !== "Enter" ||
      event.shiftKey ||
      event.nativeEvent.isComposing
    ) {
      return;
    }
    if (!canSubmit) return;

    event.preventDefault();
    submitPrompt();
  };

  return (
    <div className={cn("w-full", className)}>
      {workspaceMenu ? (
        <ComposerContextMenu
          trigger={
            <button
              type="button"
              aria-label="Choose project"
              title="Choose project"
              className="mx-4 flex h-10 w-[calc(100%-2rem)] items-center gap-2.5 rounded-t-[0.875rem] bg-muted px-4 text-left text-foreground outline-none transition-colors hover:bg-card-02 focus-visible:ring-1 focus-visible:ring-ring data-[state=open]:bg-card-02"
            >
              <Folder className="size-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate text-sm leading-5">
                {workspaceLabel}
              </span>
            </button>
          }
        >
          {workspaceMenu}
        </ComposerContextMenu>
      ) : (
        <div className="mx-4 flex h-10 items-center gap-2.5 rounded-t-[0.875rem] bg-muted px-4 text-foreground">
          <Folder className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate text-sm leading-5">
            {workspaceLabel}
          </span>
        </div>
      )}

      <form
        className="relative -mt-1 flex min-h-[6.5rem] flex-col rounded-[1.25rem] border border-border bg-background shadow-lg transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-xl"
        onSubmit={handleSubmit}
      >
        {attachments.length > 0 ? (
          <div
            className="flex flex-wrap gap-2 px-4 pt-4"
            aria-label="Attached files"
          >
            {attachments.map((file, index) => (
              <AttachmentPreview
                key={attachmentFileKey(file)}
                file={file}
                onRemove={
                  onRemoveAttachment
                    ? () => onRemoveAttachment(index)
                    : undefined
                }
              />
            ))}
          </div>
        ) : null}

        <label htmlFor={promptId} className="sr-only">
          Message Radius
        </label>
        <textarea
          ref={textareaRef}
          id={promptId}
          rows={1}
          autoFocus={autoFocus}
          value={prompt}
          disabled={disabled}
          placeholder={placeholder}
          className="min-h-14 w-full resize-none overflow-y-auto bg-transparent px-4 pb-2 pt-3.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed"
          onChange={(event) => updatePrompt(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="mt-auto flex h-12 shrink-0 items-center gap-1 px-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={acceptedFileTypes}
            tabIndex={-1}
            className="sr-only"
            onChange={(event) => {
              const files = Array.from(event.target.files ?? []);
              if (files.length > 0) onAddAttachments?.(files);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="Attach files"
            title="Attach files"
            disabled={disabled || !onAddAttachments}
            className="size-8 shrink-0"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-4" aria-hidden />
          </Button>

          <Popover open={accessPopoverOpen} onOpenChange={setAccessPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label="Change access level"
                disabled={disabled}
                className="h-8 px-2.5 text-xs text-negative data-[state=open]:bg-negative/8 hover:bg-negative/8 hover:text-negative"
              >
                <SelectedAccessIcon className="size-4" aria-hidden />
                {selectedAccess.label}
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="w-[32rem] max-w-[calc(100vw-1.5rem)] rounded-[1rem] p-2"
            >
              <ActionToolPanelGroupLabel className="px-2 pb-2 pt-1 text-xs">
                How should Radius actions be approved?
              </ActionToolPanelGroupLabel>
              <ActionToolPanelGroup className="space-y-1 p-0">
                {ACCESS_OPTIONS.map((option) => {
                  const selected = option.mode === selectedAccessMode;
                  const OptionIcon = option.icon;
                  return (
                    <ActionToolPanelButton
                      key={option.mode}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "items-start gap-3 rounded-md px-2 py-2.5",
                        option.mode === "full" && "text-negative",
                      )}
                      onClick={() => selectAccessMode(option.mode)}
                    >
                      <ActionToolPanelItemIcon className="mt-0.5 text-inherit">
                        <OptionIcon aria-hidden />
                      </ActionToolPanelItemIcon>
                      <ActionToolPanelItemContent>
                        <ActionToolPanelItemLabel
                          className={cn(
                            "leading-5",
                            option.mode === "full" && "text-negative",
                          )}
                        >
                          {option.label}
                        </ActionToolPanelItemLabel>
                        <span
                          className={cn(
                            "mt-0.5 block text-xs leading-4 text-muted-foreground",
                            option.mode === "full" && "text-negative/80",
                          )}
                        >
                          {option.description}
                        </span>
                      </ActionToolPanelItemContent>
                      {selected ? (
                        <Check className="mt-0.5 size-4 shrink-0" aria-hidden />
                      ) : null}
                    </ActionToolPanelButton>
                  );
                })}
              </ActionToolPanelGroup>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex min-w-0 items-center gap-1">
            <Popover open={agentPopoverOpen} onOpenChange={setAgentPopoverOpen}>
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label="Select agent"
                  disabled={disabled}
                  className="hidden h-8 min-w-0 gap-1 px-2 text-xs text-muted-foreground sm:inline-flex"
                >
                  {selectedAgent ? (
                    <>
                      <span className="truncate text-foreground">
                        {selectedAgent.label}
                      </span>
                      {selectedAgent.detail ? (
                        <span>{selectedAgent.detail}</span>
                      ) : null}
                    </>
                  ) : (
                    <span>Select agent</span>
                  )}
                  <ChevronDown className="ml-0.5 size-3.5" aria-hidden />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                side="top"
                align="end"
                sideOffset={8}
                collisionPadding={12}
                className="w-64 rounded-[1rem] p-2"
              >
                <ActionToolPanelGroupLabel className="px-2 pb-2 pt-1 text-xs">
                  Connected agents
                </ActionToolPanelGroupLabel>
                {connectedAgents.length > 0 ? (
                  <ActionToolPanelGroup className="space-y-1 p-0">
                    {connectedAgents.map((agent) => {
                      const selected = agent.id === selectedAgent?.id;
                      return (
                        <ActionToolPanelButton
                          key={agent.id}
                          type="button"
                          aria-pressed={selected}
                          className="gap-3 rounded-md px-2 py-2"
                          onClick={() => selectAgent(agent.id)}
                        >
                          <ActionToolPanelItemIcon className="text-muted-foreground">
                            <Bot aria-hidden />
                          </ActionToolPanelItemIcon>
                          <ActionToolPanelItemContent>
                            <ActionToolPanelItemLabel className="truncate leading-5">
                              {agent.label}
                            </ActionToolPanelItemLabel>
                            {agent.detail ? (
                              <span className="block truncate text-xs leading-4 text-muted-foreground">
                                {agent.detail}
                              </span>
                            ) : null}
                          </ActionToolPanelItemContent>
                          {selected ? (
                            <Check
                              className="size-4 shrink-0 text-muted-foreground"
                              aria-hidden
                            />
                          ) : null}
                        </ActionToolPanelButton>
                      );
                    })}
                  </ActionToolPanelGroup>
                ) : (
                  <p className="px-2 py-3 text-sm text-muted-foreground">
                    No connected agents
                  </p>
                )}
              </PopoverContent>
            </Popover>

            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              title={
                canSubmit ? "Send message" : "Sending is not available yet"
              }
              disabled={!canSubmit}
              className="size-8 shrink-0 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
            >
              <ArrowUp className="size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
