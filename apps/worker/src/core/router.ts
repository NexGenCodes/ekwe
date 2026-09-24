type HttpMethod =
  "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS";

export interface RouteLike {
  method: HttpMethod;
  path: string;
}

interface RouteMatch<R extends RouteLike> {
  route: R;
  params: Record<string, string>;
}

const PARAM_RE = /^:[A-Za-z_][A-Za-z0-9_]*$/;

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
        return null;
      }
    } else if (pat !== seg) {
      return null;
    }
  }
  return params;
}

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
