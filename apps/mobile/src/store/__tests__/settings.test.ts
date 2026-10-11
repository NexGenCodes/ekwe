import { beforeEach, describe, expect, test, vi } from "vitest";

import { registerTableTransform } from "@/store/mmkvPlugin";

const mmkvMock = {
  getString: vi.fn(),
  set: vi.fn(),
};

vi.mock("@/services/mmkv", () => ({
  initializeMMKV: vi.fn(async () => {}),
  mmkv: mmkvMock,
}));

vi.mock("@/store/mmkvPlugin", () => ({
  mmkvPlugin: {},
  registerTableTransform: vi.fn(),
}));

vi.mock("@/services/sharedContainer", () => ({
  mirrorSettingsToShared: vi.fn(),
  SharedPreferences: {},
}));

vi.mock("@legendapp/state/sync", () => ({ syncObservable: vi.fn() }));

type TableTransform = (
  data: Record<string, unknown>,
) => Record<string, unknown>;

async function loadMigration(): Promise<TableTransform> {
  vi.resetModules();
  await import("@/store/settings");
  const call = vi
    .mocked(registerTableTransform)
    .mock.calls.find(([table]) => table === "ekwe-settings");
  if (!call) throw new Error("settings never registered its migration");
  return call[1] as TableTransform;
}

describe("settings currency migration", () => {
  beforeEach(() => {
    vi.mocked(registerTableTransform).mockClear();
  });

  test("normalizes a lowercase stored currency", async () => {
    const migrate = await loadMigration();
    expect(migrate({ currency: "ngn" }).currency).toBe("NGN");
  });

  test("trims and uppercases a stored currency", async () => {
    const migrate = await loadMigration();
    expect(migrate({ currency: " ghs " }).currency).toBe("GHS");
  });

  test("falls back to NGN for an unsupported currency", async () => {
    const migrate = await loadMigration();
    expect(migrate({ currency: "BRL" }).currency).toBe("NGN");
  });

  test("falls back to NGN when no currency was stored", async () => {
    const migrate = await loadMigration();
    expect(migrate({ themePreference: "dark" }).currency).toBe("NGN");
  });

  test("falls back to NGN for a non-string currency", async () => {
    const migrate = await loadMigration();
    expect(migrate({ currency: 978 }).currency).toBe("NGN");
  });

  test("leaves an already-valid currency untouched", async () => {
    const migrate = await loadMigration();
    expect(migrate({ currency: "USD" }).currency).toBe("USD");
  });

  test("renames the retired ttsVoice field", async () => {
    const migrate = await loadMigration();
    const migrated = migrate({ ttsVoice: "female" });
    expect(migrated.voiceGender).toBe("female");
    expect("ttsVoice" in migrated).toBe(false);
  });

  test("maps the retired neutral voice to default", async () => {
    const migrate = await loadMigration();
    expect(migrate({ voiceGender: "neutral" }).voiceGender).toBe("default");
  });
});
