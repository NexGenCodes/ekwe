import { describe, test, expect, vi, beforeEach } from "vitest";
import { authenticate } from "@/core/auth";
import { mockEnv } from "@/__tests__/setup";

vi.mock("jose", () => ({
  jwtVerify: vi.fn(),
  createRemoteJWKSet: vi.fn(() => vi.fn()),
}));

function mockJwt(payload: Record<string, unknown>): void {
  vi.mocked(jwtVerify).mockResolvedValue({
    payload,
    protectedHeader: { alg: "HS256" },
  });
}

import { jwtVerify } from "jose";

describe("authenticate()", () => {
  const env = mockEnv();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("returns AuthResult with FREE tier for non-pro user", async () => {
    mockJwt({
      sub: "user-123",
      email: "user@example.com",
      app_metadata: { is_pro: false },
    });

    const result = await authenticate("valid-token", env);
    expect(result).not.toBeNull();
    expect(result!.userId).toBe("user-123");
    expect(result!.userEmail).toBe("user@example.com");
    expect(result!.tier).toBe("FREE");
  });

  test("returns AuthResult with PREMIUM tier for pro user", async () => {
    mockJwt({
      sub: "user-456",
      email: "pro@example.com",
      app_metadata: { is_pro: true },
    });

    const result = await authenticate("pro-token", env);
    expect(result).not.toBeNull();
    expect(result!.tier).toBe("PREMIUM");
  });

  test("returns null when payload has no sub claim", async () => {
    mockJwt({ email: "no-sub@example.com" });

    const result = await authenticate("no-sub-token", env);
    expect(result).toBeNull();
  });

  test("returns null when jwtVerify throws (invalid/expired token)", async () => {
    vi.mocked(jwtVerify).mockRejectedValue(new Error("jwt malformed"));

    const result = await authenticate("bad-token", env);
    expect(result).toBeNull();
  });

  test("handles missing email gracefully as empty string", async () => {
    mockJwt({
      sub: "user-no-email",
      app_metadata: { is_pro: false },
    });

    const result = await authenticate("no-email-token", env);
    expect(result).not.toBeNull();
    expect(result!.userEmail).toBe("");
  });

  test("jwtVerify called with correct issuer and audience", async () => {
    mockJwt({
      sub: "user-999",
      email: "check@example.com",
      app_metadata: { is_pro: false },
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
