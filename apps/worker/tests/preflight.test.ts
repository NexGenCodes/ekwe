import { beforeEach, describe, expect, test, vi } from "vitest";
import { checkPreflight } from "../src/utils/preflight";
import { mockEnv, jsonResponse } from "./setup";
import { http } from "msw";
import { server } from "./msw/server";
import { PROVIDER_URLS } from "./msw/handlers";

describe("checkPreflight (cooldown + quota gate)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({
          allowed: true,
          tier_active: "FREE",
          quota_total: 25,
          quota_remaining: 25,
        }),
      ),
    );
  });

  test("sends the per-type daily limit and usage type for FREE translate", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({
          allowed: true,
          tier_active: "FREE",
          quota_total: 25,
          quota_remaining: 24,
        });
      }),
    );

    const res = await checkPreflight(mockEnv(), "uid-1", "FREE", "translate");

    expect(body).toMatchObject({
      p_user_id: "uid-1",
      p_tier: "FREE",
      p_type: "translate",
      p_daily_limit: 25,
    });
    expect(res.quota_remaining).toBe(24);
  });

  test("sends the premium transcribe limit", async () => {
    let body: Record<string, unknown> = {};
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, async ({ request }) => {
        body = (await request.json()) as Record<string, unknown>;
        return jsonResponse({ allowed: true, tier_active: "PREMIUM" });
      }),
    );

    await checkPreflight(mockEnv(), "uid-2", "PREMIUM", "transcribe");

    expect(body).toMatchObject({
      p_type: "transcribe",
      p_daily_limit: 200,
    });
  });

  test("fails closed to PREFLIGHT_UNAVAILABLE when the RPC returns an error", async () => {
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({ error: "boom" }, 500),
      ),
    );

    const res = await checkPreflight(mockEnv(), "uid-3", "FREE", "translate");

    expect(res).toMatchObject({
      allowed: false,
      tier_active: "FREE",
      reason: "PREFLIGHT_UNAVAILABLE",
    });
  });

  test("fails closed to PREFLIGHT_CONFIG_ERROR when env vars are missing", async () => {
    const res = await checkPreflight(
      mockEnv({ SUPABASE_URL: "", SUPABASE_SERVICE_ROLE_KEY: "" }),
      "uid-4",
      "FREE",
      "translate",
    );

    expect(res).toMatchObject({
      allowed: false,
      reason: "PREFLIGHT_CONFIG_ERROR",
    });
  });
});
