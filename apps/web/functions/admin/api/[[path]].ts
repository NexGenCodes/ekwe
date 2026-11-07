const WORKER_ORIGIN = "https://ekwe-proxy.ekwe.workers.dev";

interface PagesContext {
  request: Request;
}

function readAccessJwt(request: Request): string | null {
  const header = request.headers.get("Cf-Access-Jwt-Assertion");
  if (header) return header;

  const cookie = request.headers.get("Cookie");
  if (!cookie) return null;
  const match = cookie.match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

/**
 * Same-origin proxy for the admin dashboard.
 *
 * The dashboard is served from ekwe.pages.dev, which Cloudflare Access
 * protects. Access scopes its session cookie to that host, so the browser can
 * only authenticate same-origin. This Function forwards the request to the
 * Worker with the Access JWT (header or CF_Authorization cookie), and the
 * Worker verifies it against the tenant JWKS plus ADMIN_EMAILS.
 */
export async function onRequest(context: PagesContext): Promise<Response> {
  const url = new URL(context.request.url);
  const target = `${WORKER_ORIGIN}${url.pathname.replace(/^\/admin\/api/, "/admin")}${url.search}`;

  const jwt = readAccessJwt(context.request);
  if (!jwt) {
    return Response.json(
      { error: "ACCESS_SESSION_REQUIRED" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const headers = new Headers();
  headers.set("Cf-Access-Jwt-Assertion", jwt);
  const contentType = context.request.headers.get("Content-Type");
  if (contentType) headers.set("Content-Type", contentType);

  const method = context.request.method;
  const body =
    method === "GET" || method === "HEAD"
      ? undefined
      : await context.request.arrayBuffer();

  const upstream = await fetch(target, {
    method,
    headers,
    body,
    redirect: "manual",
  });

  const responseHeaders = new Headers({
    "Content-Type": upstream.headers.get("Content-Type") ?? "application/json",
    "Cache-Control": "no-store",
  });

  if (upstream.status >= 300 && upstream.status < 400) {
    return Response.json(
      {
        error:
          "The Worker rejected the forwarded Access token. Sign in again at /admin.",
        upstreamStatus: upstream.status,
      },
      { status: 401, headers: responseHeaders },
    );
  }

  if (upstream.status === 401) {
    return Response.json(
      {
        error:
          "Access token verified by Cloudflare but not accepted by the Worker. Check ADMIN_EMAILS and CF_ACCESS_AUDIENCE.",
        upstreamStatus: 401,
      },
      { status: 401, headers: responseHeaders },
    );
  }

  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}
