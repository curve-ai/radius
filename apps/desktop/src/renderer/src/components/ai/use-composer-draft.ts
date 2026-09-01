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

export function useComposerDraft(context: ComposerDraftContext): {
  error: string | null;
  flush(): Promise<void>;
  reset(): void;
  setValue(value: string): void;
  value: string;
} {
  const contextKey = composerDraftContextKey(context);
  const editRevisionRef = useRef(0);
  const pendingSaveRef = useRef<Promise<void> | null>(null);
  const [state, setState] = useState<DraftState>({
    contextKey,
    value: "",
  });
  const [errorState, setErrorState] = useState<DraftErrorState | null>(null);

  useEffect(() => {
    let disposed = false;
    const editRevisionAtLoad = editRevisionRef.current;
    void window.radius
      .getComposerDraft(context)
      .then((content) => {
        if (disposed || editRevisionRef.current !== editRevisionAtLoad) {
          return;
        }
        setState({ contextKey, value: content ?? "" });
        setErrorState((current) =>
          current?.contextKey === contextKey ? null : current,
        );
      })
      .catch(() => {
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
    setState({ contextKey, value: "" });
    setErrorState((current) =>
      current?.contextKey === contextKey ? null : current,
    );
  }, [contextKey]);

  const flush = useCallback(
    (): Promise<void> => draftWriteQueue.waitForIdle(contextKey),
    [contextKey],
  );

  return {
    error: errorState?.contextKey === contextKey ? errorState.message : null,
    flush,
    reset,
    setValue,
    value: state.contextKey === contextKey ? state.value : "",
  };
}
