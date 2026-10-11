import { describe, expect, it } from "vitest";
import { ingestAudioUpload } from "@/services/audio";
import { getLimits } from "@/core/limits";

function multipart(
  file: Blob | null,
  fields: Record<string, string> = {},
  boundary = "----testboundary1234",
  includeDuration = true,
): Request {
  const parts: BlobPart[] = [];
  const allFields = includeDuration ? { duration: "1000", ...fields } : fields;
  for (const [k, v] of Object.entries(allFields)) {
    parts.push(
      new TextEncoder().encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`,
      ) as unknown as BlobPart,
    );
  }
  if (file) {
    parts.push(
      new TextEncoder().encode(
        `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="a.wav"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ) as unknown as BlobPart,
      file as unknown as BlobPart,
      new TextEncoder().encode(
        `\r\n--${boundary}--\r\n`,
      ) as unknown as BlobPart,
    );
  }
  return new Request("https://example.com/transcribe", {
    method: "POST",
    body: new Blob(parts),
    headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` },
  });
}

// oggS, then filler. Sniffing must key off the magic bytes, not the client type.
const OGG = new Blob([
  new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]),
  new Uint8Array(2048).fill(7),
]);

describe("ingestAudioUpload", () => {
  it("returns the audio re-typed from its magic bytes", async () => {
    const res = await ingestAudioUpload(multipart(OGG), "PREMIUM");
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.mimeType).toBe("audio/ogg");
    expect(res.value.audio.type).toBe("audio/ogg");
    expect(res.value.audio.size).toBe(OGG.size);
  });

  it("hashes the audio so identical uploads share a cache key", async () => {
    const a = await ingestAudioUpload(
      multipart(OGG, {}, "boundaryA"),
      "PREMIUM",
    );
    const b = await ingestAudioUpload(
      multipart(OGG, {}, "boundaryB"),
      "PREMIUM",
    );
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    // Different multipart boundaries, same audio — the key must still match or
    // the transcribe cache never hits.
    expect(a.value.audioHash).toBe(b.value.audioHash);
  });

  it("gives different audio different cache keys", async () => {
    const a = await ingestAudioUpload(multipart(OGG), "PREMIUM");
    const other = await ingestAudioUpload(
      multipart(new Blob([new Uint8Array(2048).fill(9)])),
      "PREMIUM",
    );
    expect(a.ok && other.ok).toBe(true);
    if (!a.ok || !other.ok) return;
    expect(a.value.audioHash).not.toBe(other.value.audioHash);
  });

  it("rejects a malformed multipart body with 400, not 500", async () => {
    const req = new Request("https://example.com/transcribe", {
      method: "POST",
      body: "not multipart at all",
      headers: { "Content-Type": "multipart/form-data; boundary=zzz" },
    });
    const res = await ingestAudioUpload(req, "PREMIUM");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    // Mobile clients retry 5xx, so this must not be a server error.
    expect(res.response.status).toBe(400);
  });

  it("rejects a missing file part", async () => {
    const res = await ingestAudioUpload(
      multipart(null, { lang: "en" }),
      "PREMIUM",
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(400);
  });

  it("rejects an empty file part", async () => {
    const res = await ingestAudioUpload(multipart(new Blob([])), "PREMIUM");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(400);
  });

  it("rejects an oversized file with 413", async () => {
    const big = new Blob([
      new Uint8Array(getLimits("PREMIUM").maxAudioBytes + 1),
    ]);
    const res = await ingestAudioUpload(multipart(big), "PREMIUM");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(413);
  });

  it("reads the duration field", async () => {
    const res = await ingestAudioUpload(
      multipart(OGG, { duration: "1234", lang: "en" }),
      "PREMIUM",
    );
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.value.durationMs).toBe(1234);
    expect(res.value.form.get("lang")).toBe("en");
  });

  it("rejects a missing duration with 400", async () => {
    const res = await ingestAudioUpload(
      multipart(OGG, { lang: "en" }, "----nodur", false),
      "PREMIUM",
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(400);
    const body = (await res.response.json()) as { error?: string };
    expect(body.error).toBe("MISSING_DURATION");
  });

  it("rejects a zero duration with 400", async () => {
    const res = await ingestAudioUpload(
      multipart(OGG, { duration: "0", lang: "en" }),
      "PREMIUM",
    );
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(400);
    const body = (await res.response.json()) as { error?: string };
    expect(body.error).toBe("MISSING_DURATION");
  });

  it("rejects a non-multipart content type with 415", async () => {
    const req = new Request("https://example.com/transcribe", {
      method: "POST",
      body: "{}",
      headers: { "Content-Type": "application/json" },
    });
    const res = await ingestAudioUpload(req, "PREMIUM");
    expect(res.ok).toBe(false);
    if (res.ok) return;
    expect(res.response.status).toBe(415);
  });
});
