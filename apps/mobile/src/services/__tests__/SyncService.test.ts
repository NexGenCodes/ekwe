import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { observable } from "@legendapp/state";
import { SyncService } from "@/services/syncService";
import { buildUpsertOutboxPayload } from "@/services/outboxPayload";
import { Db } from "@/services/db";
import { supabase } from "@/services/supabase";

vi.mock("@/store", () => ({
  history$: observable([]),
  auth$: observable({
    session: { access_token: "test-token", user: { id: "test-user" } },
    user: { id: "test-user" },
  }),
}));

vi.mock("@/store/resetUserScoped", () => ({
  resetUserScopedState: vi.fn(),
}));

vi.mock("../db", () => ({
  Db: {
    cleanupExpiredHistory: vi.fn(() => 0),
    reviveInFlight: vi.fn(() => 0),
    reviveDeadOutbox: vi.fn(() => 0),
    countDeadOutbox: vi.fn(() => 0),
    getRecentHistory: vi.fn(() => []),
    transaction: vi.fn((fn) => fn()),
    insertHistory: vi.fn(),
    insertOutbox: vi.fn(),
    findByCaptureId: vi.fn(() => null),
    updateCaptureRow: vi.fn(),
    setHistoryRevision: vi.fn(),
    getHistoryRevision: vi.fn(() => null),
    getPendingOutbox: vi.fn(() => []),
    getUnacknowledgedOutbox: vi.fn(() => []),
    hasPendingOutboxRow: vi.fn(() => false),
    deleteHistory: vi.fn(),
    deleteOutboxForHistory: vi.fn(),
    markOutboxInFlight: vi.fn(),
    deleteOutbox: vi.fn(),
    incrementOutboxRetry: vi.fn(),
  },
}));

vi.mock("@/utils/connectivity", () => ({
  checkIsOnline: vi.fn(() => Promise.resolve(true)),
  isDefinitelyOffline: vi.fn(() => false),
  subscribeToNetwork: vi.fn(() => vi.fn()),
}));

vi.mock("expo-crypto", () => ({
  randomUUID: vi.fn(() => "mock-uuid"),
}));

vi.mock("../mmkv", () => ({
  mmkv: {
    getString: vi.fn(),
    set: vi.fn(),
    remove: vi.fn(),
    getAllKeys: vi.fn(() => [] as string[]),
  },
}));

vi.mock("../supabase", () => ({
  supabase: {
    from: vi.fn(),
    rpc: vi.fn(),
    channel: vi.fn(),
    removeChannel: vi.fn(),
    auth: {
      getSession: vi.fn(async () => ({
        data: { session: { access_token: "test-jwt" } },
      })),
    },
    realtime: {
      setAuth: vi.fn(async () => {}),
    },
  },
}));

