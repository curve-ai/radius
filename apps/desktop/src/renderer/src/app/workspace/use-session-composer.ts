import { useCallback, useEffect, useRef, useState } from "react";
import type {
  AccessMode,
  ComposerDraftContext,
  ComposerState,
} from "../../../../radius-api";
import { composerDraftContextKey } from "../../components/ai/composer-draft-write-queue";
import { serializePromptAttachments } from "../../components/ai/attachment-files";

type View = {
  key: string;
  accessMode: AccessMode;
  files: Array<{ id: string; file: File }>;
};
function decode(
  key: string,
  state: ComposerState,
  previous: View | null,
): View {
  return {
    key,
    accessMode: state.accessMode,
    files: state.attachments.map((file) => ({
      id: file.id,
      file:
        (previous?.key === key
          ? previous.files.find((current) => current.id === file.id)?.file
          : null) ??
        new File([new Uint8Array(file.bytes).buffer], file.name, {
          type: file.mimeType,
          lastModified: file.lastModified,
        }),
    })),
  };
}

export function useSessionComposer(context: ComposerDraftContext): {
  accessMode: AccessMode;
  attachments: File[];
  loading: boolean;
  pending: boolean;
  error: string | null;
  addAttachments(files: readonly File[]): void;
  removeAttachment(index: number): void;
  setAccessMode(mode: AccessMode): void;
  flush(): Promise<string[]>;
} {
  const key = composerDraftContextKey(context);
  const [view, setView] = useState<View | null>(null);
  const [error, setError] = useState<{ key: string; message: string } | null>(
    null,
  );
  const [pendingKeys, setPendingKeys] = useState<Set<string>>(new Set());
  const latest = useRef<View | null>(null);
  const load = useRef<Promise<void>>(Promise.resolve());
  const writes = useRef(new Map<string, Promise<void>>());
  const revision = useRef(0);
  const accessRevision = useRef(0);
  const activeKey = useRef<string | null>(null);
  const reportError = useCallback(
    (cause: unknown): void => {
      setError({
        key,
        message: cause instanceof Error ? cause.message : String(cause),
      });
    },
    [key],
  );

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++revision.current;
    const accessRequest = accessRevision.current;
    const state = await window.radius.getComposerState(context);
    const next = decode(key, state, latest.current);
    if (accessRequest !== accessRevision.current && latest.current?.key === key)
      next.accessMode = latest.current.accessMode;
    if (request !== revision.current || activeKey.current !== key) return;
    latest.current = next;
    setView(next);
    setError(null);
  }, [context, key]);

  const refreshAccess = useCallback(async (): Promise<void> => {
    const request = ++accessRevision.current;
    const mode = await window.radius.getComposerAccessMode(context);
    const current = latest.current;
    if (
      request !== accessRevision.current ||
      activeKey.current !== key ||
      !current ||
      current.key !== key
    )
      return;
    const next = { ...current, accessMode: mode };
    latest.current = next;
    setView(next);
    setError(null);
  }, [context, key]);

  useEffect(() => {
    activeKey.current = key;
    const read = refresh();
    load.current = read;
    void read.catch(reportError);
    const off = window.radius.onComposerStateChanged((change) => {
      if (change.kind === "attachments") {
        if (composerDraftContextKey(change.context) !== key) return;
        const next = refresh();
        load.current = next;
        void next.catch(reportError);
      } else if (
        context.kind === "new_chat" ||
        change.sessionId === context.sessionId
      ) {
        void refreshAccess().catch(reportError);
      }
    });
    return () => {
      off();
      activeKey.current = null;
      revision.current += 1;
    };
  }, [context, key, refresh, refreshAccess, reportError]);

  const mutate = useCallback(
    (operation: () => Promise<void>, after = refresh): void => {
      setPendingKeys((current) => new Set(current).add(key));
      const next = (writes.current.get(key) ?? Promise.resolve())
        .catch(() => undefined)
        .then(operation)
        .then(after);
      writes.current.set(key, next);
      const settled = (): void => {
        if (writes.current.get(key) !== next) return;
        setPendingKeys((current) => {
          const next = new Set(current);
          next.delete(key);
          return next;
        });
      };
      void next.then(settled, (cause) => {
        settled();
        reportError(cause);
      });
    },
    [refresh, key, reportError],
  );

  const addAttachments = useCallback(
    (files: readonly File[]): void => {
      mutate(async () => {
        const attachments = await serializePromptAttachments(files);
        await window.radius.addComposerAttachments({
          context,
          files: attachments.map((attachment, index) => ({
            attachment,
            lastModified: files[index]!.lastModified,
          })),
        });
      });
    },
    [context, mutate],
  );
  const removeAttachment = useCallback(
    (index: number): void => {
      const id =
        latest.current?.key === key ? latest.current.files[index]?.id : null;
      if (id) mutate(() => window.radius.removeComposerAttachment(context, id));
    },
    [context, key, mutate],
  );
  const setAccessMode = useCallback(
    (mode: AccessMode): void => {
      mutate(
        () => window.radius.setComposerAccessMode(context, mode),
        refreshAccess,
      );
    },
    [context, mutate, refreshAccess],
  );
  const flush = useCallback(async (): Promise<string[]> => {
    await writes.current.get(key);
    await load.current;
    const current = latest.current;
    if (!current || current.key !== key) {
      const state = await window.radius.getComposerState(context);
      return state.attachments.map((file) => file.id);
    }
    return current.files.map((file) => file.id);
  }, [context, key]);
  const current = view?.key === key ? view : null;
  return {
    accessMode: current?.accessMode ?? "project",
    attachments: current?.files.map((file) => file.file) ?? [],
    loading: current === null,
    pending: pendingKeys.has(key),
    error: error?.key === key ? error.message : null,
    addAttachments,
    removeAttachment,
    setAccessMode,
    flush,
  };
}
