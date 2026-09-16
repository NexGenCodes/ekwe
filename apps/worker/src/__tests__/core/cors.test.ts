import { describe, expect, it } from "vitest";
import { getCorsHeaders, addCorsHeaders } from "@/core/cors";
import { Env } from "@/core/types";

describe("getCorsHeaders", () => {
  it("allows configured origin", () => {
    const req = new Request("https://api.com", {
      headers: { Origin: "https://allowed.com" },
    });
    const env = {
      ALLOWED_ORIGINS: "https://allowed.com,https://other.com",
      APP_ENV: "production",
    } as unknown as Env;

    const headers = getCorsHeaders(req, env);
    expect(headers["Access-Control-Allow-Origin"]).toBe("https://allowed.com");
    expect(headers["Access-Control-Allow-Credentials"]).toBe("true");
  });

  it("rejects unconfigured origin in production", () => {
    const req = new Request("https://api.com", {
      headers: { Origin: "https://evil.com" },
    });
    const env = {
      ALLOWED_ORIGINS: "https://allowed.com",
      APP_ENV: "production",
    } as unknown as Env;

    const headers = getCorsHeaders(req, env);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
    expect(headers["Access-Control-Allow-Credentials"]).toBeUndefined();
  });

  it("allows dev origins in non-production", () => {
    const req = new Request("https://api.com", {
      headers: { Origin: "http://localhost:3000" },
    });
    const env = {
      ALLOWED_ORIGINS: "https://allowed.com",
      APP_ENV: "development",
    } as unknown as Env;

    const headers = getCorsHeaders(req, env);
    expect(headers["Access-Control-Allow-Origin"]).toBe(
      "http://localhost:3000",
    );
  });

  it("rejects dev origins in production", () => {
    const req = new Request("https://api.com", {
      headers: { Origin: "http://localhost:3000" },
    });
    const env = {
      ALLOWED_ORIGINS: "https://allowed.com",
      APP_ENV: "production",
    } as unknown as Env;

    const headers = getCorsHeaders(req, env);
    expect(headers["Access-Control-Allow-Origin"]).toBeUndefined();
  });

  it("returns standard CORS headers even if origin is not allowed", () => {
    const req = new Request("https://api.com");
    const env = {
      ALLOWED_ORIGINS: "https://allowed.com",
      APP_ENV: "production",
    } as unknown as Env;

    const headers = getCorsHeaders(req, env);
    expect(headers["Access-Control-Allow-Methods"]).toBeDefined();
    expect(headers["Vary"]).toBe("Origin");
  });
});

describe("addCorsHeaders", () => {
  it("merges CORS headers onto an existing Response", () => {
    const res = new Response("ok", { headers: { "X-Custom": "123" } });
    const cors = { "Access-Control-Allow-Origin": "*" };

    const merged = addCorsHeaders(res, cors);
    expect(merged.headers.get("X-Custom")).toBe("123");
    expect(merged.headers.get("Access-Control-Allow-Origin")).toBe("*");
  });
});
