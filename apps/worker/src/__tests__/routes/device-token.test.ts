import { describe, test, expect, beforeEach } from "vitest";
import { http, HttpResponse } from "msw";
import { handleRegisterDeviceToken } from "@/routes/device-token";
import { mockEnv } from "@/__tests__/setup";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";

function pushTokenRequest(body: string): Request {
  return new Request("http://test/devices/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
}

describe("handleRegisterDeviceToken", () => {
  beforeEach(() => {
    server.use(
      http.post(PROVIDER_URLS.supabaseUpsertPushToken, async ({ request }) => {
        const body = (await request.json()) as any as {
          p_push_token?: string;
          p_platform?: string;
          p_app_version?: string | null;
        };
        return HttpResponse.json({
          token: body.p_push_token,
          platform: body.p_platform,
          app_version: body.p_app_version,
        });
      }),
    );
  });

  test("accepts a valid Expo push token", async () => {
    const res = await handleRegisterDeviceToken(
      pushTokenRequest(
        JSON.stringify({
          push_token: "ExponentPushToken[abc123]",
          platform: "android",
          app_version: "1.2.3",
        }),
      ),
      mockEnv(),
      null,
    );
    expect(res.status).toBe(200);
    expect((await res.json()) as any).toEqual({ ok: true });
  });

  test("returns 400 for a non-Expo token", async () => {
    const res = await handleRegisterDeviceToken(
      pushTokenRequest(
        JSON.stringify({ push_token: "APNs-abc123", platform: "ios" }),
      ),
      mockEnv(),
      null,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as any).toEqual({ error: "INVALID_BODY" });
  });

  test("returns 400 for an unknown platform", async () => {
    const res = await handleRegisterDeviceToken(
      pushTokenRequest(
        JSON.stringify({
          push_token: "ExponentPushToken[abc123]",
          platform: "web",
        }),
      ),
      mockEnv(),
      null,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as any).toEqual({ error: "INVALID_BODY" });
  });

  test("returns 400 when the body is missing fields", async () => {
    const res = await handleRegisterDeviceToken(
      pushTokenRequest(JSON.stringify({ platform: "android" })),
      mockEnv(),
      null,
    );
    expect(res.status).toBe(400);
    expect((await res.json()) as any).toEqual({ error: "INVALID_BODY" });
  });
});
