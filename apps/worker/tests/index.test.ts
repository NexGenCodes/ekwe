import { describe, test, expect, beforeEach, vi } from "vitest";
import app from "../src/index";
import { mockEnv, jsonResponse } from "./setup";
import { http } from "msw";
import { server } from "./msw/server";
import { PROVIDER_URLS } from "./msw/handlers";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

import { jwtVerify } from "jose";

describe("Worker Router (index.ts)", () => {
  const env = mockEnv();

  beforeEach(() => {
    vi.restoreAllMocks();
    server.use(
      http.post(PROVIDER_URLS.supabaseCheckPreflight, () =>
        jsonResponse({ allowed: true, tier_active: "FREE" }),
      ),
    );
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
      expect(res.headers.get("Access-Control-Allow-Origin")).toBe(
        "http://localhost",
      );
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

    test("rejects invalid JWT token", async () => {
      (jwtVerify as any).mockRejectedValue(new Error("jwt malformed"));

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: { Authorization: "Bearer invalid-jwt-token" },
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const json = await res.json();
      expect(json).toHaveProperty("error", "INVALID_TOKEN");
    });

    test("accepts valid JWT and routes to handler", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "user-123",
          email: "test@example.com",
          app_metadata: { is_pro: false },
        },
      });

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer valid-jwt-token",
        },
        body: JSON.stringify({
          text: "hello",
          sourceLang: "en",
          targetLang: "fr",
        }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
    });

    test("accepts valid PREMIUM JWT", async () => {
      (jwtVerify as any).mockResolvedValue({
        payload: {
          sub: "pro-user-456",
          email: "pro@example.com",
          app_metadata: { is_pro: true },
        },
      });

      const req = new Request("http://localhost/translate", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer premium-jwt-token",
        },
        body: JSON.stringify({
          text: "hello",
          sourceLang: "en",
          targetLang: "fr",
        }),
      });
      const res = await app.fetch(req, env, {
        waitUntil: vi.fn(),
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(200);
    });

    test("rejects request on /transcribe/stream with missing token", async () => {
      const req = new Request("http://localhost/transcribe/stream", {
        method: "GET",
      });
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toBe("Missing token");
    });

    test("rejects request on /transcribe/stream with invalid token", async () => {
      (jwtVerify as any).mockRejectedValue(new Error("jwt malformed"));

      const req = new Request(
        "http://localhost/transcribe/stream?token=bad-token",
        {
          method: "GET",
        },
      );
      const res = await app.fetch(req, env, {
        waitUntil: () => {},
        passThroughOnException: () => {},
      } as any);

      expect(res.status).toBe(401);
      const text = await res.text();
      expect(text).toBe("Invalid token");
    });
  });
});
