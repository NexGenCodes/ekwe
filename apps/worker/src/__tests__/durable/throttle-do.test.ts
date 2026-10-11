import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { jsonBody } from "@/__tests__/setup";

function allow(key: string, limit: number, windowSec: number) {
  return env.THROTTLE_DO.getByName("otp").fetch(
    `https://otp-throttle/allow?key=${encodeURIComponent(key)}&limit=${limit}&windowSec=${windowSec}`,
  );
}

describe("ThrottleBucket", () => {
  it("allows up to the limit per key/window, then rejects", async () => {
    const key = "ip:1.2.3.4";
    const windowSec = 60;
    for (let i = 0; i < 5; i++) {
      const res = await allow(key, 5, windowSec);
      expect(res.status).toBe(200);
      expect(await jsonBody(res)).toEqual({ allowed: true });
    }
    const res = await allow(key, 5, windowSec);
    expect(res.status).toBe(200);
    expect(await jsonBody(res)).toEqual({ allowed: false });
  });

  it("keeps separate counters per key", async () => {
    const keyA = "email:a@b.co";
    const keyB = "email:c@d.co";
    await allow(keyA, 1, 600);
    expect(await jsonBody(await allow(keyA, 1, 600))).toEqual({
      allowed: false,
    });
    expect(await jsonBody(await allow(keyB, 1, 600))).toEqual({
      allowed: true,
    });
  });

  it("rolls the window over once resetAt passes (no storage TTL)", async () => {
    const key = "ip:5.6.7.8";
    expect(await jsonBody(await allow(key, 2, 1))).toEqual({
      allowed: true,
    });
    expect(await jsonBody(await allow(key, 2, 1))).toEqual({
      allowed: true,
    });
    expect(await jsonBody(await allow(key, 2, 1))).toEqual({
      allowed: false,
    });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    expect(await jsonBody(await allow(key, 2, 1))).toEqual({
      allowed: true,
    });
  });

  it("rejects malformed params without counting them", async () => {
    const res = await env.THROTTLE_DO.getByName("otp").fetch(
      "https://otp-throttle/allow?key=x&limit=0&windowSec=60",
    );
    expect(res.status).toBe(400);
    expect(await jsonBody(res)).toEqual({ allowed: false });
  });
});
