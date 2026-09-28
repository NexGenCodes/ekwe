import { describe, test, expect } from "vitest";
import { http } from "msw";
import { server } from "@/__tests__/msw/server";
import { PROVIDER_URLS } from "@/__tests__/msw/handlers";
import { mockEnv } from "@/__tests__/setup";
import { tts } from "@/providers/deepgram";

const env = mockEnv();

// An Ogg page plus the `OggS` magic, so the assertion is about the real request
// and not about a stub's bookkeeping.
const oggBytes = new Uint8Array([
  0x4f, 0x67, 0x67, 0x53, 0x00, 0x02, 0x00, 0x00,
]);

type Seen = { url: URL; accept: string; contentType: string; calls: number };

function captureSpeak(respond: () => Response = () => ogg()): () => Seen {
  const seen: Seen = {
    url: new URL("https://api.deepgram.com/v1/speak"),
    accept: "",
    contentType: "",
    calls: 0,
  };
  server.use(
    http.post(PROVIDER_URLS.deepgramSpeak, ({ request }) => {
      seen.calls += 1;
      seen.url = new URL(request.url);
      seen.accept = request.headers.get("Accept") ?? "";
      seen.contentType = request.headers.get("Content-Type") ?? "";
      return respond();
    }),
  );
  return () => seen;
}

function ogg(): Response {
  return new Response(oggBytes, {
    status: 200,
    headers: { "Content-Type": "audio/ogg" },
  });
}

describe("Deepgram synthesis container", () => {
  test("asks for Ogg/Opus, the format shared voice notes require", async () => {
    // WhatsApp and Telegram want `audio/ogg; codecs=opus` from the shared
    // artifact. Requesting MP3 and transcoding on device is the slower path.
    const seen = captureSpeak();

    await tts("Hello.", "en", env, new AbortController().signal);

    expect(seen().url.searchParams.get("encoding")).toBe("opus");
    expect(seen().url.searchParams.get("container")).toBe("ogg");
  });

  test("declares the same container in Accept", async () => {
    const seen = captureSpeak();

    await tts("Hello.", "en", env, new AbortController().signal);

    expect(seen().accept).toBe("audio/ogg;codecs=opus");
  });

  test("still pins a model, since the query is hand-built", async () => {
    const seen = captureSpeak();

    await tts("Hello.", "en", env, new AbortController().signal);

    expect(seen().url.searchParams.get("model")).toBeTruthy();
    expect(seen().url.search).toContain("&encoding=opus");
  });

  test("returns the mime the client maps to a shareable Ogg", async () => {
    captureSpeak();

    const res = await tts("Hello.", "en", env, new AbortController().signal);

    expect(res.result?.mime).toBe("audio/ogg;codecs=opus");
    expect(res.result?.provider).toBe("deepgram");
  });

  test("declines empty text without calling upstream", async () => {
    const seen = captureSpeak();

    const res = await tts("  ", "en", env, new AbortController().signal);

    expect(res.result).toBeNull();
    expect(seen().calls).toBe(0);
  });
});
