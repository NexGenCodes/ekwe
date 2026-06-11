import { http, HttpResponse } from "msw";

import { translateText } from "../translateText";

import { EkweError } from "@/constants/errors";
import { server } from "@/mocks/server";
import { supabase } from "@/services/supabase";
import { authActions } from "@/store";

jest.mock("@/services/supabase", () => ({
  supabase: {
    auth: {
      getSession: jest.fn(),
    },
  },
}));

jest.mock("@/utils/logger", () => ({
  __esModule: true,
  default: {
    error: jest.fn(),
  },
}));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const WORKER_URL = "http://localhost:8787";

describe("translateText", () => {
  beforeAll(() => {
    process.env.EXPO_PUBLIC_WORKER_URL = WORKER_URL;
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
    process.env.EXPO_PUBLIC_WORKER_URL = WORKER_URL;
  });

  it("returns RATE_LIMITED when response is 429", async () => {
    server.use(
      http.post(`${WORKER_URL}/translate`, () => {
        return new HttpResponse(null, { status: 429 });
      }),
    );

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.RATE_LIMITED);
    }
  });

  it("parses valid response and updates billing", async () => {
    server.use(
      http.post(`${WORKER_URL}/translate`, () => {
        return HttpResponse.json({
          translation: "hola",
          transliteration: "hola",
          transaction: {
            transactions_used: 1,
            tier_active: "PREMIUM",
            is_fallback: false,
          },
        });
      }),
    );

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
    server.use(
      http.post(`${WORKER_URL}/translate`, () => {
        return HttpResponse.json({ wrong_schema: true });
      }),
    );

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });

  it("returns TRANSLATION_FAIL if API responds with non-ok and unknown code", async () => {
    server.use(
      http.post(`${WORKER_URL}/translate`, () => {
        return HttpResponse.json({ error: "UNKNOWN_ERROR" }, { status: 400 });
      }),
    );

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSLATION_FAIL);
    }
  });

  it("returns NETWORK_LOST on fetch error", async () => {
    server.use(
      http.post(`${WORKER_URL}/translate`, () => {
        return HttpResponse.error();
      }),
    );

    const result = await translateText("hello", "en", "es");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });
});
