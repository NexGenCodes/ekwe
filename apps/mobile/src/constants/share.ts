/**
 * Appended to any text Ekwe shares or copies, in both directions.
 *
 * This lives outside `constants/echo.ts` on purpose: Echo (share-in) and Studio
 * (share-out) both emit it, so a name prefixed `ECHO_` would misdescribe half
 * its callers. The iOS share extension mirrors this string verbatim in
 * `targets/share/EchoShareModel.swift` — keep the two in step.
 */
export const EKWE_SHARE_SIGNATURE =
  "\n\n— Shared with Ekwe · Speak, we'll handle the rest";
