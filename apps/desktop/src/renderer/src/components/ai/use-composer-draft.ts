import { useCallback, useEffect, useRef, useState } from "react";

import type { ComposerDraftContext } from "../../../../radius-api";
import {
  composerDraftContextKey,
  ComposerDraftWriteQueue,
} from "./composer-draft-write-queue";

const draftWriteQueue = new ComposerDraftWriteQueue();

interface DraftState {
  contextKey: string;
  value: string;
}

interface DraftErrorState {
  contextKey: string;
  message: string;
}

export function useComposerDraft(
  context: ComposerDraftContext,
  initialValue = "",
): {
  error: string | null;
  flush(): Promise<string>;
  reset(): void;
  setValue(value: string): void;
  value: string;
} {
  const contextKey = composerDraftContextKey(context);
  const editRevisionRef = useRef(0);
  const loadRevisionRef = useRef(0);
  const currentValueRef = useRef(initialValue);
  const pendingLoadRef = useRef<Promise<void> | null>(null);
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<DraftState>({
    contextKey,
    value: initialValue,
  });
  const [errorState, setErrorState] = useState<DraftErrorState | null>(null);

  useEffect(() => {
    let disposed = false;
    const editRevisionAtLoad = editRevisionRef.current;
    const loadRevision = ++loadRevisionRef.current;
    const load = window.radius.getComposerDraft(context).then((content) => {
      if (
        loadRevisionRef.current !== loadRevision ||
        editRevisionRef.current !== editRevisionAtLoad
      ) {
        return;
      }
      currentValueRef.current = content ?? "";
      // Cached chat captures can outlive this hook's mounted view.
      if (disposed) return;
      setState({ contextKey, value: content ?? "" });
      setErrorState((current) =>
        current?.contextKey === contextKey ? null : current,
      );
    });
    pendingLoadRef.current = load;
    void load.catch(() => {
      if (disposed) return;
      setErrorState({
        contextKey,
        message: "This draft could not be loaded.",
      });
    });
    return () => {
      disposed = true;
      void draftWriteQueue.waitForIdle(contextKey);
    };
  }, [context, contextKey]);

  const setValue = useCallback(
    (value: string): void => {
      editRevisionRef.current += 1;
      currentValueRef.current = value;
      setState({ contextKey, value });
      const pendingSave = draftWriteQueue.scheduleLatest(contextKey, () =>
        window.radius.saveComposerDraft({ context, content: value }),
      );
      if (pendingSaveRef.current === pendingSave) return;
      pendingSaveRef.current = pendingSave;
      const clearPendingSave = (): void => {
        if (pendingSaveRef.current === pendingSave) {
          pendingSaveRef.current = null;
        }
      };
      void pendingSave.then(
        () => {
          setErrorState((current) =>
            current?.contextKey === contextKey ? null : current,
          );
          clearPendingSave();
        },
        () => {
          setErrorState({
            contextKey,
            message: "This draft could not be saved.",
          });
          clearPendingSave();
        },
      );
    },
    [context, contextKey],
  );

  const reset = useCallback((): void => {
    editRevisionRef.current += 1;
    currentValueRef.current = "";
    setState({ contextKey, value: "" });
    setErrorState((current) =>
      current?.contextKey === contextKey ? null : current,
    );
  }, [contextKey]);

  const flush = useCallback(async (): Promise<string> => {
    await pendingLoadRef.current;
    try {
      await draftWriteQueue.flush(contextKey);
    } catch {
      throw new Error(
        "This draft could not be saved. Edit it and try again before moving the chat.",
      );
    }
    return currentValueRef.current;
  }, [contextKey]);

  return {
    error: errorState?.contextKey === contextKey ? errorState.message : null,
    flush,
    reset,
    setValue,
    value: state.contextKey === contextKey ? state.value : "",
  };
}
