import { describe, test, expect, vi, beforeEach } from "vitest";
import { authenticate } from "../../src/core/auth";
import { mockEnv } from "../setup";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

import { jwtVerify } from "jose";

describe("authenticate()", () => {
  const env = mockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns AuthResult with FREE tier for non-pro user", async () => {
    (jwtVerify as any).mockResolvedValue({
      payload: {
        sub: "user-123",
        email: "user@example.com",
        app_metadata: { is_pro: false },
      },
    });

    const result = await authenticate("valid-token", env);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-123");
    expect(result!.userEmail).toBe("user@example.com");
    expect(result!.tier).toBe("FREE");
  });

  test("returns AuthResult with PREMIUM tier for pro user", async () => {
    (jwtVerify as any).mockResolvedValue({
      payload: {
        sub: "user-456",
        email: "pro@example.com",
        app_metadata: { is_pro: true },
      },
    });

    const result = await authenticate("pro-token", env);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("PREMIUM");
  });

  test("returns null when payload has no sub claim", async () => {
    (jwtVerify as any).mockResolvedValue({
      payload: { email: "no-sub@example.com" },
    });

    const result = await authenticate("no-sub-token", env);
    expect(result).toBeNull();
  });

  test("returns null when jwtVerify throws (invalid/expired token)", async () => {
    (jwtVerify as any).mockRejectedValue(new Error("jwt malformed"));

    const result = await authenticate("bad-token", env);
    expect(result).toBeNull();
  });

  test("retries with fresh JWKS on first failure and succeeds", async () => {
    (jwtVerify as any)
      .mockRejectedValueOnce(new Error("key not found"))
      .mockResolvedValueOnce({
        payload: {
          sub: "user-789",
          email: "retry@example.com",
          app_metadata: { is_pro: false },
        },
      });

    const result = await authenticate("retry-token", env);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-789");
    expect(jwtVerify).toHaveBeenCalledTimes(2);
  });

  test("returns null when both first attempt and retry fail", async () => {
    (jwtVerify as any)
      .mockRejectedValueOnce(new Error("first fail"))
      .mockRejectedValueOnce(new Error("retry fail"));

    const result = await authenticate("double-fail-token", env);
    expect(result).toBeNull();
    expect(jwtVerify).toHaveBeenCalledTimes(2);
  });

  test("handles missing email gracefully as empty string", async () => {
    (jwtVerify as any).mockResolvedValue({
      payload: {
        sub: "user-no-email",
        app_metadata: { is_pro: false },
      },
    });

    const result = await authenticate("no-email-token", env);
    expect(result).not.toBeNull();
    expect(result!.userEmail).toBe("");
  });

  test("jwtVerify called with correct issuer and audience", async () => {
    (jwtVerify as any).mockResolvedValue({
      payload: {
        sub: "user-999",
        email: "check@example.com",
        app_metadata: { is_pro: false },
      },
    });

    await authenticate("check-token", env);

    expect(jwtVerify).toHaveBeenCalledWith(
      "check-token",
      expect.any(Function),
      {
        issuer: "https://mock.supabase.co/auth/v1",
        audience: "authenticated",
      },
    );
  });
});
