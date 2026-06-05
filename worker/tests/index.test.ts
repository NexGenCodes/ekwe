import { describe, test, expect, beforeEach, vi } from "vitest";
import app from "../src/index";
import { mockEnv, mockFetch, jsonResponse } from "./setup";
import * as utils from "../src/utils";

describe("Worker Router (index.ts)", () => {
  const env = mockEnv();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe("CORS & Preflight", () => {
    test("handles OPTIONS requests with CORS headers", async () => {
      const req = new Request("http://localhost/translate", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost" },
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost");
      expect(res.headers.get("Access-Control-Allow-Methods")).toContain("POST");
    });
  });

  describe("Auth Middleware", () => {
    test("rejects request without Authorization header", async () => {
      const req = new Request("http://localhost/translate", {
        method: "POST",
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toHaveProperty("error", "UNAUTHORIZED");
    });

    test("rejects request with invalid token format", async () => {
      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: { Authorization: "InvalidTokenFormat" },
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
    });
  });
});
