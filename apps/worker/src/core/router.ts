/**
 * ─── Minimal zero-dependency router for the Ekwe Worker ──────────
 *
 * Routes are declared as { method, path, handler } tuples. Paths may contain
 * `:param` segments which are captured into `params` (URL-decoded). Matching
 * is exact per method + path, deterministic, and first-match-wins.
 *
 * Keeping this dependency-free and pure means it can be unit-tested in
 * isolation and swapped without touching the handlers.
 */

type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

/**
 * Minimal shape a route must provide. Concrete route tables extend this
 * (adding `auth`, `handler`, etc.) and keep their discriminated fields intact
 * through `matchRoute`, so callers can narrow on them after matching.
 */
export interface RouteLike {
  method: HttpMethod;
  /** Exact path, e.g. `/transcribe` or `/users/:id/history`. */
  path: string;
}

interface RouteMatch<R extends RouteLike> {
  route: R;
  params: Record<string, string>;
}

const PARAM_RE = /^:[A-Za-z_][A-Za-z0-9_]*$/;

/**
 * Matches a concrete pathname against a pattern. Returns captured `:param`
 * values, or null on any mismatch (segment count, literal segment, or
 * undecodable param).
 */
export function matchPath(
  pattern: string,
  pathname: string,
): Record<string, string> | null {
  if (pattern === "/") {
    return pathname === "/" ? {} : null;
  }

  const patternSegments = pattern.split("/").filter(Boolean);
  const pathSegments = pathname.split("/").filter(Boolean);
  if (patternSegments.length !== pathSegments.length) return null;

  const params: Record<string, string> = {};
  for (let i = 0; i < patternSegments.length; i++) {
    const pat = patternSegments[i];
    const seg = pathSegments[i];
    if (PARAM_RE.test(pat)) {
      try {
        params[pat.slice(1)] = decodeURIComponent(seg);
      } catch {
        // Malformed percent-encoding in a param segment: treat as non-match.
        return null;
      }
    } else if (pat !== seg) {
      return null;
    }
  }
  return params;
}

/**
 * Resolves the first route whose method and path match. Route order is
 * significant only when paths overlap (e.g. a `/:id` catch-all vs `/health`),
 * so literal routes should be declared before param routes.
 */
export function matchRoute<R extends RouteLike>(
  routes: readonly R[],
  method: string,
  pathname: string,
): RouteMatch<R> | null {
  const normalizedMethod = method.toUpperCase();
  for (const route of routes) {
    if (route.method !== normalizedMethod) continue;
    const params = matchPath(route.path, pathname);
    if (params !== null) return { route, params };
  }
  return null;
}
