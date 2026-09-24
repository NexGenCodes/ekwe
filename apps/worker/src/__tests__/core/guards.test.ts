import { describe, expect, it } from "vitest";
import {
  guardContentType,
  guardTextLength,
  guardAudioSize,
  guardAudioDuration,
  guardAutoDetect,
  guardLanguageCode,
  guardWebSocketUpgrade,
  guardJsonSize,
  guardMultipartSize,
  guardStreamingAllowed,
  guardStreamDuration,
  tooManyRequests,
} from "@/core/guards";
import { FREE_LIMITS, PREMIUM_LIMITS } from "@/core/limits";

describe("guardContentType", () => {
  it("allows valid JSON", () => {
    const req = new Request("https://test.com", {
      headers: { "Content-Type": "application/json" },
    });
    expect(guardContentType(req, "json")).toEqual({ allowed: true });
  });

  it("rejects invalid JSON", () => {
    const req = new Request("https://test.com", {
      headers: { "Content-Type": "text/plain" },
    });
    const result = guardContentType(req, "json");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(415);
  });

  it("allows valid multipart", () => {
    const req = new Request("https://test.com", {
      headers: { "Content-Type": "multipart/form-data; boundary=---123" },
    });
    expect(guardContentType(req, "multipart")).toEqual({ allowed: true });
  });
});

describe("guardTextLength", () => {
  it("allows text within limit", () => {
    expect(guardTextLength("hello", "FREE")).toEqual({ allowed: true });
  });

  it("rejects text over limit", () => {
    const text = "a".repeat(FREE_LIMITS.maxTextChars + 1);
    const result = guardTextLength(text, "FREE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(413);
  });
});

describe("guardAudioSize", () => {
  it("allows size within limit", () => {
    expect(guardAudioSize(100, "FREE")).toEqual({ allowed: true });
  });

  it("rejects size over limit", () => {
    const result = guardAudioSize(FREE_LIMITS.maxAudioBytes + 1, "FREE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(413);
  });
});

describe("guardAudioDuration", () => {
  it("allows missing or zero duration", () => {
    expect(guardAudioDuration(undefined, "FREE")).toEqual({ allowed: true });
    expect(guardAudioDuration(0, "FREE")).toEqual({ allowed: true });
  });

  it("allows duration within limit", () => {
    expect(guardAudioDuration(1000, "FREE")).toEqual({ allowed: true });
  });

  it("rejects duration over limit", () => {
    const result = guardAudioDuration(
      FREE_LIMITS.dictationDurationMs + 1,
      "FREE",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(413);
  });
});

describe("guardAutoDetect", () => {
  it("allows auto detect for PREMIUM", () => {
    expect(guardAutoDetect("auto", "PREMIUM")).toEqual({ allowed: true });
    expect(guardAutoDetect(null, "PREMIUM")).toEqual({ allowed: true });
  });

  it("rejects auto detect for FREE", () => {
    const result = guardAutoDetect("auto", "FREE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });

  it("allows specific language for FREE", () => {
    expect(guardAutoDetect("en", "FREE")).toEqual({ allowed: true });
  });
});

describe("guardLanguageCode", () => {
  it("allows known language codes and auto", () => {
    expect(guardLanguageCode("en", "test")).toEqual({ allowed: true });
    expect(guardLanguageCode("auto", "test")).toEqual({ allowed: true });
  });

  it("allows missing language codes", () => {
    expect(guardLanguageCode(null, "test")).toEqual({ allowed: true });
  });

  it("rejects unknown language codes", () => {
    const result = guardLanguageCode("xyz", "test");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(400);
  });
});

describe("guardWebSocketUpgrade", () => {
  it("allows valid upgrade", () => {
    const req = new Request("https://test.com", {
      headers: { Upgrade: "websocket" },
    });
    expect(guardWebSocketUpgrade(req)).toBeNull();
  });

  it("rejects invalid upgrade", () => {
    const req = new Request("https://test.com");
    const result = guardWebSocketUpgrade(req);
    expect(result).not.toBeNull();
    expect(result?.status).toBe(426);
  });
});

describe("guardJsonSize", () => {
  it("allows size under limit", () => {
    const req = new Request("https://test.com", {
      headers: { "Content-Length": "100" },
    });
    expect(guardJsonSize(req, 1000)).toEqual({ allowed: true });
  });

  it("rejects size over limit", () => {
    const req = new Request("https://test.com", {
      headers: { "Content-Length": "2000" },
    });
    const result = guardJsonSize(req, 1000);
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(413);
  });
});

describe("guardMultipartSize", () => {
  it("allows missing Content-Length", () => {
    const req = new Request("https://test.com");
    expect(guardMultipartSize(req, "FREE")).toEqual({ allowed: true });
  });

  it("allows size under limit", () => {
    const req = new Request("https://test.com", {
      headers: { "Content-Length": String(FREE_LIMITS.maxAudioBytes) },
    });
    expect(guardMultipartSize(req, "FREE")).toEqual({ allowed: true });
  });

  it("rejects size over limit", () => {
    const limit = FREE_LIMITS.maxAudioBytes + 256 * 1024;
    const req = new Request("https://test.com", {
      headers: { "Content-Length": String(limit + 1) },
    });
    const result = guardMultipartSize(req, "FREE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(413);
  });
});

describe("guardStreamingAllowed", () => {
  it("allows PREMIUM", () => {
    expect(guardStreamingAllowed("PREMIUM")).toEqual({ allowed: true });
  });

  it("rejects FREE", () => {
    const result = guardStreamingAllowed("FREE");
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });
});

describe("guardStreamDuration", () => {
  it("allows duration under limit", () => {
    expect(guardStreamDuration(1000, "PREMIUM")).toEqual({ allowed: true });
  });

  it("rejects duration over limit", () => {
    const result = guardStreamDuration(
      PREMIUM_LIMITS.maxStreamDurationMs + 1,
      "PREMIUM",
    );
    expect(result.allowed).toBe(false);
    if (!result.allowed) expect(result.response.status).toBe(403);
  });
});

describe("tooManyRequests", () => {
  it("returns 429 with Retry-After header", () => {
    const res = tooManyRequests("Slow down", 30);
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
  });
});
