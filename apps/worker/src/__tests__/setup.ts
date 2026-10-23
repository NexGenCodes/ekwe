import { vi, beforeAll, afterEach, afterAll } from "vitest";
import type { Env } from "@/core/types";
import { server } from "@/__tests__/msw/server";
import { resetHealthMemo } from "@/services/health";
import { resetWsKeyPenalties } from "@/utils/stream";
import { clearBlacklistMemo } from "@/utils/keys";
import {
  defaultMockDbExecute,
  type MockExecuteQuery,
  type MockRows,
} from "@/__tests__/helpers/mock-db";

// Direct `export … from` (rather than importing then re-exporting) so Vitest's
// `vi.mock` hoisting keeps these bindings live for tests that import them from
// this setup module.
export {
  defaultMockDbExecute,
  executeQueryChunks,
  executeQueryToSql,
} from "@/__tests__/helpers/mock-db";
export type { MockExecuteQuery, MockRows } from "@/__tests__/helpers/mock-db";

/**
 * A Drizzle-shaped stand-in for `getDb()`. The builder methods hand back the
 * mock so chains keep flowing; tests override `execute` per query text and
 * `where` per row set.
 */
export const mockDb = {
  execute:
    vi.fn<(query: MockExecuteQuery) => Promise<MockRows>>(defaultMockDbExecute),
  select: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
  from: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
  where: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
  insert: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
  values: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
  onConflictDoUpdate: vi.fn<(...args: unknown[]) => unknown>(function (
    this: unknown,
  ) {
    return this;
  }),
  update: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
  set: vi.fn<(...args: unknown[]) => unknown>(function (this: unknown) {
    return this;
  }),
};

vi.mock("@/db", () => ({
  getDb: () => mockDb,
}));

const cacheStore = new Map<string, Response>();

const mockCaches = {
  default: {
    match: vi.fn(
      async (request: Request) => cacheStore.get(request.url) ?? null,
    ),
    put: vi.fn(async (request: Request, response: Response) => {
      cacheStore.set(request.url, response.clone());
    }),
    delete: vi.fn(async (request: Request) => {
      cacheStore.delete(request.url);
      return true;
    }),
  },
};

globalThis.caches = mockCaches as unknown as CacheStorage;

beforeEach(() => {
  cacheStore.clear();
  vi.clearAllMocks();
});

export function mockExecutionContext(): ExecutionContext {
  const waitUntilFns: Array<Promise<unknown>> = [];
  return {
    waitUntil: vi.fn((p: Promise<unknown>) => {
      waitUntilFns.push(p);
    }),
    passThroughOnException: vi.fn(),

    _waitUntilFns: waitUntilFns,
  } as unknown as ExecutionContext;
}

interface D1Row {
  cache_key: string;
  user_id?: string;
  tier?: string;
  result: string;
  created_at: number;
  expires_at: number;
}

class InMemoryD1 {
  private tables: Record<string, Map<string, D1Row>> = {};

