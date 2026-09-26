import { beforeEach, describe, expect, test, vi } from "vitest";

const mmkvMock = {
  getString: vi.fn(),
  set: vi.fn(),
};

vi.mock("@/services/mmkv", () => ({
  initializeMMKV: vi.fn(async () => {}),
  mmkv: mmkvMock,
}));

vi.mock("@/store/mmkvPlugin", () => ({ mmkvPlugin: {} }));

vi.mock("@/services/sharedContainer", () => ({
  mirrorSettingsToShared: vi.fn(),
  SharedPreferences: {},
}));

vi.mock("@legendapp/state/sync", () => ({ syncObservable: vi.fn() }));

function lastPersistedSettings(): Record<string, unknown> | undefined {
  const calls = mmkvMock.set.mock.calls;
  const last = calls[calls.length - 1];
  if (!last) return undefined;
  return JSON.parse(last[1] as string);
}

async function loadSettings(stored: unknown): Promise<void> {
  vi.resetModules();
  mmkvMock.getString.mockReturnValue(
    stored === undefined ? null : JSON.stringify(stored),
  );
  mmkvMock.set.mockClear();
  await import("@/store/settings");
  await vi.waitFor(() => expect(mmkvMock.set).toHaveBeenCalled());
}

describe("settings currency migration", () => {
  beforeEach(() => {
    mmkvMock.getString.mockReset();
    mmkvMock.set.mockReset();
  });

  test("normalizes a lowercase stored currency", async () => {
    await loadSettings({ currency: "ngn" });
    expect(lastPersistedSettings()?.currency).toBe("NGN");
  });

  test("trims and uppercases a stored currency", async () => {
    await loadSettings({ currency: " ghs " });
    expect(lastPersistedSettings()?.currency).toBe("GHS");
  });

  test("falls back to NGN for an unsupported currency", async () => {
    await loadSettings({ currency: "BRL" });
    expect(lastPersistedSettings()?.currency).toBe("NGN");
  });

  test("falls back to NGN when no currency was stored", async () => {
    await loadSettings({ themePreference: "dark" });
    expect(lastPersistedSettings()?.currency).toBe("NGN");
  });

  test("falls back to NGN for a non-string currency", async () => {
    await loadSettings({ currency: 978 });
    expect(lastPersistedSettings()?.currency).toBe("NGN");
  });

  test("leaves an already-valid currency untouched", async () => {
    vi.resetModules();
    mmkvMock.getString.mockReturnValue(JSON.stringify({ currency: "USD" }));
    mmkvMock.set.mockClear();
    await import("@/store/settings");
    await Promise.resolve();
    expect(mmkvMock.set).not.toHaveBeenCalled();
  });
});
