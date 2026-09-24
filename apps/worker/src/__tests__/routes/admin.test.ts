import { describe, test, expect } from "vitest";
import { runPipeline, type AppRoute } from "@/core/pipeline";
import { handleUpdateNotify, handlePostUpdateManifest } from "@/routes/admin";
import { mockEnv, mockExecutionContext } from "@/__tests__/setup";

const SECRET = "test-admin-secret-123";

const routes: AppRoute[] = [
  {
    method: "POST",
    path: "/admin/update/notify",
    auth: "admin",
    handler: (rctx) => handleUpdateNotify(rctx.request, rctx.env),
  },
  {
    method: "POST",
    path: "/admin/update/manifest",
    auth: "admin",
    handler: (rctx) => handlePostUpdateManifest(rctx.request, rctx.env),
  },
];

async function pipeline(
  url: string,
  env: ReturnType<typeof mockEnv>,
  init: RequestInit = {},
): Promise<Response> {
  return runPipeline(
    new Request(url, init),
    env,
    mockExecutionContext(),
    routes,
  );
}

describe("admin auth", () => {
  test("rejects /admin/update/notify when the secret is unset", async () => {
    const env = mockEnv({ UPDATE_NOTIFY_SECRET: undefined });
    const res = await pipeline("http://test/admin/update/notify", env, {
      method: "POST",
      headers: { Authorization: `Bearer ${SECRET}` },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  test("rejects /admin/update/notify with a wrong secret", async () => {
    const env = mockEnv({ UPDATE_NOTIFY_SECRET: SECRET });
    const res = await pipeline("http://test/admin/update/notify", env, {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });

  test("accepts /admin/update/notify with the correct secret", async () => {
    const env = mockEnv({ UPDATE_NOTIFY_SECRET: SECRET });
    const res = await pipeline("http://test/admin/update/notify", env, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${SECRET}`,
      },
      body: "{}",
    });
    expect(res.status).not.toBe(401);
  });

  test("rejects /admin/update/manifest with a missing secret", async () => {
    const env = mockEnv({ UPDATE_NOTIFY_SECRET: SECRET });
    const res = await pipeline("http://test/admin/update/manifest", env, {
      method: "POST",
    });
    expect(res.status).toBe(401);
  });

  test("rejects /admin/update/manifest with a wrong secret", async () => {
    const env = mockEnv({ UPDATE_NOTIFY_SECRET: SECRET });
    const res = await pipeline("http://test/admin/update/manifest", env, {
      method: "POST",
      headers: { Authorization: "Bearer nope" },
      body: "{}",
    });
    expect(res.status).toBe(401);
  });
});
