import { beforeEach, describe, expect, test, vi } from "vitest";
import type { Env } from "@/core/types";
import { consumeOtp, sendOtp } from "@/auth/otp";
import { OTP_EXPIRY_SECONDS, OTP_MAX_ATTEMPTS } from "@ekwe/shared";
import {
  createTestDatabase,
  type TestDatabase,
} from "@/__tests__/helpers/sqlite-d1";

const { sendOtpEmail } = vi.hoisted(() => ({
  sendOtpEmail: vi.fn(async () => true),
}));

vi.mock("@/services/email", () => ({ sendOtpEmail }));

function makeEnv(database: TestDatabase): Env {
  return {
    DB: database.d1,
    OTP_PEPPER: "test-pepper",
  } as unknown as Env;
}

function lastCode(): string {
  const calls = sendOtpEmail.mock.calls;
  const args = calls[calls.length - 1] as unknown as [Env, string, string];
  return args[2];
}

describe("otp", () => {
  let database: TestDatabase;
  let env: Env;

  beforeEach(() => {
    database = createTestDatabase();
    env = makeEnv(database);
    sendOtpEmail.mockClear();
  });

  test("stores only a hash of the code", async () => {
    const result = await sendOtp(env, "person@test.dev");
    expect(result.ok).toBe(true);

    const code = lastCode();
    const row = database.sqlite
      .prepare(`SELECT code_hash FROM otp_codes WHERE email_norm = ?`)
      .get("person@test.dev") as { code_hash: string };

    expect(code).toMatch(/^\d{6}$/);
    expect(row.code_hash).not.toContain(code);
    expect(row.code_hash).toHaveLength(64);
  });

  test("enforces the resend cooldown", async () => {
    await sendOtp(env, "person@test.dev");
    const second = await sendOtp(env, "person@test.dev");

    expect(second).toMatchObject({ ok: false, reason: "cooldown" });
    if (second.ok || second.reason !== "cooldown") return;
    expect(second.retryAfter).toBeGreaterThan(0);
    expect(sendOtpEmail).toHaveBeenCalledTimes(1);
  });

  test("reuses the cooldown after it lapses", async () => {
    await sendOtp(env, "person@test.dev");
    database.sqlite
      .prepare(`UPDATE otp_codes SET last_sent_at = ? WHERE email_norm = ?`)
      .run(Date.now() - 61_000, "person@test.dev");

    const second = await sendOtp(env, "person@test.dev");
    expect(second.ok).toBe(true);
    expect(sendOtpEmail).toHaveBeenCalledTimes(2);
  });

  test("accepts the correct code once", async () => {
    await sendOtp(env, "person@test.dev");
    const code = lastCode();

    expect(await consumeOtp(env, "person@test.dev", code)).toEqual({
      ok: true,
    });

    const row = database.sqlite
      .prepare(`SELECT 1 FROM otp_codes WHERE email_norm = ?`)
      .get("person@test.dev");
    expect(row).toBeUndefined();

    expect(await consumeOtp(env, "person@test.dev", code)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  test("counts wrong attempts and locks the code", async () => {
    await sendOtp(env, "person@test.dev");
    const code = lastCode();
    const wrong = code === "000000" ? "111111" : "000000";

    for (let attempt = 0; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
      expect(await consumeOtp(env, "person@test.dev", wrong)).toEqual({
        ok: false,
        reason: "invalid",
      });
    }

    expect(await consumeOtp(env, "person@test.dev", code)).toEqual({
      ok: false,
      reason: "locked",
    });
  });

  test("expires and deletes stale codes", async () => {
    await sendOtp(env, "person@test.dev");
    const code = lastCode();

    database.sqlite
      .prepare(`UPDATE otp_codes SET expires_at = ? WHERE email_norm = ?`)
      .run(Date.now() - OTP_EXPIRY_SECONDS * 1000, "person@test.dev");

    expect(await consumeOtp(env, "person@test.dev", code)).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  test("does not leave a usable code when the email fails", async () => {
    sendOtpEmail.mockResolvedValueOnce(false);

    const result = await sendOtp(env, "person@test.dev");
    expect(result).toMatchObject({ ok: false, reason: "email_failed" });

    const row = database.sqlite
      .prepare(`SELECT 1 FROM otp_codes WHERE email_norm = ?`)
      .get("person@test.dev");
    expect(row).toBeUndefined();
  });
});
