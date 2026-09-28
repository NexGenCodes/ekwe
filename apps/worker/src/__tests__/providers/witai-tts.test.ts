import { describe, test, expect } from "vitest";
import { http, HttpResponse } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { mockEnv } from "@/__tests__/setup";
import { tts } from "@/providers/witai";

const env = mockEnv();

function mp3(): Response {
  const mp3 = new Uint8Array([0x49, 0x44, 0x33, 0x04, 0x00, 0x00, 0x00, 0x00]);
  return new Response(mp3, {
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

describe("Wit synthesis language hint", () => {
  test("wraps non-English text in the bare <lang> element", async () => {
    const captured = captureWit();

    const res = await tts("வணக்கம்", "ta", env, new AbortController().signal);

    expect(res.status).toBeNull();
    expect(captured().body.q).toBe('<lang xml:lang="ta">வணக்கம்</lang>');
  });

  test("does not use the <speak><lang> document form Wit rejects", async () => {
    const captured = captureWit();

    await tts("வணக்கம்", "ta", env, new AbortController().signal);

    expect(captured().body.q).not.toContain("<speak>");
  });

  test("sends English unwrapped, since it needs no hint", async () => {
    const captured = captureWit();

    await tts("Hello there.", "en", env, new AbortController().signal);

    expect(captured().body.q).toBe("Hello there.");
  });

  test("reduces a region tag to the base language Wit understands", async () => {
    const captured = captureWit();

    await tts("Bonjour", "fr-CA", env, new AbortController().signal);

    expect(captured().body.q).toBe('<lang xml:lang="fr">Bonjour</lang>');
  });

  test("escapes markup so user text cannot close the hint element", async () => {
    const captured = captureWit();

    await tts('a & b <script> "q"', "de", env, new AbortController().signal);

    expect(captured().body.q).toBe(
      '<lang xml:lang="de">a &amp; b &lt;script&gt; &quot;q&quot;</lang>',
    );
  });

  test("leaves escaped English untouched", async () => {
    const captured = captureWit();

    await tts("a & b", "en", env, new AbortController().signal);

    expect(captured().body.q).toBe("a & b");
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
    const poolOnly = mockEnv({
      WIT_KEY_EN: "",
      WIT_POOL_01: {
        get: async () => JSON.stringify({ TA: "mock-wit-pool-ta-key-10" }),
      },
    });

    const res = await tts(
      "வணக்கம்",
      "ta",
      poolOnly,
      new AbortController().signal,
    );

    expect(res.result).toBeNull();
    expect(captured().calls).toBe(0);
  });

  test("still finds the English key when it only exists in a pool", async () => {
    const captured = captureWit();
    const poolOnly = mockEnv({
      WIT_KEY_EN: "",
      WIT_POOL_01: {
        get: async () => JSON.stringify({ EN: "mock-wit-pool-en-key-10" }),
      },
    });

    const res = await tts(
      "வணக்கம்",
      "ta",
      poolOnly,
      new AbortController().signal,
    );

    expect(res.result).not.toBeNull();
    expect(captured().auth).toBe("Bearer mock-wit-pool-en-key-10");
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
