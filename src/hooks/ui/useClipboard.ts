import * as Clipboard from 'expo-clipboard';
import { useState, useCallback, useRef } from 'react';

interface UseClipboardReturn {
  /** Whether text was recently copied (auto-resets after timeout). */
  copied: boolean;
  /** Copies text to clipboard and triggers the copied state. */
  copy: (text: string) => Promise<void>;
}

/**
 * Shared clipboard hook with auto-reset "copied" feedback state.
 * Deduplicates identical copy logic in result.tsx and translate.tsx.
 */
export const useClipboard = (resetMs: number = 2000): UseClipboardReturn => {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const copy = useCallback(
    async (text: string): Promise<void> => {
      await Clipboard.setStringAsync(text);
      setCopied(true);

      // Clear any existing timer to prevent stale resets
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setCopied(false), resetMs);
    },
    [resetMs],
  );

  return { copied, copy };
};
