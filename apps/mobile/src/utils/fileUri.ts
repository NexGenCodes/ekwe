/**
 * Android's audio pipeline hands JS bare filesystem paths
 * (`/data/user/0/<pkg>/cache/x.m4a`) while iOS hands back `file://` URLs.
 *
 * `expo-audio` runs every string source through `Asset.fromURI(...)` +
 * `downloadAsync()`, and expo-asset only short-circuits a URL as local when it
 * has the `file` scheme. A bare path therefore looks like a remote asset: the
 * player tries to download it, logs "Unable to download asset", and only then
 * falls back to the original source. Prefixing absolute paths keeps playback on
 * the direct-file path on both platforms.
 */
export const toFileUri = (
  path: string | null | undefined,
): string | undefined => {
  if (!path) return undefined;
  // Anything with a scheme (file://, content://, https://) is already a URI.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(path)) return path;
  return path.startsWith("/") ? `file://${path}` : path;
};
