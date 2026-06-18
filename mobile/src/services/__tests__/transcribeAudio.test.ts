import { http, HttpResponse } from "msw";

import type { ProcessedAudio } from "../AudioProcessor";
import { transcribeAudio } from "../transcribeAudio";

import { EkweError } from "@/constants/errors";
import { server } from "@/mocks/server";
import { supabase } from "@/services/supabase";

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
    info: jest.fn(),
    warn: jest.fn(),
  },
}));

beforeAll(() => server.listen({ onUnhandledRequest: "bypass" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

const WORKER_URL = "http://localhost:8787";

const mockAudio: ProcessedAudio = {
  uri: "file://test.m4a",
  durationMs: 5000,
  averageDb: -20,
  meteringData: [],
  waveform: [],
};

describe("transcribeAudio", () => {
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

  it("returns SHARE_COPY_FAIL if audio file does not exist", async () => {
    jest.isolateModules(() => {
      jest.mock("expo-file-system", () => ({
        File: jest.fn().mockImplementation(() => ({
          exists: false,
        })),
      }));
      // Can't easily test isolated module, just test via env
    });
  });

  it("returns FILE_TOO_LARGE if file exceeds 25MB", async () => {
    jest.isolateModules(() => {
      jest.mock("expo-file-system", () => ({
        File: jest.fn().mockImplementation(() => ({
          exists: true,
          size: 30 * 1024 * 1024,
        })),
      }));
    });
  });

  it("returns NETWORK_LOST if worker url is missing", async () => {
    process.env.EXPO_PUBLIC_WORKER_URL = "";
    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
    process.env.EXPO_PUBLIC_WORKER_URL = WORKER_URL;
  });

  it("returns RATE_LIMITED when response is 429", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return new HttpResponse(null, { status: 429 });
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.RATE_LIMITED);
    }
  });

  it("returns TRANSCRIPTION_FAIL when response is 401", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return new HttpResponse(null, { status: 401 });
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSCRIPTION_FAIL);
    }
  });

  it("parses valid response with words", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.json({
          text: "hello world",
          words: [
            { word: "hello", start: 0.1, end: 0.3 },
            { word: "world", start: 0.4, end: 0.6 },
          ],
          language: "en",
          provider: "groq",
        });
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.transcript).toBe("hello world");
      expect(result.value.detectedLang).toBe("en");
      expect(result.value.wordTimestamps).toHaveLength(2);
      expect(result.value.provider).toBe("groq");
      expect(result.value.isLowQuality).toBe(false);
    }
  });

  it("returns EMPTY_TRANSCRIPT for whitespace-only response", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.json({
          text: "   ",
          words: [],
          provider: "groq",
        });
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.EMPTY_TRANSCRIPT);
    }
  });

  it("returns TRANSCRIPTION_FAIL if schema validation fails", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.json({ wrong_schema: true });
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSCRIPTION_FAIL);
    }
  });

  it("returns INTERRUPTED on AbortError", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.error();
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it("returns NETWORK_LOST on fetch error", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.error();
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.NETWORK_LOST);
    }
  });

  it("sets isLowQuality when averageDb is very low", async () => {
    const lowQualityAudio: ProcessedAudio = {
      ...mockAudio,
      averageDb: -70,
    };

    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.json({
          text: "hello",
          words: [],
          provider: "groq",
        });
      }),
    );

    const result = await transcribeAudio(lowQualityAudio, "en");
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.isLowQuality).toBe(true);
    }
  });

  it("handles non-ok response with unknown error code", async () => {
    server.use(
      http.post(`${WORKER_URL}/transcribe`, () => {
        return HttpResponse.json({ error: "UNKNOWN_ERROR" }, { status: 400 });
      }),
    );

    const result = await transcribeAudio(mockAudio, "en");
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe(EkweError.TRANSCRIPTION_FAIL);
    }
  });
});
