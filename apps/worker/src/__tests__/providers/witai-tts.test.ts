import { describe, test, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { mockEnv } from "@/__tests__/setup";
import { tts } from "@/providers/witai";

const env = mockEnv();

/**
 * A stand-in for real Wit output.
 *
 * Sized deliberately: the provider rejects anything under 1.2 KB because that
 * is the byte length of the silence Wit returns for a script it cannot speak, so
 * an 8-byte fixture would trip the very guard these tests exist to exercise.
 */
function mp3(bytes = 4_096): Response {
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

/** The silence Wit actually returns for Hindi, Thai, Tamil and Telugu. */
function silence(): Response {
  return new Response(new Uint8Array(576), {
    status: 200,
    headers: { "Content-Type": "audio/mpeg" },
  });
}

type Captured = {
  auth: string;
  contentType: string;
  accept: string;
  body: Record<string, unknown>;
  calls: number;
};

/**
 * Intercepts the one upstream call and records what was actually sent, so these
 * assertions describe the wire format rather than a refactored local variable.
 */
function captureWit(respond: () => Response = mp3): () => Captured {
  const seen: Captured = {
    auth: "",
    contentType: "",
    accept: "",
    body: {},
    calls: 0,
  };
  server.use(
    http.post(PROVIDER_URLS.witaiSynthesize, async ({ request }) => {
      seen.calls += 1;
      seen.auth = request.headers.get("Authorization") ?? "";
      seen.contentType = request.headers.get("Content-Type") ?? "";
      seen.accept = request.headers.get("Accept") ?? "";
      seen.body = (await request.json()) as Record<string, unknown>;
      return respond();
    }),
  );
  return () => seen;
}

describe("Wit synthesis text on the wire", () => {
  test("sends text verbatim, with no language hint", async () => {
    // The endpoint does not parse a `<lang>` element — it speaks it. Asking for
    // Spanish produced audio of "LAND XML, LAND es igual a ESOLA" rather than
    // Spanish, so the hint was removed and the text goes out untouched.
    const captured = captureWit();

    const res = await tts("Bonjour", "fr", env, new AbortController().signal);

    expect(res.status).toBeNull();
    expect(captured().body.q).toBe("Bonjour");
  });

  test("sends Latin-script text unchanged for any language", async () => {
    const captured = captureWit();

    await tts("Hola, como estas?", "es", env, new AbortController().signal);

    expect(captured().body.q).toBe("Hola, como estas?");
  });

  test("never emits a <lang> or <speak> element", async () => {
    const captured = captureWit();

    await tts("Bonjour", "fr", env, new AbortController().signal);
    await tts("Hello", "en", env, new AbortController().signal);

    expect(captured().body.q).not.toContain("<lang");
    expect(captured().body.q).not.toContain("<speak>");
  });

  test("passes user text through without markup escaping", async () => {
    // With no wrapper there is no element for user text to break out of, so
    // escaping is no longer the provider's concern — the value is the text.
    const captured = captureWit();

    await tts('a & b <script> "q"', "de", env, new AbortController().signal);

    expect(captured().body.q).toBe('a & b <script> "q"');
  });

  test("treats the silence Wit returns for an unvoiced script as a miss", async () => {
    // Hindi, Thai, Tamil and Telugu all come back as the identical 576-byte
    // payload. Serving it would cache audio that plays nothing.
    captureWit(silence);

    const res = await tts("வணக்கம்", "ta", env, new AbortController().signal);

    expect(res.result).toBeNull();
    expect(res.status).toBe(502);
  });
});

describe("Wit synthesis credentials", () => {
  test("authenticates with the English key for every language", async () => {
    const captured = captureWit();

    await tts("வணக்கம்", "ta", env, new AbortController().signal);

    expect(captured().auth).toBe(`Bearer ${env.WIT_KEY_EN}`);
  });

  test("never reaches for the requested language's own key", async () => {
    const captured = captureWit();

    await tts("Bonjour", "fr", env, new AbortController().signal);

    expect(captured().auth).not.toBe(`Bearer ${env.WIT_KEY_FR}`);
    expect(captured().auth).not.toContain(env.WIT_KEY_ES);
  });

  test("does not walk the key pool after a 400", async () => {
    // Rotation is what turned one synthesis into ~66 upstream calls against a
    // 240/min budget shared with dictation. A rejected key must not be retried.
    const captured = captureWit(() =>
      HttpResponse.json({ code: "bad-request" }, { status: 400 }),
    );

    const res = await tts("வணக்கம்", "ta", env, new AbortController().signal);

    expect(captured().calls).toBe(1);
    expect(res.result).toBeNull();
  });

  test("skips synthesis entirely when no English key is configured", async () => {
    const captured = captureWit();
    const noEn = mockEnv({ WIT_KEY_EN: "" });

    const res = await tts("வணக்கம்", "ta", noEn, new AbortController().signal);

    expect(res.result).toBeNull();
    expect(res.status).toBeNull();
    expect(captured().calls).toBe(0);
  });

  test("will not borrow another language's key from a pool", async () => {
    // Dictation wants the permissive lookup, where any usable key beats none.
    // Synthesis does not: a Tamil key answers `400 Unsupported language for
    // synthesize`, so substituting it would fail every non-English request
    // while looking configured.
    const captured = captureWit();
    const taOnly = mockEnv({
      WIT_KEY_EN: "",
      WIT_KEY_TA: "mock-wit-ta-key-10",
    });

    const res = await tts(
      "வணக்கம்",
      "ta",
      taOnly,
      new AbortController().signal,
    );

    expect(res.result).toBeNull();
    expect(captured().calls).toBe(0);
  });

  test("uses the configured English key for any language", async () => {
    const captured = captureWit();
    const taOnly = mockEnv({ WIT_KEY_EN: "mock-wit-en-key-10" });

    const res = await tts(
      "வணக்கம்",
      "ta",
      taOnly,
      new AbortController().signal,
    );

    expect(res.result).not.toBeNull();
    expect(captured().auth).toBe("Bearer mock-wit-en-key-10");
  });
});

describe("Wit synthesis wire format", () => {
  test("posts JSON, because the endpoint rejects form encoding", async () => {
    const captured = captureWit();

    await tts("Hello.", "en", env, new AbortController().signal);

    expect(captured().contentType).toContain("application/json");
  });

  test("lets Accept pick the container instead of the ignored fformat field", async () => {
    const captured = captureWit();

    await tts("Hello.", "en", env, new AbortController().signal);

    expect(captured().accept).toBe("audio/mpeg");
    expect(captured().body.fformat).toBeUndefined();
  });

  test("returns the audio as mpeg", async () => {
    captureWit();

    const res = await tts("Hello.", "en", env, new AbortController().signal);

    expect(res.result?.mime).toBe("audio/mpeg");
    expect(res.result?.provider).toBe("witai");
    expect(res.result?.audio.byteLength).toBeGreaterThan(0);
  });

  test("declines empty text without calling upstream", async () => {
    const captured = captureWit();

    const res = await tts("   ", "en", env, new AbortController().signal);

    expect(res.result).toBeNull();
    expect(captured().calls).toBe(0);
  });
});
