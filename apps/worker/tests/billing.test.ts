import { describe, test, expect, beforeEach } from "vitest";
import { checkPreflight } from "../src/utils/preflight";
import { mockEnv, mockFetch, jsonResponse } from "./setup";

describe("Billing & Preflight", () => {
  const env = mockEnv();

  beforeEach(() => {
    mockFetch(async () => jsonResponse({ ok: true }));
  });

  describe("checkPreflight", () => {
    test("returns OK when RPC returns true", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/check_preflight")) {
          return jsonResponse({
            allowed: true,
            tier_active: "FREE",
          });
        }
        return jsonResponse({});
      });

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(true);
    });

    test("returns NOT allowed when RPC returns false", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/check_preflight")) {
          return jsonResponse({
            allowed: false,
            reason: "RATE_LIMIT",
            tier_active: "FREE",
          });
        }
        return jsonResponse({});
      });

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(false);
      expect(res.reason).toBe("RATE_LIMIT");
    });

    test("defaults to false on network error", async () => {
      mockFetch(async () => {
        throw new Error("Network offline");
      });

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(false);
    });
  });
});