describe("syncService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should initialize on start", async () => {
    await SyncService.start();
    expect(Db.cleanupExpiredHistory).toHaveBeenCalled();
    expect(Db.reviveInFlight).toHaveBeenCalled();
    expect(Db.countDeadOutbox).toHaveBeenCalled();
    expect(Db.getRecentHistory).toHaveBeenCalled();
  });

  it("should write history and schedule drain", async () => {
    const id = await SyncService.writeHistory(
      {
        captureId: "cap-1",
        origin: "echo",
        input: "audio",
        sourceLang: "en",
        targetLang: "es",
        transcript: "hello",
        translation: "hola",
        transliteration: null,
        duration: 1.5,
        sourceApp: "com.whatsapp",
        voiceId: null,
        sttProvider: "deepgram",
        mtProvider: "gemini",
        type: "transcription",
      },
      "user123",
    );

    expect(typeof id).toBe("string");
    expect(Db.transaction).toHaveBeenCalled();
    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        captureId: "cap-1",
        origin: "echo",
        input: "audio",
        sttProvider: "deepgram",
        mtProvider: "gemini",
      }),
    );
    expect(Db.insertOutbox).toHaveBeenCalled();
  });

  it("updates the existing row when the capture is written twice", async () => {
    // The regression this replaces: a transcription row and a translation row
    // for the same note could never dedup against each other, because the
    // lookup keyed on entry_type and the two rows had different values. Every
    // translated note left an orphan row behind.
    vi.mocked(Db.findByCaptureId).mockReturnValue({
      id: "existing-1",
      createdAt: "2026-09-01T10:00:00.000Z",
    } as never);

    const id = await SyncService.writeHistory(
      {
        captureId: "cap-1",
        origin: "echo",
        input: "audio",
        sourceLang: "en",
        targetLang: "es",
        transcript: "hello",
        translation: "hola",
        transliteration: null,
        duration: 1.5,
        sourceApp: "com.whatsapp",
        voiceId: null,
        sttProvider: "deepgram",
        mtProvider: "gemini",
        type: "translation",
      },
      "user123",
    );

    expect(id).toBe("existing-1");
    expect(Db.insertHistory).not.toHaveBeenCalled();
    expect(Db.updateCaptureRow).toHaveBeenCalledWith(
      "existing-1",
      expect.objectContaining({
        translation_text: "hola",
        mt_provider: "gemini",
      }),
    );
  });

  it("never matches a legacy row when the capture id is missing", async () => {
    // Legacy rows all share a NULL capture_id, so a lookup without one must
    // miss rather than collapse them into each other.
    await SyncService.writeHistory(
      {
        captureId: "",
        origin: "echo",
        input: "audio",
        sourceLang: "en",
        targetLang: "es",
        transcript: "hello",
        translation: null,
        transliteration: null,
        duration: 1.5,
        sourceApp: null,
        voiceId: null,
        sttProvider: "deepgram",
        mtProvider: null,
        type: "transcription",
      },
      "user123",
    );
    expect(Db.findByCaptureId).not.toHaveBeenCalled();
  });

  it("should retry dead outbox", async () => {
    await SyncService.retryDeadOutbox();
    expect(Db.reviveDeadOutbox).toHaveBeenCalled();
  });

  it("serializes concurrent drains instead of dropping the second call", async () => {
    const { supabase } = await import("../supabase");
    let active = 0;
    let maxActive = 0;

    // The batch push goes through the conflict-aware RPC now, so that is what
    // the drain serialises on.
    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        return new Promise((resolve) =>
          setTimeout(() => {
            active -= 1;
            resolve({
              error: null,
              data: [
                {
                  id: "entry-1",
                  outcome: "applied",
                  revision: 1,
                  server_row: null,
                },
              ],
            });
          }, 5),
        );
      },
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: buildUpsertOutboxPayload(
          "translation",
          {
            sourceLang: "en",
            targetLang: "es",
            transcript: "hello",
            translation: "hola",
            transliteration: null,
            duration: 1,
            sourceApp: "test",
            voiceId: null,
            sttProvider: "deepgram",
            mtProvider: "gemini",
            origin: "echo",
            input: "audio",
          },
          "2026-09-01T10:00:00.000Z",
          "cap-1",
        ),
      },
    ] as never);

    await Promise.all([SyncService.drain(), SyncService.drain()]);

    expect(maxActive).toBe(1);
    expect(Db.deleteOutbox).toHaveBeenCalledTimes(2);
  });

  it("reverts in-flight rows when the batch push fails", async () => {
    const { supabase } = await import("../supabase");

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () => Promise.resolve({ error: { message: "boom" } }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: buildUpsertOutboxPayload(
          "translation",
          {
            sourceLang: "en",
            targetLang: "es",
            transcript: "hello",
            translation: "hola",
            transliteration: null,
            duration: 1,
            sourceApp: "test",
            voiceId: null,
            sttProvider: "deepgram",
            mtProvider: "gemini",
            origin: "echo",
            input: "audio",
          },
          "2026-09-01T10:00:00.000Z",
          "cap-1",
        ),
      },
    ] as never);

    await SyncService.drain();

    expect(Db.incrementOutboxRetry).toHaveBeenCalledWith("entry-1");
    expect(Db.deleteOutbox).not.toHaveBeenCalled();
  });

  it("pushes through the conflict-aware RPC rather than a plain upsert", async () => {
    const { supabase } = await import("../supabase");

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [
            {
              id: "entry-1",
              outcome: "applied",
              revision: 4,
              server_row: null,
            },
          ],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: buildUpsertOutboxPayload(
          "translation",
          {
            sourceLang: "en",
            targetLang: "es",
            transcript: "hello",
            translation: "hola",
            transliteration: null,
            duration: 1,
            sourceApp: "test",
            voiceId: null,
            sttProvider: "deepgram",
            mtProvider: "gemini",
            origin: "echo",
            input: "audio",
          },
          "2026-09-01T10:00:00.000Z",
          "cap-1",
          3,
        ),
      },
    ] as never);

    await SyncService.drain();

    // The plain upsert path is what allowed a stale device to win.
    expect(supabase.from).not.toHaveBeenCalled();
    expect(supabase.rpc).toHaveBeenCalledWith("history_upsert_if_fresh", {
      p_rows: [expect.objectContaining({ id: "entry-1", base_revision: 3 })],
    });
    // The new revision is recorded so the next edit bases itself on it.
    expect(Db.setHistoryRevision).toHaveBeenCalledWith("entry-1", 4);
    expect(Db.deleteOutbox).toHaveBeenCalledWith("entry-1");
  });

  it("sends a null base_revision for a payload from an older app version", async () => {
    const { supabase } = await import("../supabase");

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [
            {
              id: "entry-1",
              outcome: "applied",
              revision: 1,
              server_row: null,
            },
          ],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        // No base_revision, as a payload enqueued before this change would be.
        payload: JSON.stringify({
          action: "upsert",
          type: "translation",
          capture_id: "cap-1",
          origin: "echo",
          input: "audio",
          source_lang: "en",
          target_lang: "es",
          transcript: "hello",
          translation_text: "hola",
          transliteration_text: null,
          duration: 1,
          source_app: "test",
          voice_id: null,
          stt_provider: "deepgram",
          mt_provider: "gemini",
          created_at: "2026-09-01T10:00:00.000Z",
        }),
      },
    ] as never);

    await SyncService.drain();

    expect(supabase.rpc).toHaveBeenCalledWith("history_upsert_if_fresh", {
      p_rows: [expect.objectContaining({ base_revision: null })],
    });
  });

  it("adopts the server row and drops the entry when a write is refused as stale", async () => {
    const { supabase } = await import("../supabase");

    const serverRow = {
      id: "entry-1",
      user_id: "test-user",
      capture_id: "cap-1",
      origin: "echo",
      input: "audio",
      source_lang: "en",
      target_lang: "es",
      transcript: "hello",
      // The newer translation this device's stale copy would have wiped.
      translation_text: "hola",
      transliteration_text: null,
      duration: 1,
      source_app: "test",
      voice_id: null,
      stt_provider: "deepgram",
      mt_provider: "gemini",
      created_at: "2026-09-01T10:00:00.000Z",
      type: "translation",
      revision: 5,
    };

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [
            {
              id: "entry-1",
              outcome: "conflict",
              revision: 5,
              server_row: serverRow,
            },
          ],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: buildUpsertOutboxPayload(
          "transcription",
          {
            sourceLang: "en",
            targetLang: "es",
            transcript: "hello",
            // The stale copy: no translation, which is what would have erased
            // the other device's work under a plain upsert.
            translation: null,
            transliteration: null,
            duration: 1,
            sourceApp: "test",
            voiceId: null,
            sttProvider: "deepgram",
            mtProvider: null,
            origin: "echo",
            input: "audio",
          },
          "2026-09-01T10:00:00.000Z",
          "cap-1",
          2,
        ),
      },
    ] as never);

    await SyncService.drain();

    // The server's row wins locally, and the entry is no longer ours to push.
    expect(Db.insertHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "entry-1",
        translationText: "hola",
        revision: 5,
      }),
    );
    expect(Db.setHistoryRevision).not.toHaveBeenCalled();
    expect(Db.deleteOutbox).toHaveBeenCalledWith("entry-1");
  });

  it("deletes through the tombstoning RPC rather than a hard delete", async () => {
    const { supabase } = await import("../supabase");

    // The revision this device last saw. Sending it lets the server refuse a
    // delete aimed at a row another device has since changed.
    vi.mocked(Db.getHistoryRevision).mockReturnValue(3);
    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [{ id: "row-1", outcome: "deleted", revision: 4 }],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "outbox-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        // Enqueued under a random UUID, which is why the drain has to read the
        // target out of the payload.
        payload: JSON.stringify({
          action: "delete",
          id: "row-1",
          base_revision: 3,
        }),
      },
    ] as never);

    await SyncService.drain();

    expect(supabase.rpc).toHaveBeenCalledWith("history_delete_if_fresh", {
      p_rows: [{ id: "row-1", base_revision: 3 }],
    });
    expect(Db.deleteOutbox).toHaveBeenCalledWith("outbox-1");
  });

  it("re-issues a refused delete against the revision the server reports", async () => {
    const { supabase } = await import("../supabase");

    // Stale by the server's reckoning: the row moved on after this device last
    // saw it. The user's intent was still to delete it, so the delete is
    // retried against revision 9 instead of being dropped.
    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [{ id: "row-1", outcome: "conflict", revision: 9 }],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "outbox-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: JSON.stringify({
          action: "delete",
          id: "row-1",
          base_revision: 3,
        }),
      },
    ] as never);

    await SyncService.drain();

    expect(Db.insertOutbox).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "row-1",
        userId: "test-user",
        payload: JSON.stringify({
          action: "delete",
          id: "row-1",
          base_revision: 9,
        }),
      }),
    );
    expect(Db.deleteOutbox).toHaveBeenCalledWith("outbox-1");
  });

  it("settles a delete the server reports as already deleted", async () => {
    const { supabase } = await import("../supabase");

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [{ id: "row-1", outcome: "already_deleted", revision: 4 }],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "outbox-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: JSON.stringify({
          action: "delete",
          id: "row-1",
          base_revision: null,
        }),
      },
    ] as never);

    await SyncService.drain();

    // Nothing left to do: the intent is satisfied either way, so the entry is
    // settled rather than retried forever.
    expect(Db.insertOutbox).not.toHaveBeenCalled();
    expect(Db.deleteOutbox).toHaveBeenCalledWith("outbox-1");
  });

  it("tombstones a delete-all instead of hard-deleting the rows", async () => {
    const { supabase } = await import("../supabase");

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () => Promise.resolve({ error: null, data: 7 }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "outbox-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: JSON.stringify({ action: "delete_all" }),
      },
    ] as never);

    await SyncService.drain();

    expect(supabase.rpc).toHaveBeenCalledWith("history_delete_all");
    expect(Db.deleteOutbox).toHaveBeenCalledWith("outbox-1");
  });

  it("drops the local copy when the server says the row is tombstoned", async () => {
    const { supabase } = await import("../supabase");

    // An ordinary write against a tombstone: the row was deleted, possibly on
    // another device. Keeping the local copy would just re-push the same state
    // and be refused on every later edit.
    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [
            {
              id: "entry-1",
              outcome: "deleted",
              revision: 4,
              server_row: {
                id: "entry-1",
                user_id: "test-user",
                deleted_at: "2026-09-02T10:00:00.000Z",
              },
            },
          ],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: buildUpsertOutboxPayload(
          "translation",
          {
            sourceLang: "en",
            targetLang: "es",
            transcript: "hello",
            translation: "hola",
            transliteration: null,
            duration: 1,
            sourceApp: "test",
            voiceId: null,
            sttProvider: "deepgram",
            mtProvider: "gemini",
            origin: "echo",
            input: "audio",
          },
          "2026-09-01T10:00:00.000Z",
          "cap-1",
          3,
        ),
      },
    ] as never);

    await SyncService.drain();

    expect(Db.deleteHistory).toHaveBeenCalledWith("entry-1");
    expect(Db.deleteOutboxForHistory).toHaveBeenCalledWith("entry-1");
    expect(Db.deleteOutbox).toHaveBeenCalledWith("entry-1");
    expect(Db.insertHistory).not.toHaveBeenCalled();
  });

  it("records the revision from a restore", async () => {
    const { supabase } = await import("../supabase");

    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () =>
        Promise.resolve({
          error: null,
          data: [
            { id: "row-1", outcome: "restored", revision: 5, server_row: null },
          ],
        }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "row-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: JSON.stringify({
          action: "upsert",
          type: "translation",
          capture_id: "cap-1",
          origin: "echo",
          input: "audio",
          source_lang: "en",
          target_lang: "es",
          transcript: "hello",
          translation_text: "hola",
          transliteration_text: null,
          duration: 1,
          source_app: "test",
          voice_id: null,
          stt_provider: "deepgram",
          mt_provider: "gemini",
          created_at: "2026-09-01T10:00:00.000Z",
          base_revision: null,
          restore: true,
        }),
      },
    ] as never);

    await SyncService.drain();

    expect(supabase.rpc).toHaveBeenCalledWith("history_upsert_if_fresh", {
      p_rows: [expect.objectContaining({ id: "row-1", restore: true })],
    });
    expect(Db.setHistoryRevision).toHaveBeenCalledWith("row-1", 5);
  });

  it("keeps an entry queued when the server does not acknowledge it", async () => {
    const { supabase } = await import("../supabase");

    // A result set that omits the entry: neither applied nor refused, so the
    // drain must not treat it as landed.
    vi.mocked(supabase.rpc).mockReturnValue({
      abortSignal: () => Promise.resolve({ error: null, data: [] }),
    } as never);
    vi.mocked(Db.getPendingOutbox).mockReturnValue([
      {
        id: "entry-1",
        userId: "test-user",
        status: "pending",
        retries: 0,
        lastAttempt: null,
        createdAt: "2026-09-01T10:00:00.000Z",
        payload: buildUpsertOutboxPayload(
          "translation",
          {
            sourceLang: "en",
            targetLang: "es",
            transcript: "hello",
            translation: "hola",
            transliteration: null,
            duration: 1,
            sourceApp: "test",
            voiceId: null,
            sttProvider: "deepgram",
            mtProvider: "gemini",
            origin: "echo",
            input: "audio",
          },
          "2026-09-01T10:00:00.000Z",
          "cap-1",
          1,
        ),
      },
    ] as never);

    await SyncService.drain();

    expect(Db.deleteOutbox).not.toHaveBeenCalled();
    expect(Db.incrementOutboxRetry).not.toHaveBeenCalled();
  });

  it("stops the realtime listener on sign-out", async () => {
    const { supabase } = await import("../supabase");

    const channel: Record<string, unknown> = {};
    channel.on = vi.fn(() => channel);
    channel.subscribe = vi.fn(() => channel);
    vi.mocked(supabase.channel).mockReturnValue(channel as never);

    const emptyPage = {
      select: () => emptyPage,
      eq: () => emptyPage,
      is: () => emptyPage,
      or: () => emptyPage,
      order: () => emptyPage,
      limit: () => Promise.resolve({ data: [], error: null }),
    };
    vi.mocked(supabase.from).mockReturnValue(emptyPage as never);

    SyncService.onUserSignedIn("test-user");
    // startRealtimeListener awaits auth.getSession() before joining, so flush
    // microtasks (no fake timers in this test).
    await Promise.resolve();
    await Promise.resolve();
    expect(supabase.channel).toHaveBeenCalledWith("history:test-user");
    expect(supabase.removeChannel).not.toHaveBeenCalled();

    SyncService.onUserSignedOut();
    expect(supabase.removeChannel).toHaveBeenCalledWith(channel);
  });

  it("resets user-scoped state when a different user signs in without signOut", async () => {
    const { resetUserScopedState } = await import("@/store/resetUserScoped");
    const reset = vi.mocked(resetUserScopedState);

    reset.mockClear();

    SyncService.onUserSignedIn("user-a");
    expect(reset).not.toHaveBeenCalled();

    // A token refresh re-fires SIGNED_IN for the same account.
    SyncService.onUserSignedIn("user-a");
    expect(reset).not.toHaveBeenCalled();

    SyncService.onUserSignedIn("user-b");
    expect(reset).toHaveBeenCalledTimes(1);

    SyncService.onUserSignedOut();
    reset.mockClear();

    // After signing out, the next sign-in is not itself a switch.
    SyncService.onUserSignedIn("user-c");
    expect(reset).not.toHaveBeenCalled();

    SyncService.onUserSignedIn("user-d");
    expect(reset).toHaveBeenCalledTimes(1);
  });

  it("should page cloud history with the composite (created_at, id) keyset order", async () => {
    const orderCalls: Array<{ column: string; ascending: boolean }> = [];
    const { supabase } = await import("../supabase");
    const from = vi.mocked(supabase.from);

    const fakeChain = {
      select: () => fakeChain,
      eq: () => fakeChain,
      is: () => fakeChain,
      or: () => fakeChain,
      order: (column: string, opts: { ascending: boolean }) => {
        orderCalls.push({ column, ascending: opts.ascending });
        return fakeChain;
      },
      limit: () =>
        Promise.resolve({
          data: [
            { created_at: "2026-09-01T10:00:00.000Z", id: "b" },
            { created_at: "2026-09-01T10:00:00.000Z", id: "a" },
          ],
          error: null,
        }),
    };
    from.mockReturnValue(fakeChain as never);

    const entries = await SyncService.fetchOlderHistory(
      "user123",
      { created_at: "2026-09-01T11:00:00.000Z", id: "z" },
      20,
    );

    expect(entries).toHaveLength(2);
    expect(orderCalls).toEqual([
      { column: "created_at", ascending: false },
      { column: "id", ascending: false },
    ]);
  });

  it("should skip the keyset filter when paging the newest cloud page (null cursor)", async () => {
    let orCalls = 0;
    const { supabase } = await import("../supabase");
    const from = vi.mocked(supabase.from);

    const fakeChain = {
      select: () => fakeChain,
      eq: () => fakeChain,
      is: () => fakeChain,
      or: () => {
        orCalls += 1;
        return fakeChain;
      },
      order: () => fakeChain,
      limit: () =>
        Promise.resolve({
          data: [{ created_at: "2026-09-05T10:00:00.000Z", id: "c" }],
          error: null,
        }),
    };
    from.mockReturnValue(fakeChain as never);

    const entries = await SyncService.fetchOlderHistory("user123", null, 20);

    expect(entries).toHaveLength(1);
    expect(entries[0].id).toBe("c");
    expect(orCalls).toBe(0);
  });

  describe("realtime subscription", () => {
    type StatusHandler = (status: string, err?: Error) => void;

    function mockChannel(statuses: string[]): {
      channel: ReturnType<typeof vi.fn>;
      emit: (i: number) => void;
    } {
      const handlers: StatusHandler[] = [];
      const channel = vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.on = vi.fn(() => chain);
        chain.subscribe = vi.fn((cb: StatusHandler) => {
          handlers.push(cb);
          return chain;
        });
        return chain;
      });
      return {
        channel,
        emit: (i: number) => handlers[i]?.(statuses[i] ?? "CLOSED"),
      };
    }

    // startRealtimeListener awaits auth.getSession() before joining, so let
    // microtasks settle before asserting on channel construction.
    async function join(): Promise<void> {
      await vi.advanceTimersByTimeAsync(0);
    }

    beforeEach(() => {
      vi.useFakeTimers();
      // Pin the jitter band to its upper edge so backoff assertions are exact.
      // `scheduleRealtimeRetry` multiplies the base by
      // `1 - 0.5 + random() * 0.5`, so random() === 1 gives the full delay.
      vi.spyOn(Math, "random").mockReturnValue(1);
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: "test-jwt" } },
        error: null,
      } as never);
    });

    afterEach(() => {
      vi.restoreAllMocks();
      vi.useRealTimers();
    });

    it("sets the realtime auth token from the session before joining", async () => {
      const { channel } = mockChannel(["SUBSCRIBED"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();

      expect(supabase.realtime.setAuth).toHaveBeenCalledWith("test-jwt");
      expect(channel).toHaveBeenCalledTimes(1);
    });

    it("does not join at all without a session", async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: null },
        error: null,
      } as never);
      const { channel } = mockChannel(["SUBSCRIBED"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();

      expect(channel).not.toHaveBeenCalled();
      expect(supabase.realtime.setAuth).not.toHaveBeenCalled();
    });

    it("does not retry after a successful subscribe", async () => {
      const { channel, emit } = mockChannel(["SUBSCRIBED"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      expect(channel).toHaveBeenCalledTimes(1);

      emit(0);
      await vi.advanceTimersByTimeAsync(120_000);

      // Still one channel: SUBSCRIBED must not schedule a reconnect.
      expect(channel).toHaveBeenCalledTimes(1);
    });

    it("retries with backoff after CHANNEL_ERROR", async () => {
      const { channel, emit } = mockChannel(["CHANNEL_ERROR", "SUBSCRIBED"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      emit(0);
      await join();

      expect(channel).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(channel).toHaveBeenCalledTimes(1); // still backing off

      await vi.advanceTimersByTimeAsync(2);
      await join();
      expect(channel).toHaveBeenCalledTimes(2); // re-joined

      emit(1);
      await vi.advanceTimersByTimeAsync(120_000);
      expect(channel).toHaveBeenCalledTimes(2); // backoff counter reset
    });

    it("gives up after the retry cap", async () => {
      const { channel, emit } = mockChannel(["CHANNEL_ERROR"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();

      // Each cycle: one initial attempt plus its re-join, until the cap trips.
      for (let i = 0; i < 12; i++) {
        emit(i);
        await vi.advanceTimersByTimeAsync(120_000);
        await join();
      }

      const attempts = channel.mock.calls.length;
      expect(attempts).toBeGreaterThan(1);
      // Cap is REALTIME_MAX_RETRIES (5) retries on top of the first attempt.
      expect(attempts).toBeLessThanOrEqual(6);

      // No further reconnects once exhausted.
      const settled = channel.mock.calls.length;
      await vi.advanceTimersByTimeAsync(600_000);
      expect(channel).toHaveBeenCalledTimes(settled);
    });

    it("grows the backoff across consecutive failures", async () => {
      // This is the regression that mattered: the retry timer used to re-enter
      // startRealtimeListener, which zeroed the counter, so every delay was the
      // 2s base and the cap was unreachable. With the counter preserved the
      // delays must double: 2s, 4s, 8s, 16s, 32s.
      const { channel, emit } = mockChannel([
        "CHANNEL_ERROR",
        "CHANNEL_ERROR",
        "CHANNEL_ERROR",
        "CHANNEL_ERROR",
        "CHANNEL_ERROR",
      ]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      expect(channel).toHaveBeenCalledTimes(1);

      // Attempt 1 waits 2s, attempt 2 waits 4s, attempt 3 waits 8s.
      emit(0);
      await vi.advanceTimersByTimeAsync(1_999);
      expect(channel).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      await join();
      expect(channel).toHaveBeenCalledTimes(2);

      emit(1);
      await vi.advanceTimersByTimeAsync(3_999);
      expect(channel).toHaveBeenCalledTimes(2);
      await vi.advanceTimersByTimeAsync(1);
      await join();
      expect(channel).toHaveBeenCalledTimes(3);

      emit(2);
      await vi.advanceTimersByTimeAsync(7_999);
      expect(channel).toHaveBeenCalledTimes(3);
      await vi.advanceTimersByTimeAsync(1);
      await join();
      expect(channel).toHaveBeenCalledTimes(4);
    });

    it("retries after a CLOSED status", async () => {
      // CLOSED used to fall through unmatched, so a closed channel silently
      // downgraded the client to pull-only for the rest of the session.
      const { channel, emit } = mockChannel(["CLOSED", "SUBSCRIBED"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      emit(0);
      await vi.advanceTimersByTimeAsync(2_000);
      await join();

      expect(channel).toHaveBeenCalledTimes(2);
    });

    it("ignores status callbacks from a superseded channel", async () => {
      const { channel, emit } = mockChannel(["SUBSCRIBED", "CHANNEL_ERROR"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      expect(channel).toHaveBeenCalledTimes(1);

      // Force a re-join so the first channel becomes stale.
      SyncService.onUserSignedIn("user123");
      await join();
      expect(channel).toHaveBeenCalledTimes(2);

      // The stale channel now reports a failure. It must neither apply events
      // nor spend retry budget against the live channel.
      emit(0);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(channel).toHaveBeenCalledTimes(2);
    });

    it("a fresh sign-in drops a pending retry timer instead of letting it restart the backoff", async () => {
      // A pending timer is only cleared on a successful SUBSCRIBED. If a second
      // sign-in joins and fails, that timer would otherwise fire against the
      // just-reset counter and restart the delay at the 2s floor.
      const { channel, emit } = mockChannel(["CHANNEL_ERROR"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      expect(channel).toHaveBeenCalledTimes(1);

      // Arm a 2s retry.
      emit(0);
      await vi.advanceTimersByTimeAsync(1_000);

      // A genuine sign-in supersedes it.
      SyncService.onUserSignedIn("user123");
      await join();
      expect(channel).toHaveBeenCalledTimes(2);

      // No new error is emitted, so nothing re-arms a timer. The superseded one
      // must stay dead even past its original 2s mark.
      await vi.advanceTimersByTimeAsync(5_000);
      expect(channel).toHaveBeenCalledTimes(2);
    });

    it("does not spend the retry budget while offline", async () => {
      const { isDefinitelyOffline } = await import("@/utils/connectivity");
      const { channel, emit } = mockChannel(["CHANNEL_ERROR", "CHANNEL_ERROR"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );
      vi.mocked(isDefinitelyOffline).mockReturnValue(true);

      SyncService.onUserSignedIn("user123");
      await join();
      emit(0);
      await vi.advanceTimersByTimeAsync(600_000);
      expect(channel).toHaveBeenCalledTimes(1);

      // Back online, the same live channel failing again retries instead of
      // finding the budget already spent. Still handler 0: no re-join happened
      // while offline, so it is the only channel that exists.
      vi.mocked(isDefinitelyOffline).mockReturnValue(false);
      emit(0);
      await vi.advanceTimersByTimeAsync(2_000);
      await join();
      expect(channel).toHaveBeenCalledTimes(2);
    });

    it("stops retrying after sign-out", async () => {
      const { channel, emit } = mockChannel(["CHANNEL_ERROR"]);
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );

      SyncService.onUserSignedIn("user123");
      await join();
      SyncService.onUserSignedOut();

      emit(0);
      await vi.advanceTimersByTimeAsync(600_000);

      expect(channel).toHaveBeenCalledTimes(1);
    });
  });

  describe("realtime delete echo guard", () => {
    type RowHandler = (payload: { old?: Record<string, unknown> }) => void;

    /**
     * Capture the postgres_changes handlers keyed by event, so the DELETE
     * handler can be driven directly.
     */
    function mockDeleteChannel(): {
      channel: ReturnType<typeof vi.fn>;
      handlerFor: (event: string) => RowHandler | undefined;
    } {
      const byEvent = new Map<string, RowHandler>();
      const channel = vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.on = vi.fn(
          (
            _kind: string,
            filter: { event: string },
            cb: RowHandler,
          ): Record<string, unknown> => {
            byEvent.set(filter.event, cb);
            return chain;
          },
        );
        chain.subscribe = vi.fn(() => chain);
        return chain;
      });
      return { channel, handlerFor: (event) => byEvent.get(event) };
    }

    beforeEach(async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: "test-jwt" } },
        error: null,
      } as never);
    });

    async function joinDeleteHandler(): Promise<RowHandler> {
      const { channel, handlerFor } = mockDeleteChannel();
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );
      SyncService.onUserSignedIn("user123");
      await vi.advanceTimersByTimeAsync?.(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const handler = handlerFor("DELETE");
      if (!handler) throw new Error("DELETE handler was never registered");
      return handler;
    }

    it("applies a remote delete when nothing is pending", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([]);
        const handler = await joinDeleteHandler();

        handler({ old: { id: "row-1" } });
        expect(Db.deleteHistory).toHaveBeenCalledWith("row-1");
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores the echo of our own single-row delete", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([
          {
            id: "row-1",
            payload: JSON.stringify({ action: "delete", id: "row-1" }),
          },
        ] as never);
        const handler = await joinDeleteHandler();

        handler({ old: { id: "row-1" } });
        expect(Db.deleteHistory).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores the echo of a delete that is still in flight", async () => {
      // The row is mid-request, so a `pending`-only guard would miss it and let
      // the echo delete a row the local edit is still writing.
      vi.useFakeTimers();
      try {
        vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([
          {
            id: "row-1",
            status: "in_flight",
            payload: JSON.stringify({ action: "delete", id: "row-1" }),
          },
        ] as never);
        const handler = await joinDeleteHandler();

        handler({ old: { id: "row-1" } });
        expect(Db.deleteHistory).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("ignores the echo of a pending clear-all", async () => {
      // clearAllHistory enqueues ONE outbox row under a random UUID with
      // action "delete_all", so a row-id comparison can never match it. Its
      // own broadcast comes back for every row it removed, and the local purge
      // has already removed them.
      vi.useFakeTimers();
      try {
        vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([
          {
            id: "some-random-uuid",
            payload: JSON.stringify({ action: "delete_all" }),
          },
        ] as never);
        const handler = await joinDeleteHandler();

        handler({ old: { id: "row-7" } });
        handler({ old: { id: "row-8" } });
        expect(Db.deleteHistory).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("still applies deletes for other rows while one delete is pending", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([
          {
            id: "outbox-1",
            payload: JSON.stringify({ action: "delete", id: "row-1" }),
          },
        ] as never);
        const handler = await joinDeleteHandler();

        handler({ old: { id: "row-1" } });
        handler({ old: { id: "row-2" } });
        expect(Db.deleteHistory).not.toHaveBeenCalledWith("row-1");
        expect(Db.deleteHistory).toHaveBeenCalledWith("row-2");
      } finally {
        vi.useRealTimers();
      }
    });

    it("applies the delete when the pending payload is malformed", async () => {
      // A payload we cannot parse cannot be proven to be ours, so the event
      // must be honoured rather than silently dropped.
      vi.useFakeTimers();
      try {
        vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([
          { id: "outbox-1", payload: "not-json" },
        ] as never);
        const handler = await joinDeleteHandler();

        handler({ old: { id: "row-3" } });
        expect(Db.deleteHistory).toHaveBeenCalledWith("row-3");
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("realtime tombstone", () => {
    type UpdateHandler = (payload: { new: Record<string, unknown> }) => void;

    function mockUpdateChannel(): {
      channel: ReturnType<typeof vi.fn>;
      handlerFor: (event: string) => UpdateHandler | undefined;
    } {
      const byEvent = new Map<string, UpdateHandler>();
      const channel = vi.fn(() => {
        const chain: Record<string, unknown> = {};
        chain.on = vi.fn(
          (
            _kind: string,
            filter: { event: string },
            cb: UpdateHandler,
          ): Record<string, unknown> => {
            byEvent.set(filter.event, cb);
            return chain;
          },
        );
        chain.subscribe = vi.fn(() => chain);
        return chain;
      });
      return { channel, handlerFor: (event) => byEvent.get(event) };
    }

    beforeEach(async () => {
      vi.mocked(supabase.auth.getSession).mockResolvedValue({
        data: { session: { access_token: "test-jwt" } },
        error: null,
      } as never);
    });

    async function joinUpdateHandler(): Promise<UpdateHandler> {
      const { channel, handlerFor } = mockUpdateChannel();
      vi.mocked(supabase.channel).mockImplementation(
        channel as unknown as typeof supabase.channel,
      );
      SyncService.onUserSignedIn("user123");
      await vi.advanceTimersByTimeAsync?.(0);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
      const handler = handlerFor("UPDATE");
      if (!handler) throw new Error("UPDATE handler was never registered");
      return handler;
    }

    it("deletes the local row when the update carries a tombstone", async () => {
      // A delete is an UPDATE that sets deleted_at, so it never reaches the
      // DELETE channel. Treating it as a content change would resurrect the row
      // the user just deleted.
      vi.useFakeTimers();
      try {
        vi.mocked(Db.hasPendingOutboxRow).mockReturnValue(false);
        const handler = await joinUpdateHandler();

        handler({
          new: { id: "row-1", deleted_at: "2026-09-02T10:00:00.000Z" },
        });

        expect(Db.deleteHistory).toHaveBeenCalledWith("row-1");
        expect(Db.insertHistory).not.toHaveBeenCalled();
      } finally {
        vi.useRealTimers();
      }
    });

    it("still applies an ordinary content update", async () => {
      vi.useFakeTimers();
      try {
        vi.mocked(Db.hasPendingOutboxRow).mockReturnValue(false);
        const handler = await joinUpdateHandler();

        handler({
          new: {
            id: "row-1",
            user_id: "user123",
            capture_id: "cap-1",
            origin: "echo",
            input: "audio",
            source_lang: "en",
            target_lang: "es",
            transcript: "hello",
            translation_text: "hola",
            transliteration_text: null,
            duration: 1,
            source_app: "test",
            voice_id: null,
            stt_provider: "deepgram",
            mt_provider: "gemini",
            created_at: "2026-09-01T10:00:00.000Z",
            type: "translation",
            revision: 5,
            deleted_at: null,
          },
        });

        // The UPDATE handler updates the existing capture in place rather than
        // re-inserting, so the assertion is that it was not treated as a delete
        // and that the row's content was refreshed.
        expect(Db.deleteHistory).not.toHaveBeenCalled();
        expect(Db.updateCaptureRow).toHaveBeenCalledWith(
          "row-1",
          expect.objectContaining({
            transcript: "hello",
            translation_text: "hola",
          }),
        );
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe("pull guards", () => {
    /** A query chain that records the filters applied and returns one page. */
    function queryRecording(
      data: unknown[],
      seen: { is?: unknown[]; eq?: unknown[] },
    ): unknown {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = (...args: unknown[]) => {
        seen.eq = args;
        return query;
      };
      query.is = (...args: unknown[]) => {
        seen.is = args;
        return query;
      };
      query.or = () => query;
      query.order = () => query;
      query.limit = () => Promise.resolve({ data, error: null });
      return query;
    }

    it("filters tombstones out of the pull", async () => {
      // Without this a tombstone arrives as a normal row and the deleted entry
      // reappears in history on the next sync.
      const seen: { is?: unknown[]; eq?: unknown[] } = {};
      vi.mocked(supabase.from).mockReturnValue(
        queryRecording([], seen) as never,
      );

      await SyncService.pullFromCloud("user123");

      expect(seen.is).toEqual(["deleted_at", null]);
    });

    it("does not reinsert a row whose delete has not been pushed yet", async () => {
      // The regression: pendingIds was built from outbox row ids, and a delete
      // is enqueued under a random UUID, so a row deleted on this device was
      // pulled straight back before its tombstone reached the server.
      vi.mocked(Db.getUnacknowledgedOutbox).mockReturnValue([
        {
          id: "outbox-9",
          payload: JSON.stringify({
            action: "delete",
            id: "row-1",
            base_revision: 2,
          }),
        },
      ] as never);
      vi.mocked(supabase.from).mockReturnValue(
        queryRecording(
          [
            {
              id: "row-1",
              user_id: "user123",
              capture_id: "cap-1",
              origin: "echo",
              input: "audio",
              source_lang: "en",
              target_lang: "es",
              transcript: "hello",
              translation_text: "hola",
              transliteration_text: null,
              duration: 1,
              source_app: "test",
              voice_id: null,
              stt_provider: "deepgram",
              mt_provider: "gemini",
              created_at: new Date().toISOString(),
              type: "translation",
              revision: 2,
              deleted_at: null,
            },
          ],
          {},
        ) as never,
      );

      await SyncService.pullFromCloud("user123");

      expect(Db.insertHistory).not.toHaveBeenCalled();
    });
  });

  describe("error normalisation", () => {
    /** Build a query chain whose `limit()` resolves to the given result. */
    function queryReturning(result: unknown): unknown {
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.is = () => query;
      query.or = () => query;
      query.order = () => query;
      query.limit = () => Promise.resolve(result);
      return query;
    }

    it("surfaces the message from a PostgREST plain object", async () => {
      // supabase-js rejects with a plain object, not an Error. Previously
      // `err instanceof Error ? err.message : String(err)` produced
      // "[object Object]" and the drain's timeout branch was unreachable,
      // which is why failures logged as "Batch drain failed " with no reason.
      const { supabase: sb } = await import("../supabase");
      vi.mocked(sb.from).mockReturnValue(
        queryReturning({
          data: null,
          error: {
            message: "duplicate key value violates unique constraint",
            code: "23505",
            details: "Key (id)=(abc) already exists.",
            hint: null,
          },
        }) as never,
      );

      await SyncService.pullFromCloud("user123");

      expect(SyncService.pullError.get()).toBe(
        "duplicate key value violates unique constraint (23505)",
      );
    });

    it("passes a real Error through unchanged", async () => {
      const { supabase: sb } = await import("../supabase");
      vi.mocked(sb.from).mockReturnValue(
        queryReturning({
          data: null,
          error: new Error("network is unreachable"),
        }) as never,
      );

      await SyncService.pullFromCloud("user123");
      expect(SyncService.pullError.get()).toBe("network is unreachable");
    });

    it("handles a non-object, non-Error rejection", async () => {
      const { supabase: sb } = await import("../supabase");
      const query: Record<string, unknown> = {};
      query.select = () => query;
      query.eq = () => query;
      query.is = () => query;
      query.order = () => query;
      query.limit = () => Promise.reject("just a string");
      vi.mocked(sb.from).mockReturnValue(query as never);

      await SyncService.pullFromCloud("user123");
      expect(SyncService.pullError.get()).toBe("just a string");
    });
  });
});
