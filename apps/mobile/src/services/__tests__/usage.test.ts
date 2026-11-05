import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/services/backend", () => {
  class ApiError extends Error {
    readonly status: number;
    readonly code: string;

    constructor(status: number, code: string, message?: string) {
      super(message ?? code);
      this.name = "ApiError";
      this.status = status;
      this.code = code;
    }
  }

  return {
    ApiError,
    apiJson: vi.fn(),
    isApiError: vi.fn((err: unknown) => err instanceof ApiError),
  };
});

import { apiJson, ApiError } from "@/services/backend";
import { fetchUsage } from "@/services/usage";

const validSnapshot = {
  day: "2026-09-17",
  resetsAt: 1729200000000,
  month: "2026-09",
  monthResetsAt: 1729200000000,
  meters: [
    {
      id: "translate",
      label: "Translation",
      unit: "requests",
      used: 1,
      total: 600,
      remaining: 599,
    },
    {
      id: "transcribe",
      label: "Transcription",
      unit: "min",
      used: 0,
      total: 60,
      remaining: 60,
    },
    {
      id: "speech",
      label: "Speech",
      unit: "chars",
      used: 2,
      total: 60_000,
      remaining: 59_998,
    },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("fetchUsage", () => {
  it("fetches and validates the snapshot", async () => {
    vi.mocked(apiJson).mockResolvedValue(validSnapshot as never);

    const result = await fetchUsage();

    expect(result).toEqual({ ok: true, value: validSnapshot });
    expect(apiJson).toHaveBeenCalledWith(
      "/usage",
      expect.objectContaining({ retries: 1 }),
    );
  });

  it("surfaces a non-ok server response", async () => {
    vi.mocked(apiJson).mockRejectedValue(new ApiError(500, "internal", "boom"));

    const result = await fetchUsage();

    expect(result).toEqual({ ok: false, error: "Server returned 500" });
  });

  it("rejects a payload that fails the shared schema", async () => {
    vi.mocked(apiJson).mockResolvedValue({ day: "nope" } as never);

    const result = await fetchUsage();

    expect(result).toEqual({ ok: false, error: "Invalid usage payload" });
  });

  it("reports a timeout", async () => {
    const error = new Error("timed out");
    error.name = "TimeoutError";
    vi.mocked(apiJson).mockRejectedValue(error);

    const result = await fetchUsage();

    expect(result).toEqual({ ok: false, error: "Timed out" });
  });

  it("reports a generic network error", async () => {
    vi.mocked(apiJson).mockRejectedValue(new Error("socket hang up"));

    const result = await fetchUsage();

    expect(result).toEqual({ ok: false, error: "Network error" });
  });

  it("coerces a non-Error rejection", async () => {
    vi.mocked(apiJson).mockRejectedValue("down");

    const result = await fetchUsage();

    expect(result).toEqual({ ok: false, error: "Network error" });
  });
});
