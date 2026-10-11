export function isDevOrigin(origin: string): boolean {
  let url: URL;
  try {
    url = new URL(origin);
  } catch {
    return false;
  }

  if (url.protocol === "exp:") return true;

  const hostname = url.hostname.toLowerCase();
  if (
    hostname === "localhost" ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  ) {
    return true;
  }
  return (
    hostname === "expo.dev" ||
    hostname.endsWith(".expo.dev") ||
    hostname === "expo.io" ||
    hostname.endsWith(".expo.io")
  );
}
