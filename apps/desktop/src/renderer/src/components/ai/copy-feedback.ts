import { useCallback, useEffect, useRef, useState } from "react";

const COPY_FEEDBACK_DURATION_MS = 1_500;

export function useCopyFeedback(): {
  copied: boolean;
  copyText: (text: string) => Promise<void>;
} {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    },
    [],
  );

  const copyText = useCallback(async (text: string): Promise<void> => {
    await window.radius.writeClipboardText(text);
    setCopied(true);
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      setCopied(false);
    }, COPY_FEEDBACK_DURATION_MS);
  }, []);

  return { copied, copyText };
}
