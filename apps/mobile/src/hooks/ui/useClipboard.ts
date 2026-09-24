import * as Clipboard from "expo-clipboard";
import { useState, useCallback, useRef } from "react";

interface UseClipboardReturn {
  copied: boolean;

  copy: (text: string) => Promise<void>;
}

export const useClipboard = (resetMs: number = 2000): UseClipboardReturn => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string): Promise<void> => {
      await Clipboard.setStringAsync(text);
      setCopied(true);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );

  return { copied, copy };
};
