import { DEFAULT_PAYMENT_CURRENCY } from "@ekwe/shared/money";
import { PRO_PRODUCT_IDS } from "@ekwe/shared/plans";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { authActions } from "@/store";
import { settingsActions } from "@/store";
import { supabase } from "@/services/supabase";

import {
  getFlutterwavePlanId,
  getFlutterwavePublicKey,
  isFlutterwaveAvailable,
  openFlutterwaveCheckout,
  reconcileFlutterwaveStatus,
  verifyTransaction,
} from "@/services/flutterwave";

const getUserMock = vi.hoisted(() => vi.fn());

vi.mock("@/services/supabase", () => ({
  supabase: { auth: { getUser: getUserMock } },
}));

vi.mock("@/utils/http", () => ({
  getWorkerUrl: vi.fn(() => "https://worker.test"),
}));

import { getWorkerUrl } from "@/utils/http";

function makeSession(): Record<string, unknown> {
  return {
    access_token: "access-token-123",
    user: { id: "user-1", email: "a@b.com", app_metadata: {} },
  };
}

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });

const validCheckout = {
  tx_ref: "flw_tx_1",
  amount: 4900,
  currency: "USD",
  public_key: "pk_live_test",
};

const validVerify = {
  ok: true,
  permanent: true,
  transaction_id: 123456,
  tx_ref: "flw_tx_1",
};

beforeEach(() => {
  authActions.setSession(null);
  authActions.setIsPro(false);
  authActions.setEntitlementSynced(false);
  settingsActions.setCurrency(DEFAULT_PAYMENT_CURRENCY);
  vi.mocked(getWorkerUrl).mockReturnValue("https://worker.test");
  getUserMock.mockReset();
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("getFlutterwavePlanId", () => {
  it("maps the billing toggle to the shared product IDs", () => {
    expect(getFlutterwavePlanId(false)).toBe(PRO_PRODUCT_IDS.monthly);
    expect(getFlutterwavePlanId(true)).toBe(PRO_PRODUCT_IDS.annual);
  });
});

describe("getFlutterwavePublicKey", () => {
  it("defaults to an empty string", () => {
    expect(getFlutterwavePublicKey()).toBe("");
  });

  it("returns the configured publishable key", () => {
    vi.stubEnv("EXPO_PUBLIC_FLUTTERWAVE_PUBLIC_KEY", "pk_live_pubkey");
    expect(getFlutterwavePublicKey()).toBe("pk_live_pubkey");
    vi.unstubAllEnvs();
  });
});

describe("isFlutterwaveAvailable", () => {
  it("is false without a session", () => {
    expect(isFlutterwaveAvailable()).toBe(false);
  });

  it("is true with a session", () => {
    authActions.setSession(makeSession() as never);
    expect(isFlutterwaveAvailable()).toBe(true);
  });
});

describe("openFlutterwaveCheckout", () => {
  it("fails with a user-safe message when signed out", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(openFlutterwaveCheckout(false)).rejects.toThrow(
      "Payment could not be started. Please check your connection.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("fails when the worker URL is not configured", async () => {
    authActions.setSession(makeSession() as never);
    vi.mocked(getWorkerUrl).mockReturnValue("");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await expect(openFlutterwaveCheckout(false)).rejects.toThrow(
      "Payment could not be started. Please check your connection.",
    );
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("authorizes a monthly checkout with the NGN default", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(validCheckout));

    const result = await openFlutterwaveCheckout(false);
    expect(result).toEqual({ canceled: false, session: validCheckout });

    expect(fetchSpy).toHaveBeenCalledWith(
      "https://worker.test/billing/checkout",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token-123",
        },
        body: JSON.stringify({
          plan: PRO_PRODUCT_IDS.monthly,
          currency: DEFAULT_PAYMENT_CURRENCY,
        }),
      },
    );
  });

  it("sends the manual currency selection", async () => {
    authActions.setSession(makeSession() as never);
    settingsActions.setCurrency("NGN");
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(validCheckout));

    await openFlutterwaveCheckout(false);
    const init = vi.mocked(fetch).mock.calls.at(-1)![1] as RequestInit;
    expect(JSON.parse(init.body as string)).toEqual({
      plan: PRO_PRODUCT_IDS.monthly,
      currency: "NGN",
    });
    fetchSpy.mockRestore();
  });

  it("requests the annual plan when toggled", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(validCheckout));

    await openFlutterwaveCheckout(true);
    const init = vi.mocked(fetch).mock.calls.at(-1)![1] as RequestInit;
    expect(JSON.parse(init.body as string).plan).toBe(PRO_PRODUCT_IDS.annual);
    fetchSpy.mockRestore();
  });

  it("wraps a non-ok checkout response", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("rate limited", { status: 429 }));

    await expect(openFlutterwaveCheckout(false)).rejects.toThrow(
      "Payment could not be started. Please check your connection.",
    );
    fetchSpy.mockRestore();
  });

  it("wraps a checkout response that fails the shared schema", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ tx_ref: "missing-fields" }));

    await expect(openFlutterwaveCheckout(false)).rejects.toThrow(
      "Payment could not be started. Please check your connection.",
    );
    fetchSpy.mockRestore();
  });
});

describe("verifyTransaction", () => {
  it("rejects when signed out", async () => {
    await expect(verifyTransaction(123)).rejects.toThrow(
      "Authentication required",
    );
  });

  it("verifies a transaction with the worker", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse(validVerify));

    await expect(verifyTransaction(123456)).resolves.toEqual(validVerify);
    expect(fetchSpy).toHaveBeenCalledWith(
      "https://worker.test/billing/verify-transaction",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer access-token-123",
        },
        body: JSON.stringify({ transaction_id: 123456 }),
      },
    );
  });

  it("fails on a non-ok verify response", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response("nope", { status: 500 }));

    await expect(verifyTransaction(123456)).rejects.toThrow(
      "Failed to verify payment",
    );
    fetchSpy.mockRestore();
  });

  it("fails on a malformed verify response", async () => {
    authActions.setSession(makeSession() as never);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(jsonResponse({ ok: false }));

    await expect(verifyTransaction(123456)).rejects.toThrow(
      "Failed to verify payment",
    );
    fetchSpy.mockRestore();
  });
});

describe("reconcileFlutterwaveStatus", () => {
  it("returns true when a refreshed session reports is_pro", async () => {
    getUserMock.mockResolvedValueOnce({
      data: { user: { app_metadata: { is_pro: true } } },
      error: null,
    });
    await expect(reconcileFlutterwaveStatus()).resolves.toBe(true);
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
  });

  it("polls POLL_ATTEMPTS times and gives up when still free", async () => {
    vi.useFakeTimers();
    getUserMock.mockResolvedValue({
      data: { user: { app_metadata: { is_pro: false } } },
      error: null,
    });

    const promise = reconcileFlutterwaveStatus();
    await vi.advanceTimersByTimeAsync(2_500 * 20);
    await expect(promise).resolves.toBe(false);
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(20);
  });

  it("throws when the refresh reports an error", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error("refresh failed"),
    });

    await expect(reconcileFlutterwaveStatus()).rejects.toThrow(
      "refresh failed",
    );
    expect(supabase.auth.getUser).toHaveBeenCalledTimes(1);
  });
});