  prepare(sql: string): {
    bind: (...args: unknown[]) => {
      first: <T>() => Promise<T | null>;
      all: <T>() => Promise<{ results: T[] }>;
      run: () => Promise<{ meta: { changes: number } }>;
    };
  } {
    if (/^\s*SELECT\s+1\s*$/i.test(sql)) {
      return {
        bind: () => ({
          first: async <T>() => ({ 1: 1 }) as T,
          all: async <T>() => ({ results: [] }) as unknown as { results: T[] },
          run: async () => ({ meta: { changes: 0 } }),
        }),
      };
    }

    // Cooldown gate: every test that does not override env.DB is inside the
    // window, so the claim always succeeds.
    if (/user_cooldowns/i.test(sql)) {
      return {
        bind: () => ({
          first: async <T>() => ({ last_request_at: Date.now() }) as T,
          all: async <T>() =>
            ({ results: [{ last_request_at: Date.now() }] }) as unknown as {
              results: T[];
            },
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
    }
    // Daily quota read. Tests that need a specific count override env.DB.
    if (/FROM\s+user_daily_usage/i.test(sql)) {
      return {
        bind: () => ({
          first: async <T>() => ({ used: 0 }) as T,
          all: async <T>() => ({ results: [] }) as unknown as { results: T[] },
          run: async () => ({ meta: { changes: 0 } }),
        }),
      };
    }

    // Monthly quota and shared credit-budget read.
    if (/FROM\s+user_monthly_usage/i.test(sql)) {
      return {
        bind: () => ({
          first: async <T>() =>
            ({
              translate_count: 0,
              transcribe_count: 0,
              transcribe_ms: 0,
              speech_chars: 0,
              stream_count: 0,
              stream_ms: 0,
              ai_credits: 0,
            }) as T,
          all: async <T>() => ({ results: [] }) as unknown as { results: T[] },
          run: async () => ({ meta: { changes: 0 } }),
        }),
      };
    }

    // Usage increments are fire-and-forget under waitUntil.
    if (/INSERT INTO\s+user_(daily|monthly)_usage/i.test(sql)) {
      return {
        bind: () => ({
          first: async () => null,
          all: async () => ({ results: [] }),
          run: async () => ({ meta: { changes: 1 } }),
        }),
      };
    }

    const tableMatch = sql.match(/FROM\s+(\w+)|INTO\s+(\w+)|UPDATE\s+(\w+)/i);
    const table = tableMatch?.[1] ?? tableMatch?.[2] ?? tableMatch?.[3];
    if (!table) throw new Error(`Mock D1: cannot infer table from: ${sql}`);
    const store = (this.tables[table] ??= new Map<string, D1Row>());

    return {
      bind: (...args: unknown[]) => {
        if (
          /SELECT result, expires_at/i.test(sql) &&
          /WHERE cache_key = \?/.test(sql)
        ) {
          const key = args[0] as string;
          return {
            first: async <T>() => {
              const row = store.get(key);
              if (!row) return null;
              if (row.expires_at < Math.floor(Date.now() / 1000)) {
                store.delete(key);
                return null;
              }
              return { result: row.result, expires_at: row.expires_at } as T;
            },
            all: async () => ({ results: [] }),
            run: async () => ({ meta: { changes: 0 } }),
          };
        }

        if (
          /SELECT cache_key/i.test(sql) &&
          /WHERE expires_at < \?/.test(sql)
        ) {
          const now = args[0] as number;
          return {
            first: async () => null,
            all: async <T>() => {
              const results = [...store.values()]
                .filter((r) => r.expires_at < now)
                .slice(0, (args[1] as number) ?? 50)
                .map((r) => ({ cache_key: r.cache_key })) as unknown as T[];
              return { results };
            },
            run: async () => ({ meta: { changes: 0 } }),
          };
        }

        if (/INSERT INTO/i.test(sql)) {
          if (/webhook_idempotency/i.test(sql)) {
            const [key, createdAt, expiresAt] = args;
            return {
              first: async () => null,
              all: async () => ({ results: [] }),
              run: async () => {
                const exists = store.has(key as string);
                if (!exists) {
                  store.set(key as string, {
                    cache_key: key as string,
                    result: "",
                    created_at: (createdAt as number) ?? 0,
                    expires_at: (expiresAt as number) ?? 0,
                  });
                }
                return { meta: { changes: exists ? 0 : 1 } };
              },
            };
          }
          const [key, userId, tier, result, createdAt, expiresAt] = args;
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => {
              store.set(key as string, {
                cache_key: key as string,
                user_id: (userId as string) ?? undefined,
                tier: (tier as string) ?? undefined,
                result: result as string,
                created_at: createdAt as number,
                expires_at: expiresAt as number,
              });
              return { meta: { changes: 1 } };
            },
          };
        }

        if (/DELETE FROM/i.test(sql)) {
          const key = args[0] as string;
          return {
            first: async () => null,
            all: async () => ({ results: [] }),
            run: async () => {
              const had = store.delete(key);
              return { meta: { changes: had ? 1 : 0 } };
            },
          };
        }

        throw new Error(`Mock D1: unhandled statement: ${sql}`);
      },
    };
  }

  batch(stmts: Array<{ run: () => Promise<unknown> }>): Promise<unknown[]> {
    return Promise.all(stmts.map((s) => s.run()));
  }
}

export function mockEnv(overrides: Partial<Env> = {}): Env {
  const store = new Map<string, string | Uint8Array>();
  const kv = {
    get: vi.fn(async (key: string, opts?: { type?: string }) => {
      const raw = store.get(key);
      if (raw == null) return null;
      if (opts?.type === "arrayBuffer" && typeof raw !== "string") {
        return raw.buffer.slice(
          raw.byteOffset,
          raw.byteOffset + raw.byteLength,
        );
      }
      return raw;
    }) as unknown as Env["EKWE_KV"]["get"],
    put: vi.fn(
      async (
        key: string,
        value: string | ArrayBuffer | Uint8Array,
        opts?: { expirationTtl?: number },
      ) => {
        if (value instanceof ArrayBuffer) {
          store.set(key, new Uint8Array(value));
        } else if (value instanceof Uint8Array) {
          store.set(key, value);
        } else {
          store.set(key, value);
        }
        if (opts?.expirationTtl) {
          const ttlMs = Math.min(opts.expirationTtl * 1000, 2 ** 31 - 1);
          const timer = setTimeout(() => store.delete(key), ttlMs);
          timer.unref?.();
        }
      },
    ) as unknown as Env["EKWE_KV"]["put"],
    delete: vi.fn(async (key: string) => {
      store.delete(key);
    }) as unknown as Env["EKWE_KV"]["delete"],
  } as unknown as Env["EKWE_KV"];

  const ai = {
    run: vi.fn(async (_model: string, inputs: Record<string, unknown>) => {
      if (_model === "@cf/openai/whisper-large-v3-turbo") {
        // The provider sends audio as a base64 string; the Whisper
        // binding rejects the { body, contentType } object form.
        const audio = inputs?.audio as string | undefined;
        const text = audio ? "mock whisper transcription" : "";
        return { text };
      }
      if (_model === "@cf/zai-org/glm-4.7-flash") {
        return {
          choices: [{ index: 0, message: { content: "translated text" } }],
        };
      }
      return {};
    }) as unknown as Env["AI"]["run"],
  } as unknown as Env["AI"];

  const rateLimiter = {
    limit: vi.fn(async () => ({ success: true })),
  } as Env["RATE_LIMITER"];

  const r2Store = new Map<
    string,
    { value: Uint8Array; customMetadata: Record<string, string> }
  >();
  const r2 = {
    get: vi.fn(async (key: string) => {
      const entry = r2Store.get(key);
      if (!entry) return null;
      const arr = entry.value;
      return {
        key,
        size: arr.byteLength,
        customMetadata: { ...entry.customMetadata },
        httpMetadata: {},
        body: null,
        arrayBuffer: async () =>
          arr.buffer.slice(arr.byteOffset, arr.byteOffset + arr.byteLength),
        writeHttpMetadata: vi.fn(),
      };
    }),
    put: vi.fn(
      async (
        key: string,
        value: string | ArrayBuffer | Uint8Array,
        options?: {
          customMetadata?: Record<string, string>;
          httpMetadata?: Record<string, string>;
        },
      ) => {
        let bytes: Uint8Array;
        if (value instanceof Uint8Array) bytes = value;
        else if (value instanceof ArrayBuffer) bytes = new Uint8Array(value);
        else bytes = new TextEncoder().encode(value);
        r2Store.set(key, {
          value: new Uint8Array(bytes),
          customMetadata: options?.customMetadata ?? {},
        });
        return {
          key,
          size: bytes.byteLength,
          customMetadata: options?.customMetadata ?? {},
          httpMetadata: options?.httpMetadata ?? {},
        };
      },
    ),
    delete: vi.fn(async (key: string) => r2Store.delete(key)),
    list: vi.fn(async () => ({ objects: [] })),
  } as unknown as Env["SPEECH_CACHE"];

  const analyticsDataset = {
    writeDataPoint: vi.fn(),
  } as unknown as Env["EKWE_ANALYTICS"];

  const d1 = new InMemoryD1() as unknown as Env["DB"];

  const throttleStore = new Map<string, { count: number; resetAt: number }>();
  const throttleDo = {
    getByName: vi.fn((_name: string) => ({
      fetch: vi.fn(async (input: string | URL) => {
        const url = new URL(String(input));
        const key = url.searchParams.get("key");
        const limit = Number(url.searchParams.get("limit") ?? "0");
        const windowSec = Number(url.searchParams.get("windowSec") ?? "0");
        if (!key || limit <= 0 || windowSec <= 0) {
          return jsonResponse({ allowed: true }, 400);
        }
        const storageKey = `otp:throttle:${key}`;
        const now = Date.now();
        const raw = throttleStore.get(storageKey);
        if (!raw || now >= raw.resetAt) {
          throttleStore.set(storageKey, {
            count: 1,
            resetAt: now + windowSec * 1000,
          });
          return jsonResponse({ allowed: true });
        }
        if (raw.count >= limit) return jsonResponse({ allowed: false });
        throttleStore.set(storageKey, {
          count: raw.count + 1,
          resetAt: raw.resetAt,
        });
        return jsonResponse({ allowed: true });
      }),
    })),
  } as unknown as Env["THROTTLE_DO"];

  return {
    EKWE_KV: kv,
    DB: d1,
    AI: ai,
    RATE_LIMITER: rateLimiter,
    SPEECH_CACHE: r2,
    EKWE_ANALYTICS: analyticsDataset,
    THROTTLE_DO: throttleDo,
    SPEECH_URL_SECRET: "mock-speech-url-secret",
    GROQ_KEY_1: "mock-groq-key-1-abcde",
    GROQ_KEY_2: "mock-groq-key-2-abcde",
    DEEPGRAM_KEY_1: "mock-deepgram-1-abcde",
    DEEPGRAM_KEY_2: "mock-deepgram-2-abcde",
    GLADIA_KEY_1: "mock-gladia-key-1-abcde",
    GLADIA_KEY_2: "mock-gladia-key-2-abcde",
    GLADIA_KEY_3: "mock-gladia-key-3-abcde",
    GLADIA_KEY_4: "mock-gladia-key-4-abcde",
    GLADIA_KEY_5: "mock-gladia-key-5-abcde",
    ASSEMBLYAI_KEY_1: "mock-assembly-1-abcde",
    ASSEMBLYAI_KEY_2: "mock-assembly-2-abcde",
    ELEVENLABS_KEY_1: "mock-elevenlabs-key-1-abcde",
    ELEVENLABS_KEY_2: "mock-elevenlabs-key-2-abcde",
    GEMINI_KEY_1: "mock-gemini-key-1-abcde",
    GEMINI_KEY_2: "mock-gemini-key-2-abcde",
    GEMINI_KEY_3: "mock-gemini-key-3-abcde",
    COHERE_KEY_1: "mock-cohere-key-1-abcde",
    COHERE_KEY_2: "mock-cohere-key-2-abcde",
    COHERE_KEY_3: "mock-cohere-key-3-abcde",
    MISTRAL_KEY_1: "mock-mistral-key-1-abcde",
    MISTRAL_KEY_2: "mock-mistral-key-2-abcde",
    MISTRAL_KEY_3: "mock-mistral-key-3-abcde",
    MISTRAL_KEY_4: "mock-mistral-key-4-abcde",
    MISTRAL_KEY_5: "mock-mistral-key-5-abcde",
    OPENROUTER_KEY_1: "mock-openrouter-key-1-abcde",
    OPENROUTER_KEY_2: "mock-openrouter-key-2-abcde",

    WIT_KEY_EN: "mock-wit-en-key-10",
    WIT_KEY_FR: "mock-wit-fr-key-10",
    WIT_KEY_ES: "mock-wit-es-key-10",
    ...overrides,
  } as unknown as Env;
}

export function makeAudioBlob(): Blob {
  const sampleRate = 8000;
  const bitsPerSample = 16;
  const numChannels = 1;
  const durationSec = 0.1;
  const numSamples = Math.floor(sampleRate * durationSec);
  const dataSize = numSamples * numChannels * (bitsPerSample / 8);
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeStr = (v: DataView, o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * (bitsPerSample / 8), true);
  view.setUint16(32, numChannels * (bitsPerSample / 8), true);
  view.setUint16(34, bitsPerSample, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  return new Blob([buffer], { type: "audio/wav" });
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/**
 * Reads a JSON response body for assertions. The type parameter is a claim the
 * test makes about the route's payload, so a wrong shape surfaces as a
 * typecheck failure rather than a silent `undefined`.
 */
export async function jsonBody<T = Record<string, unknown>>(
  res: Response,
): Promise<T> {
  return (await res.json()) as T;
}

/**
 * A stand-in `AI` binding for tests that only exercise `run`. The real binding
 * carries a large surface the worker never touches, so tests pass just the
 * method they care about.
 */
export function aiStub(
  run: (model: string, inputs: Record<string, unknown>) => Promise<unknown>,
): Env["AI"] {
  return { run } as unknown as Env["AI"];
}

/** A stand-in `EKWE_KV` binding; every method may be omitted. */
export function kvStub(overrides: Partial<Env["EKWE_KV"]>): Env["EKWE_KV"] {
  return overrides as unknown as Env["EKWE_KV"];
}

export function mockSignal(): AbortSignal {
  return new AbortController().signal;
}

const IS_INTEGRATION = process.env.RUN_INTEGRATION_TESTS === "true";

if (!IS_INTEGRATION) {
  beforeAll(() => {
    server.listen({
      onUnhandledRequest: "error",
    });
  });

  afterEach(() => {
    server.resetHandlers();
    resetHealthMemo();
    resetWsKeyPenalties();
    clearBlacklistMemo();
  });

  afterAll(() => {
    server.close();
  });
}
