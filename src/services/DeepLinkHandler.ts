import * as Linking from 'expo-linking';
import { EkweError } from 'src/constants/errors';
import { Result, ok, err } from 'src/types/Result';

export interface DeepLinkPayload {
  type: 'share';
  uri: string;
  sourceApp: string | null;
}

type AppState = 'cold' | 'background' | 'foreground';

class DeepLinkHandlerClass {
  private pendingPayload: DeepLinkPayload | null = null;
  private listeners: Set<(payload: DeepLinkPayload) => void> = new Set();

  /**
   * Initialises deep link handling for all three app states.
   * Call this once in App.tsx on mount.
   * Returns an unsubscribe function.
   */
  initialise(): () => void {
    // Handle deep links when app is already open (foreground/background)
    const subscription = Linking.addEventListener('url', (event) => {
      this.handleUrl(event.url, 'foreground');
    });

    // Handle cold start deep link
    Linking.getInitialURL().then((url) => {
      if (url !== null && url !== undefined) {
        this.handleUrl(url, 'cold');
      }
    });

    return () => subscription.remove();
  }

  /**
   * Parses and validates an incoming deep link URL.
   * Stores the payload for retrieval by useDeepLink hook.
   */
  private handleUrl(url: string, _appState: AppState): void {
    const parsed = this.parseUrl(url);
    if (!parsed.ok) return;

    this.pendingPayload = parsed.value;
    this.listeners.forEach((l) => l(parsed.value));
  }

  /**
   * Parses the ekwe://share?uri=... URL scheme.
   * Returns a typed DeepLinkPayload or an error.
   */
  parseUrl(url: string): Result<DeepLinkPayload, EkweError> {
    try {
      if (!url.startsWith('ekwe://')) {
        return err(EkweError.BAD_FORMAT);
      }

      const urlObj = new URL(url);

      if (urlObj.hostname === 'share') {
        const uri = urlObj.searchParams.get('uri') ?? '';
        const sourceApp = urlObj.searchParams.get('source') ?? null;

        if (uri.length === 0) {
          return err(EkweError.SHARE_COPY_FAIL);
        }

        return ok({ type: 'share', uri, sourceApp });
      }

      return err(EkweError.BAD_FORMAT);
    } catch {
      return err(EkweError.BAD_FORMAT);
    }
  }

  /**
   * Returns and clears the pending deep link payload.
   * Returns null if no payload is waiting.
   */
  consumePendingPayload(): DeepLinkPayload | null {
    const payload = this.pendingPayload;
    this.pendingPayload = null;
    return payload;
  }

  /**
   * Subscribes to incoming deep link events.
   * Returns an unsubscribe function.
   */
  subscribe(listener: (payload: DeepLinkPayload) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Resets internal state. Used for testing only.
   */
  _resetForTesting(): void {
    this.pendingPayload = null;
    this.listeners.clear();
  }
}

export const DeepLinkHandler = new DeepLinkHandlerClass();
