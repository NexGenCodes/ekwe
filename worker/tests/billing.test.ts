import { describe, test, expect, beforeEach } from "vitest";
import { checkPreflight, postflightDeduction } from "../src/utils";
import { mockEnv, mockFetch, jsonResponse } from "./setup";

describe("Billing & Preflight", () => {
  const env = mockEnv();

  beforeEach(() => {
    mockFetch(async () => jsonResponse({ ok: true })); // default catch-all
  });

  describe("checkPreflight", () => {
    test("returns OK when RPC returns true", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/check_preflight")) {
          return jsonResponse({
            allowed: true,
            transactions_used: 5,
            tier_active: "FREE",
          });
        }
        return jsonResponse({});
      });

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(true);
      expect(res.transactions_used).toBe(5);
    });

    test("returns NOT allowed when RPC returns false", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/check_preflight")) {
          return jsonResponse({
            allowed: false,
            transactions_used: 100,
            tier_active: "FREE",
          });
        }
        return jsonResponse({});
      });

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(false);
      expect(res.transactions_used).toBe(100);
    });

    test("defaults to false on network error", async () => {
      mockFetch(async () => {
        throw new Error("Network offline");
      });

      const res = await checkPreflight(env, "user-123", "FREE");
      expect(res.allowed).toBe(false);
    });
  });

  describe("postflightDeduction", () => {
    test("returns true when deduction succeeds", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/postflight_deduction")) {
          return jsonResponse({
            success: true,
            transactions_used: 6,
            tier_active: "FREE",
          });
        }
        return jsonResponse({});
      });

      const res = await postflightDeduction(env, "user-123", 1);
      expect(res).not.toBeNull();
      expect(res!.success).toBe(true);
      expect(res!.transactions_used).toBe(6);
    });

    test("returns false when deduction fails", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/postflight_deduction")) {
          return jsonResponse({
            success: false,
            transactions_used: 100,
            tier_active: "FREE",
          });
        }
        return jsonResponse({});
      });

      const res = await postflightDeduction(env, "user-123", 1);
      expect(res).not.toBeNull();
      expect(res!.success).toBe(false);
    });

    test("defaults to false on API 500 error", async () => {
      mockFetch(async (url) => {
        if (url.includes("/rpc/postflight_deduction")) {
          return jsonResponse({}, 500);
        }
        return jsonResponse({});
      });

      const res = await postflightDeduction(env, "user-123", 1);
      expect(res).toBeNull();
    });
  });
});
