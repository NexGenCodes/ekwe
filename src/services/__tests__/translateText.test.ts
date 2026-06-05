import { translateText } from "../translateText";

import { EkweError } from "@/constants/errors";
import { supabase } from "@/services/supabase";
import { authActions } from "@/store/auth";
import * as networkUtils from "@/utils/networkUtils";

jest.mock("@/services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("@/store/auth", () => ({
  authActions: {
    updateBilling: jest.fn(),
  },
}));

jest.mock("@/utils/networkUtils", () => ({
  fetchWithRetry: jest.fn(),
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

describe("translateText", () => {
  const mockUrl = "https://mock.worker.com";

  beforeAll(() => {
    process.env.EXPO_PUBLIC_WORKER_URL = mockUrl;
  });

  afterAll(() => {
    delete process.env.EXPO_PUBLIC_WORKER_URL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (supabase.auth.getSession as jest.Mock).mockResolvedValue({
      data: { session: { access_token: "mock_token" } },
    });
  });

  it("returns EMPTY_TRANSCRIPT if text is empty", async () => {
    const result = await translateText("   ", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.EMPTY_TRANSCRIPT);
    }
  });

  it("returns NETWORK_LOST if worker url is missing", async () => {
    process.env.EXPO_PUBLIC_WORKER_URL = "";
    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
    process.env.EXPO_PUBLIC_WORKER_URL = mockUrl;
  });

  it("returns RATE_LIMITED when response is 429", async () => {
    (networkUtils.fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: false,
      status: 429,
      json: jest.fn().mockResolvedValue({}),
    });

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.RATE_LIMITED);
    }
  });

  it("parses valid response and updates billing", async () => {
    const mockResponse = {
      translation: "hola",
      transliteration: "hola",
      transaction: {
        transactions_used: 1,
        tier_active: "PREMIUM",
        is_fallback: false,
      },
    };

    (networkUtils.fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue(mockResponse),
    });

    const result = await translateText("hello", "en", "es");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.translation).toBe("hola");
      expect(result.value.transliteration).toBe("hola");
    }

    expect(authActions.updateBilling).toHaveBeenCalledWith({
      transactions_used: 1,
      tier_active: "PREMIUM",
      is_fallback: false,
    });
  });

  it("returns TRANSLATION_FAIL if schema validation fails", async () => {
    (networkUtils.fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: true,
      json: jest.fn().mockResolvedValue({ wrong_schema: true }), // Missing 'translation' key
    });

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });

  it("returns TRANSLATION_FAIL if API responds with non-ok and unknown code", async () => {
    (networkUtils.fetchWithRetry as jest.Mock).mockResolvedValue({
      ok: false,
      status: 400,
      json: jest.fn().mockResolvedValue({ error: "UNKNOWN_ERROR" }),
    });

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL); // Fallback
    }
  });

  it("returns NETWORK_LOST on fetch throw", async () => {
    (networkUtils.fetchWithRetry as jest.Mock).mockRejectedValue(
      new Error("Network disconnect"),
    );

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });
});
