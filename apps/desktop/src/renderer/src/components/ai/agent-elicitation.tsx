import { CircleAlert, ExternalLink, ListChecks, RotateCcw } from "lucide-react";
import React, {
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from "react";

void React;

import type {
  AgentElicitationField,
  AgentElicitationResponse,
  AgentElicitationValue,
  PendingAgentElicitation,
} from "../../../../radius-api";
import {
  agentElicitationFieldLabel,
  createAgentElicitationDraft,
  validateAgentElicitationDraft,
  type ElicitationDraftValue,
  type FormElicitation,
} from "@renderer/components/ai/agent-elicitation-form";
import { Alert, AlertDescription } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { Skeleton } from "@renderer/components/ui/skeleton";
import { Switch } from "@renderer/components/ui/switch";

function ElicitationHeader({
  request,
}: {
  request: PendingAgentElicitation;
}): ReactNode {
  return (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
        {request.mode === "url" ? (
          <ExternalLink className="size-4" aria-hidden />
        ) : (
          <ListChecks className="size-4" aria-hidden />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <h3
          id={`elicitation-title-${request.requestId}`}
          className="text-sm font-normal text-foreground"
        >
          {request.mode === "form"
            ? (request.title ?? "Information requested")
            : "Continue in your browser"}
        </h3>
        <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
          {request.message}
        </p>
      </div>
    </div>
  );
}

function fieldInputType(
  format: AgentElicitationField["format"],
): "text" | "email" | "url" | "date" {
  if (format === "email") return "email";
  if (format === "uri") return "url";
  if (format === "date") return "date";
  // Keep ACP date-time values lossless instead of applying the local timezone
  // conversion and formatting semantics of datetime-local inputs.
  return "text";
}

function ElicitationFieldControl({
  field,
  id,
  value,
  error,
  disabled,
  onChange,
}: {
  field: AgentElicitationField;
  id: string;
  value: ElicitationDraftValue;
  error: string | undefined;
  disabled: boolean;
  onChange(value: ElicitationDraftValue): void;
}): ReactNode {
  const descriptionId = field.description ? `${id}-description` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  const describedBy = [descriptionId, errorId].filter(Boolean).join(" ");

  if (field.type === "boolean") {
    const checked = value === true;
    return (
      <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border bg-background px-3 py-2">
        <div className="min-w-0">
          <label htmlFor={id} className="block text-sm text-foreground">
            {agentElicitationFieldLabel(field)}
            {field.required ? <span aria-hidden="true"> *</span> : null}
            {field.required ? (
              <span className="sr-only"> (required)</span>
            ) : null}
          </label>
          {field.description ? (
            <p
              id={descriptionId}
              className="mt-0.5 text-xs leading-4 text-muted-foreground"
            >
              {field.description}
            </p>
          ) : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <span className="text-xs text-muted-foreground">
            {value === null ? "Not set" : checked ? "Yes" : "No"}
          </span>
          <Switch
            id={id}
            checked={checked}
            disabled={disabled}
            aria-describedby={describedBy || undefined}
            onCheckedChange={onChange}
          />
        </div>
      </div>
    );
  }

  if (field.type === "array") {
    const selected = Array.isArray(value) ? value : [];
    return (
      <fieldset
        className="rounded-md border border-border bg-background px-3 py-2.5"
        aria-describedby={describedBy || undefined}
      >
        <legend className="px-1 text-sm text-foreground">
          {agentElicitationFieldLabel(field)}
          {field.required ? <span aria-hidden="true"> *</span> : null}
          {field.required ? <span className="sr-only"> (required)</span> : null}
        </legend>
        {field.description ? (
          <p
            id={descriptionId}
            className="mb-2 text-xs leading-4 text-muted-foreground"
          >
            {field.description}
          </p>
        ) : null}
        <div className="space-y-1.5">
          {field.options?.map((option) => {
            const optionId = `${id}-${option.value}`;
            const checked = selected.includes(option.value);
            return (
              <label
                key={option.value}
                htmlFor={optionId}
                className="flex min-h-8 cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm text-foreground hover:bg-accent"
              >
                <input
                  id={optionId}
                  type="checkbox"
                  checked={checked}
                  disabled={disabled}
                  className="mt-0.5 size-4 rounded border-input accent-[var(--brand)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onChange={() =>
                    onChange(
                      checked
                        ? selected.filter((item) => item !== option.value)
                        : [...selected, option.value],
                    )
                  }
                />
                <span className="min-w-0">
                  <span className="block">{option.title}</span>
                  {option.description ? (
                    <span className="block text-xs leading-4 text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        {error ? (
          <p id={errorId} role="alert" className="mt-2 text-xs text-negative">
            {error}
          </p>
        ) : null}
      </fieldset>
    );
  }

  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-sm text-foreground">
        {agentElicitationFieldLabel(field)}
        {field.required ? <span aria-hidden="true"> *</span> : null}
        {field.required ? <span className="sr-only"> (required)</span> : null}
      </label>
      {field.options ? (
        <select
          id={id}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          required={field.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">
            {field.required ? "Select an option" : "Not set"}
          </option>
          {field.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.title}
            </option>
          ))}
        </select>
      ) : (
        <Input
          id={id}
          type={
            field.type === "number" || field.type === "integer"
              ? "number"
              : fieldInputType(field.format)
          }
          step={field.type === "integer" ? 1 : undefined}
          min={field.minimum ?? undefined}
          max={field.maximum ?? undefined}
          minLength={field.minimumLength ?? undefined}
          maxLength={field.maximumLength ?? undefined}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          required={field.required}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy || undefined}
          className="h-9 text-sm"
          onChange={(event) => onChange(event.target.value)}
        />
      )}
      {field.description ? (
        <p
          id={descriptionId}
          className="text-xs leading-4 text-muted-foreground"
        >
          {field.description}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} role="alert" className="text-xs text-negative">
          {error}
        </p>
      ) : null}
    </div>
  );
}

function FormElicitationCard({
  request,
  onResolve,
}: {
  request: FormElicitation;
  onResolve(response: AgentElicitationResponse): Promise<void>;
}): ReactNode {
  const baseId = useId();
  const reviewHeadingRef = useRef<HTMLHeadingElement>(null);
  const [draft, setDraft] = useState(() =>
    createAgentElicitationDraft(request),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reviewContent, setReviewContent] = useState<Record<
    string,
    AgentElicitationValue
  > | null>(null);
  const [submitting, setSubmitting] = useState<
    AgentElicitationResponse["action"] | null
  >(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (reviewContent) reviewHeadingRef.current?.focus();
  }, [reviewContent]);

  const resolve = async (response: AgentElicitationResponse): Promise<void> => {
    if (submitting) return;
    setSubmitting(response.action);
    setSubmitError(null);
    try {
      await onResolve(response);
    } catch (cause) {
      void cause;
      setSubmitError("Radius could not send this response. Try again.");
      setSubmitting(null);
    }
  };

  const review = (): void => {
    const validation = validateAgentElicitationDraft(request, draft);
    setErrors(validation.errors);
    if (validation.content) {
      setSubmitError(null);
      setReviewContent(validation.content);
    }
  };

  return (
    <section
      aria-labelledby={`elicitation-title-${request.requestId}`}
      className="rounded-xl border border-border bg-card p-3"
    >
      <ElicitationHeader request={request} />
      {request.description ? (
        <p className="mt-2 text-xs leading-5 text-muted-foreground">
          {request.description}
        </p>
      ) : null}

      {reviewContent ? (
        <div className="mt-3">
          <h4
            ref={reviewHeadingRef}
            tabIndex={-1}
            className="text-sm font-normal text-foreground outline-none"
          >
            Review your response
          </h4>
          <dl className="mt-2 space-y-2 rounded-md border border-border bg-background px-3 py-2.5">
            {request.fields
              .filter((field) => reviewContent[field.name] !== undefined)
              .map((field) => {
                const value = reviewContent[field.name]!;
                return (
                  <div
                    key={field.name}
                    className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] gap-3 text-xs leading-5"
                  >
                    <dt className="text-muted-foreground">
                      {agentElicitationFieldLabel(field)}
                    </dt>
                    <dd className="break-words text-foreground">
                      {Array.isArray(value)
                        ? value
                            .map(
                              (item) =>
                                field.options?.find(
                                  (option) => option.value === item,
                                )?.title ?? item,
                            )
                            .join(", ")
                        : typeof value === "boolean"
                          ? value
                            ? "Yes"
                            : "No"
                          : String(value)}
                    </dd>
                  </div>
                );
              })}
          </dl>
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {request.fields.map((field, index) => (
            <ElicitationFieldControl
              key={field.name}
              field={field}
              id={`${baseId}-${index}`}
              value={draft[field.name] ?? ""}
              error={errors[field.name]}
              disabled={submitting !== null}
              onChange={(value) => {
                setDraft((current) => ({ ...current, [field.name]: value }));
                setErrors((current) => {
                  if (!current[field.name]) return current;
                  const next = { ...current };
                  delete next[field.name];
                  return next;
                });
              }}
            />
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        {reviewContent ? (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            disabled={submitting !== null}
            onClick={() => setReviewContent(null)}
          >
            Back
          </Button>
        ) : null}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={submitting !== null}
          onClick={() => void resolve({ action: "cancel" })}
        >
          {submitting === "cancel" ? "Cancelling..." : "Cancel"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting !== null}
          onClick={() => void resolve({ action: "decline" })}
        >
          {submitting === "decline" ? "Declining..." : "Decline"}
        </Button>
        {reviewContent ? (
          <Button
            type="button"
            size="sm"
            disabled={submitting !== null}
            onClick={() =>
              void resolve({ action: "accept", content: reviewContent })
            }
          >
            {submitting === "accept" ? "Sending..." : "Send response"}
          </Button>
        ) : (
          <Button
            type="button"
            size="sm"
            disabled={submitting !== null}
            onClick={review}
          >
            Review
          </Button>
        )}
      </div>
      {submitError ? (
        <p role="alert" className="mt-2 text-xs text-negative">
          {submitError}
        </p>
      ) : null}
    </section>
  );
}

function UrlElicitationCard({
  request,
  onResolve,
}: {
  request: Extract<PendingAgentElicitation, { mode: "url" }>;
  onResolve(response: AgentElicitationResponse): Promise<void>;
}): ReactNode {
  const [submitting, setSubmitting] = useState<
    AgentElicitationResponse["action"] | null
  >(null);
  const [error, setError] = useState<string | null>(null);
  const host = new URL(request.url).host;

  const resolve = async (response: AgentElicitationResponse): Promise<void> => {
    if (submitting) return;
    setSubmitting(response.action);
    setError(null);
    try {
      await onResolve(response);
    } catch (cause) {
      void cause;
      setError("Radius could not send this response. Try again.");
      setSubmitting(null);
    }
  };

  const openAndContinue = (): void => {
    window.open(request.url, "_blank", "noopener,noreferrer");
    void resolve({ action: "accept" });
  };

  return (
    <section
      aria-labelledby={`elicitation-title-${request.requestId}`}
      className="rounded-xl border border-border bg-card p-3"
    >
      <ElicitationHeader request={request} />
      <div className="mt-3 rounded-md border border-border bg-background px-3 py-2.5">
        <p className="text-xs text-muted-foreground">{host}</p>
        <code className="mt-1 block break-all font-mono text-xs leading-5 text-foreground">
          {request.url}
        </code>
      </div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">
        Radius will open this address only after you continue. Return here when
        the browser step is complete.
      </p>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={submitting !== null}
          onClick={() => void resolve({ action: "cancel" })}
        >
          {submitting === "cancel" ? "Cancelling..." : "Cancel"}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          disabled={submitting !== null}
          onClick={() => void resolve({ action: "decline" })}
        >
          {submitting === "decline" ? "Declining..." : "Decline"}
        </Button>
        <Button
          type="button"
          size="sm"
          disabled={submitting !== null}
          onClick={openAndContinue}
        >
          <ExternalLink className="size-3.5" aria-hidden />
          {submitting === "accept" ? "Opening..." : "Open and continue"}
        </Button>
      </div>
      {error ? (
        <p role="alert" className="mt-2 text-xs text-negative">
          {error}
        </p>
      ) : null}
    </section>
  );
}

export function AgentElicitationPanel({
  requests,
  loading,
  error,
  onRefresh,
  onResolve,
}: {
  requests: readonly PendingAgentElicitation[];
  loading: boolean;
  error: string | null;
  onRefresh(): void;
  onResolve(
    request: PendingAgentElicitation,
    response: AgentElicitationResponse,
  ): Promise<void>;
}): ReactNode {
  if (loading && requests.length === 0) {
    return (
      <div
        aria-label="Loading requested input"
        className="mb-2 space-y-2 rounded-xl border border-border bg-card p-3"
      >
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full" />
      </div>
    );
  }
  if (error && requests.length === 0) {
    return (
      <Alert
        variant="destructive"
        className="mb-2 rounded-xl bg-card px-3 py-2"
      >
        <CircleAlert className="size-3.5" aria-hidden />
        <AlertDescription className="flex min-w-0 items-center justify-between gap-3 text-xs">
          <span>Requested input could not be loaded.</span>
          <Button type="button" variant="outline" size="xs" onClick={onRefresh}>
            <RotateCcw className="size-3" aria-hidden />
            Try again
          </Button>
        </AlertDescription>
      </Alert>
    );
  }
  if (requests.length === 0) return null;

  return (
    <div
      aria-label="Agent requests"
      className="mb-2 max-h-[min(55vh,32rem)] space-y-2 overflow-y-auto overscroll-contain pr-1"
    >
      {requests.map((request) =>
        request.mode === "form" ? (
          <FormElicitationCard
            key={request.requestId}
            request={request}
            onResolve={(response) => onResolve(request, response)}
          />
        ) : (
          <UrlElicitationCard
            key={request.requestId}
            request={request}
            onResolve={(response) => onResolve(request, response)}
          />
        ),
      )}
      {error ? (
        <p role="status" className="px-1 text-xs text-negative">
          Radius could not refresh requested input. Existing requests remain
          available.
        </p>
      ) : null}
    </div>
  );
}
