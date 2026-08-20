import { WORKER_ERROR_CODES } from "@ekwe/shared";
import { Env } from "../core/types";
import { safeParseJSON } from "../core/guards";
import { withCache } from "../core/cache";

/**
 * /update/manifest — the app's update manifest.
 *
 * GET  (public)  → the latest `version.json` (stored in KV by the release
 *                  workflow), so the app can check for APK updates without a
 *                  hard dependency on GitHub being reachable from the device.
 * POST (secret)  → the release workflow stores the manifest after a build.
 */

const MANIFEST_KEY = "update:manifest";

interface UpdateManifest {
  latest_version: string;
  latest_version_code: number;
  min_supported_version_code: number;
  download_url: string;
  checksum_sha256?: string;
  file_size?: number;
  release_notes?: string;
}

function isUpdateManifest(value: unknown): value is UpdateManifest {
  if (typeof value !== "object" || value === null) return false;
  const m = value as Partial<UpdateManifest>;
  return (
    typeof m.latest_version === "string" &&
    typeof m.latest_version_code === "number" &&
    typeof m.min_supported_version_code === "number" &&
    typeof m.download_url === "string" &&
    m.download_url.startsWith("https://")
  );
}

function bearerSecret(env: Env): string | undefined {
  const value = env.PUSH_NOTIFY_SECRET;
  return typeof value === "string" ? value : undefined;
}

export async function handleGetUpdateManifest(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  return withCache(request, ctx, async () => {
    const raw = await env.EKWE_KV.get(MANIFEST_KEY);
    if (!raw) {
      return Response.json(
        { error: WORKER_ERROR_CODES.NOT_FOUND },
        { status: 404 },
      );
    }
    return new Response(raw, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=300",
      },
    });
  }, 300);
}

export async function handlePostUpdateManifest(
  request: Request,
  env: Env,
): Promise<Response> {
  const secret = bearerSecret(env);
  const auth = request.headers.get("Authorization");
  if (!secret || auth !== `Bearer ${secret}`) {
    return Response.json(
      { error: WORKER_ERROR_CODES.UNAUTHORIZED },
      { status: 401 },
    );
  }

  const parsed = await safeParseJSON<unknown>(request);
  if (!parsed.ok) return parsed.response;

  if (!isUpdateManifest(parsed.data)) {
    return Response.json(
      { error: WORKER_ERROR_CODES.INVALID_BODY },
      { status: 400 },
    );
  }

  await env.EKWE_KV.put(MANIFEST_KEY, JSON.stringify(parsed.data));
  return Response.json({ ok: true });
}