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
import { composerAgentTriggerPresentation } from "@renderer/components/ai/composer-agent-trigger";
import { ComposerContextMenu } from "@renderer/components/ai/composer-context-menu";
import { ComposerSelectionPanel } from "@renderer/components/ai/composer-selection-panel";
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
  AnimatePresence,
  motion,
  useReducedMotion,
} from "@renderer/components/ui/motion";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@renderer/components/ui/popover";
import { cn } from "@renderer/lib/utils";

const MAX_TEXTAREA_HEIGHT_PX = 160;
const ATTACHMENT_TRANSITION_EASE = [0.23, 1, 0.32, 1] as const;
const ATTACHMENT_LAYOUT_EASE = [0.77, 0, 0.175, 1] as const;
export type ChatAccessMode = "ask" | "full";

export type ConnectedAgent = {
  id: string;
  label: string;
  detail?: string;
};

export type ConnectedModel = {
  defaultThinkingEffortId?: string | null;
  id: string;
  label: string;
  thinkingEfforts?: readonly ConnectedThinkingEffort[];
};

export type ConnectedThinkingEffort = {
  id: string;
  label: string;
};

export type ChatSubmission = {
  attachments: readonly File[];
  prompt: string;
};

export type ChatComposerProps = {
  acceptedFileTypes?: string;
  accessLearnMoreHref?: string;
  accessMode?: ChatAccessMode;
  agentSetupGuideHref?: string;
  attachments?: readonly File[];
  autoFocus?: boolean;
  className?: string;
  connectedAgents?: readonly ConnectedAgent[];
  connectedModels?: readonly ConnectedModel[];
  defaultAccessMode?: ChatAccessMode;
  defaultSelectedAgentId?: string;
  defaultValue?: string;
  disabled?: boolean;
  onAccessModeChange?: (mode: ChatAccessMode) => void;
  onAddAttachments?: (files: File[]) => void;
  onRemoveAttachment?: (index: number) => void;
  onSelectedAgentChange?: (agentId: string) => void;
  onSelectedModelChange?: (modelId: string) => void;
  onSelectedThinkingEffortChange?: (thinkingEffortId: string) => void;
  onSubmit?: (submission: ChatSubmission) => void;
  onValueChange?: (value: string) => void;
  placeholder?: string;
  selectedAgentId?: string;
  selectedModelId?: string;
  selectedThinkingEffortId?: string;
  value?: string;
  workspaceLabel?: string;
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
  accessLearnMoreHref,
  accessMode,
  agentSetupGuideHref,
  attachments = [],
  autoFocus = false,
  className,
  connectedAgents = [],
  connectedModels = [],
  defaultAccessMode = "full",
  defaultSelectedAgentId,
  defaultValue = "",
  disabled = false,
  onAccessModeChange,
  onAddAttachments,
  onRemoveAttachment,
  onSelectedAgentChange,
  onSelectedModelChange,
  onSelectedThinkingEffortChange,
  onSubmit,
  onValueChange,
  placeholder = "Do anything",
  selectedAgentId,
  selectedModelId,
  selectedThinkingEffortId,
  value,
  workspaceLabel,
  workspaceMenu,
}: ChatComposerProps): ReactNode {
  const reduceMotion = useReducedMotion();
  const promptId = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [accessPopoverOpen, setAccessPopoverOpen] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [openAgentSelectionItemId, setOpenAgentSelectionItemId] = useState<
    string | null
  >(null);
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
  const selectedModel =
    connectedModels.find((model) => model.id === selectedModelId) ??
    connectedModels[0] ??
    null;
  const thinkingEfforts = selectedModel?.thinkingEfforts ?? [];
  const selectedThinkingEffort =
    thinkingEfforts.find((option) => option.id === selectedThinkingEffortId) ??
    thinkingEfforts.find(
      (option) => option.id === selectedModel?.defaultThinkingEffortId,
    ) ??
    thinkingEfforts[0] ??
    null;
  const agentTriggerPresentation = composerAgentTriggerPresentation({
    agentCount: connectedAgents.length,
    agentLabel: selectedAgent?.label ?? null,
    modelLabel: selectedModel?.label ?? null,
    thinkingEffortLabel: selectedThinkingEffort?.label ?? null,
  });
  const hasSubmission = prompt.trim().length > 0 || attachments.length > 0;
  const canSubmit = hasSubmission && Boolean(onSubmit) && !disabled;
  const selectedAccess =
    ACCESS_OPTIONS.find((option) => option.mode === selectedAccessMode) ??
    ACCESS_OPTIONS[1];
  const SelectedAccessIcon = selectedAccess.icon;
  const hasWorkspaceBrow = Boolean(workspaceMenu || workspaceLabel);

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
  };

  const selectModel = (modelId: string): void => {
    onSelectedModelChange?.(modelId);
  };

  const selectThinkingEffort = (thinkingEffortId: string): void => {
    onSelectedThinkingEffortChange?.(thinkingEffortId);
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
      ) : workspaceLabel ? (
        <div className="mx-4 flex h-10 items-center gap-2.5 rounded-t-[0.875rem] bg-muted px-4 text-foreground">
          <Folder className="size-3.5 shrink-0" aria-hidden />
          <span className="min-w-0 truncate text-sm leading-5">
            {workspaceLabel}
          </span>
        </div>
      ) : null}

      <form
        className={cn(
          "relative flex min-h-24 flex-col rounded-[1.25rem] border border-border bg-background shadow-sm transition-[border-color,box-shadow] focus-within:border-foreground/20 focus-within:shadow-md sm:min-h-[6.5rem]",
          hasWorkspaceBrow && "-mt-1",
        )}
        onSubmit={handleSubmit}
      >
        <div
          className={cn(
            "flex flex-wrap gap-2 px-4",
            attachments.length > 0 && "pt-4",
          )}
          aria-label="Attached files"
        >
          <AnimatePresence initial={false} mode="popLayout">
            {attachments.map((file, index) => (
              <motion.div
                key={attachmentFileKey(file)}
                layout={reduceMotion === true ? false : "position"}
                initial={{
                  opacity: 0,
                  transform: reduceMotion === true ? "scale(1)" : "scale(0.96)",
                }}
                animate={{ opacity: 1, transform: "scale(1)" }}
                exit={{
                  opacity: 0,
                  transform: reduceMotion === true ? "scale(1)" : "scale(0.96)",
                  transition: {
                    duration: 0.12,
                    ease: ATTACHMENT_TRANSITION_EASE,
                  },
                }}
                transition={{
                  opacity: {
                    duration: reduceMotion === true ? 0.1 : 0.16,
                    ease: ATTACHMENT_TRANSITION_EASE,
                  },
                  transform: {
                    duration: reduceMotion === true ? 0.1 : 0.16,
                    ease: ATTACHMENT_TRANSITION_EASE,
                  },
                  layout: {
                    duration: 0.18,
                    ease: ATTACHMENT_LAYOUT_EASE,
                  },
                }}
              >
                <AttachmentPreview
                  file={file}
                  onRemove={
                    onRemoveAttachment
                      ? () => onRemoveAttachment(index)
                      : undefined
                  }
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>

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
          className="min-h-12 w-full resize-none overflow-y-auto bg-transparent px-4 pb-2 pt-3.5 text-sm leading-5 text-foreground outline-none placeholder:text-muted-foreground/45 disabled:cursor-not-allowed sm:min-h-14"
          onChange={(event) => updatePrompt(event.target.value)}
          onKeyDown={handleKeyDown}
        />

        <div className="mt-auto flex h-10 shrink-0 items-center gap-1 px-1.5 sm:h-12 sm:px-2">
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
            className="size-7 shrink-0 sm:size-8"
            onClick={() => fileInputRef.current?.click()}
          >
            <Paperclip className="size-3.5 sm:size-4" aria-hidden />
          </Button>

          <Popover open={accessPopoverOpen} onOpenChange={setAccessPopoverOpen}>
            <PopoverTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Access: ${selectedAccess.label}`}
                title={`Access: ${selectedAccess.label}`}
                disabled={disabled}
                className="size-7 shrink-0 p-0 text-negative data-[state=open]:bg-negative/8 hover:bg-negative/8 hover:text-negative sm:h-8 sm:w-auto sm:px-2.5 sm:text-sm sm:font-normal"
              >
                <SelectedAccessIcon
                  className="size-3.5 sm:size-4"
                  aria-hidden
                />
                <span className="hidden sm:inline">{selectedAccess.label}</span>
              </Button>
            </PopoverTrigger>
            <PopoverContent
              side="top"
              align="start"
              sideOffset={8}
              collisionPadding={12}
              className="w-[32rem] max-w-[calc(100vw-1.5rem)] rounded-[1rem]"
            >
              <div className="flex items-center justify-between gap-4 px-3 pb-2 pt-1">
                <ActionToolPanelGroupLabel className="p-0 text-sm">
                  How should Radius actions be approved?
                </ActionToolPanelGroupLabel>
                {accessLearnMoreHref ? (
                  <a
                    href={accessLearnMoreHref}
                    target="_blank"
                    rel="noreferrer"
                    className="shrink-0 rounded-sm text-sm text-muted-foreground underline underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    Learn more
                  </a>
                ) : null}
              </div>
              <ActionToolPanelGroup className="gap-1 p-0 -mx-1">
                {ACCESS_OPTIONS.map((option) => {
                  const selected = option.mode === selectedAccessMode;
                  const OptionIcon = option.icon;
                  return (
                    <ActionToolPanelButton
                      key={option.mode}
                      type="button"
                      aria-pressed={selected}
                      className={cn(
                        "items-center gap-3 rounded-md py-2 px-2",
                        option.mode === "full" && "text-negative",
                      )}
                      onClick={() => selectAccessMode(option.mode)}
                    >
                      <ActionToolPanelItemIcon
                        className={cn(
                          option.mode === "full"
                            ? "text-negative"
                            : "text-foreground",
                        )}
                      >
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
                        <Check
                          className={cn(
                            "size-4 shrink-0",
                            option.mode === "full" && "text-negative",
                          )}
                          aria-hidden
                        />
                      ) : null}
                    </ActionToolPanelButton>
                  );
                })}
              </ActionToolPanelGroup>
            </PopoverContent>
          </Popover>

          <div className="ml-auto flex min-w-0 items-center gap-1">
            <Popover
              open={agentPopoverOpen}
              onOpenChange={(nextOpen) => {
                setAgentPopoverOpen(nextOpen);
                if (!nextOpen) setOpenAgentSelectionItemId(null);
              }}
            >
              <PopoverTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-label={agentTriggerPresentation.accessibleLabel}
                  title={agentTriggerPresentation.accessibleLabel}
                  disabled={disabled}
                  className="group/agent-trigger inline-flex size-7 shrink-0 p-0 text-muted-foreground sm:h-8 sm:w-auto sm:min-w-0 sm:gap-1 sm:px-2 sm:text-sm sm:font-normal"
                >
                  <Bot className="size-3.5 sm:hidden" aria-hidden />
                  <span className="hidden min-w-0 items-center gap-1 sm:flex">
                    {selectedAgent ? (
                      <>
                        {agentTriggerPresentation.showAgentLabel ? (
                          <span className="min-w-0 truncate text-foreground">
                            {selectedAgent.label}
                          </span>
                        ) : null}
                        {agentTriggerPresentation.configurationLabel ? (
                          <span className="min-w-0 truncate text-muted-foreground">
                            {agentTriggerPresentation.configurationLabel}
                          </span>
                        ) : null}
                      </>
                    ) : (
                      <span>Select agent</span>
                    )}
                    <ChevronDown
                      className="ml-0.5 size-3.5 text-muted-foreground"
                      aria-hidden
                    />
                  </span>
                </Button>
              </PopoverTrigger>
              <ComposerSelectionPanel
                openItemId={openAgentSelectionItemId}
                onOpenItemChange={setOpenAgentSelectionItemId}
                onRequestClose={() => {
                  setOpenAgentSelectionItemId(null);
                  setAgentPopoverOpen(false);
                }}
                items={[
                  {
                    id: "agent",
                    label: "Agent",
                    valueLabel: selectedAgent?.label ?? "No available agents",
                    options: connectedAgents.map((agent) => ({
                      id: agent.id,
                      label: agent.label,
                    })),
                    selectedOptionId: selectedAgent?.id ?? null,
                    onSelect: selectAgent,
                    emptyState: {
                      actionLabel: "Open setup guide",
                      actionHref: agentSetupGuideHref,
                    },
                  },
                  ...(selectedAgent && connectedModels.length > 0
                    ? [
                        {
                          id: "model",
                          label: "Model",
                          valueLabel: selectedModel?.label ?? "Default",
                          options: connectedModels.map((model) => ({
                            id: model.id,
                            label: model.label,
                          })),
                          selectedOptionId: selectedModel?.id ?? null,
                          onSelect: selectModel,
                          emptyState: {
                            actionLabel: "Use agent default",
                          },
                        },
                      ]
                    : []),
                  ...(selectedModel && thinkingEfforts.length > 0
                    ? [
                        {
                          id: "thinking-effort",
                          label: "Thinking effort",
                          valueLabel:
                            selectedThinkingEffort?.label ?? "Default",
                          options: thinkingEfforts.map((option) => ({
                            id: option.id,
                            label: option.label,
                          })),
                          selectedOptionId: selectedThinkingEffort?.id ?? null,
                          onSelect: selectThinkingEffort,
                          emptyState: {
                            actionLabel: "Use model default",
                          },
                        },
                      ]
                    : []),
                ]}
              />
            </Popover>

            <Button
              type="submit"
              size="icon"
              aria-label="Send message"
              title={
                canSubmit ? "Send message" : "Sending is not available yet"
              }
              disabled={!canSubmit}
              className="size-7 shrink-0 disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100 sm:size-8"
            >
              <ArrowUp className="size-3.5 sm:size-4" aria-hidden />
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
