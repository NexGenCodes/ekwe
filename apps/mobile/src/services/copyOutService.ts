import * as Clipboard from "expo-clipboard";

import { EKWE_SHARE_SIGNATURE } from "@/constants/share";
import { logger } from "@/utils";

/**
 * Copying a result, in one place.
 *
 * Every caller used to decide for itself what lands on the clipboard: some
 * signed it, some did not, and the History row copied bare text while
 * `AnimatedCopyButton` copied signed text. That last difference was visible to
 * users — the same text pasted from two places came out different.
 *
 * The signature now lives here, so copied text matches what is on screen and
 * what sharing would send.
 */
export const CopyService = {
  /**
   * @param text      the visible result text, unsigned
   * @param options.sign  set false for text that must paste verbatim — a
   *   captcha, a URL, a code sample, anything the user is copying to use
   *   rather than to attribute. Defaults true, because a result is attributed.
   */
  copyText: async (
    text: string,
    options?: { sign?: boolean },
  ): Promise<boolean> => {
    const trimmed = text.trim();
    if (!trimmed) return false;

    const sign = options?.sign ?? true;

    try {
      await Clipboard.setStringAsync(
        sign ? `${trimmed}${EKWE_SHARE_SIGNATURE}` : trimmed,
      );
      return true;
    } catch (err) {
      logger.error("[CopyOut] Copy failed:", err);
      return false;
    }
  },
};
