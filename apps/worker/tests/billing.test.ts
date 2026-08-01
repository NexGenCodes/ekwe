import { describe, test, expect } from "vitest";
import { checkPreflight } from "../src/utils/preflight";
import { mockEnv, jsonResponse } from "./setup";
import { http } from "msw";
import { server } from "./msw/server";
import { PROVIDER_URLS } from "./msw/handlers";

describe("Billing & Preflight", () => {
  const env = mockEnv();

  describe("checkPreflight", () => {
    test("returns OK when RPC returns true", async () => {
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
          jsonResponse({ allowed: true, tier_active: "FREE" }),
        ),
      );

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(true);
    });

    test("returns NOT allowed when RPC returns false", async () => {
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
          jsonResponse({
            allowed: false,
            reason: "RATE_LIMIT",
            tier_active: "FREE",
          }),
        ),
      );

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("RATE_LIMIT");
    });

    test("defaults to false on network error", async () => {
      server.use(
        http.post(PROVIDER_URLS.supabaseCheckPreflight, () => {
          throw new Error("Network offline");
        }),
      );

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(false);
    });
  });
});
