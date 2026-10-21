import { connect } from "cloudflare:sockets";
import { logger } from "@/core/logger";
import { Env, SpeechAttempt } from "@/core/types";
import { generateSecMsGecV2 } from "@/providers/edgeDrm";
import { bytesToBase64 } from "@/utils/base64";
import { withTimeout } from "@/utils/timeout";

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const BING_HOST = "speech.platform.bing.com";
const READALOUD_PATH = "/consumer/speech/synthesize/readaloud/edge/v1";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
// The service rejects the v1 token with 403 regardless of host. The version
// prefix selects the token format, so it must stay in step with the generator.
const SEC_MS_GEC_VERSION = `2-${CHROMIUM_FULL_VERSION}`;
const AUDIO_FORMAT = "audio-24khz-48kbitrate-mono-mp3";
const WS_MAGIC_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";

const DEFAULT_VOICE = "en-US-AvaMultilingualNeural";

interface EdgeVoiceSet {
  female: string[];
  male: string[];
}

const EDGE_FALLBACK_VOICES: EdgeVoiceSet = {
  female: ["en-US-AvaMultilingualNeural"],
  male: ["en-US-AndrewMultilingualNeural"],
};

const EDGE_VOICES: Record<string, EdgeVoiceSet> = {
  af: { female: ["af-ZA-AdriNeural"], male: ["af-ZA-WillemNeural"] },
  am: { female: ["am-ET-MekdesNeural"], male: ["am-ET-AmehaNeural"] },
  ar: { female: ["ar-SA-ZariyahNeural"], male: ["ar-SA-HamedNeural"] },
  az: { female: ["az-AZ-BanuNeural"], male: ["az-AZ-BabekNeural"] },
  bg: { female: ["bg-BG-KalinaNeural"], male: ["bg-BG-BorislavNeural"] },
  bn: { female: ["bn-BD-NabanitaNeural"], male: ["bn-BD-PradeepNeural"] },
  bs: { female: ["bs-BA-VesnaNeural"], male: ["bs-BA-GoranNeural"] },
  ca: { female: ["ca-ES-JoanaNeural"], male: ["ca-ES-EnricNeural"] },
  cs: { female: ["cs-CZ-VlastaNeural"], male: ["cs-CZ-AntoninNeural"] },
  cy: { female: ["cy-GB-NiaNeural"], male: ["cy-GB-AledNeural"] },
  da: { female: ["da-DK-ChristelNeural"], male: ["da-DK-JeppeNeural"] },
  de: {
    female: ["de-DE-SeraphinaMultilingualNeural", "de-DE-AmalaNeural"],
    male: ["de-DE-FlorianMultilingualNeural", "de-DE-ConradNeural"],
  },
  el: { female: ["el-GR-AthinaNeural"], male: ["el-GR-NestorasNeural"] },
  en: {
    female: ["en-US-AvaMultilingualNeural", "en-US-EmmaMultilingualNeural"],
    male: ["en-US-AndrewMultilingualNeural", "en-US-BrianMultilingualNeural"],
  },
  es: {
    female: ["es-ES-XimenaNeural", "es-ES-ElviraNeural"],
    male: ["es-ES-AlvaroNeural"],
  },
  et: { female: ["et-EE-AnuNeural"], male: ["et-EE-KertNeural"] },
  fa: { female: ["fa-IR-DilaraNeural"], male: ["fa-IR-FaridNeural"] },
  fi: { female: ["fi-FI-NooraNeural"], male: ["fi-FI-HarriNeural"] },
  fr: {
    female: ["fr-FR-VivienneMultilingualNeural", "fr-FR-DeniseNeural"],
    male: ["fr-FR-RemyMultilingualNeural", "fr-FR-HenriNeural"],
  },
  ga: { female: ["ga-IE-OrlaNeural"], male: ["ga-IE-ColmNeural"] },
  gl: { female: ["gl-ES-SabelaNeural"], male: ["gl-ES-RoiNeural"] },
  gu: { female: ["gu-IN-DhwaniNeural"], male: ["gu-IN-NiranjanNeural"] },
  he: { female: ["he-IL-HilaNeural"], male: ["he-IL-AvriNeural"] },
  hi: { female: ["hi-IN-SwaraNeural"], male: ["hi-IN-MadhurNeural"] },
  hr: { female: ["hr-HR-GabrijelaNeural"], male: ["hr-HR-SreckoNeural"] },
  hu: { female: ["hu-HU-NoemiNeural"], male: ["hu-HU-TamasNeural"] },
  id: { female: ["id-ID-GadisNeural"], male: ["id-ID-ArdiNeural"] },
  is: { female: ["is-IS-GudrunNeural"], male: ["is-IS-GunnarNeural"] },
  it: {
    female: ["it-IT-ElsaNeural", "it-IT-IsabellaNeural"],
    male: ["it-IT-GiuseppeMultilingualNeural", "it-IT-DiegoNeural"],
  },
  ja: { female: ["ja-JP-NanamiNeural"], male: ["ja-JP-KeitaNeural"] },
  jv: { female: ["jv-ID-SitiNeural"], male: ["jv-ID-DimasNeural"] },
  ka: { female: ["ka-GE-EkaNeural"], male: ["ka-GE-GiorgiNeural"] },
  kk: { female: ["kk-KZ-AigulNeural"], male: ["kk-KZ-DauletNeural"] },
  km: { female: ["km-KH-SreymomNeural"], male: ["km-KH-PisethNeural"] },
  kn: { female: ["kn-IN-SapnaNeural"], male: ["kn-IN-GaganNeural"] },
  ko: {
    female: ["ko-KR-SunHiNeural"],
    male: ["ko-KR-HyunsuMultilingualNeural", "ko-KR-InJoonNeural"],
  },
  lo: { female: ["lo-LA-KeomanyNeural"], male: ["lo-LA-ChanthavongNeural"] },
  lt: { female: ["lt-LT-OnaNeural"], male: ["lt-LT-LeonasNeural"] },
  lv: { female: ["lv-LV-EveritaNeural"], male: ["lv-LV-NilsNeural"] },
  mk: { female: ["mk-MK-MarijaNeural"], male: ["mk-MK-AleksandarNeural"] },
  ml: { female: ["ml-IN-SobhanaNeural"], male: ["ml-IN-MidhunNeural"] },
  mn: { female: ["mn-MN-YesuiNeural"], male: ["mn-MN-BataaNeural"] },
  mr: { female: ["mr-IN-AarohiNeural"], male: ["mr-IN-ManoharNeural"] },
  ms: { female: ["ms-MY-YasminNeural"], male: ["ms-MY-OsmanNeural"] },
  mt: { female: ["mt-MT-GraceNeural"], male: ["mt-MT-JosephNeural"] },
  my: { female: ["my-MM-NilarNeural"], male: ["my-MM-ThihaNeural"] },
  nb: { female: ["nb-NO-PernilleNeural"], male: ["nb-NO-FinnNeural"] },
  ne: { female: ["ne-NP-HemkalaNeural"], male: ["ne-NP-SagarNeural"] },
  nl: {
    female: ["nl-NL-ColetteNeural", "nl-NL-FennaNeural"],
    male: ["nl-NL-MaartenNeural"],
  },
  no: { female: ["nb-NO-PernilleNeural"], male: ["nb-NO-FinnNeural"] },
  pl: { female: ["pl-PL-ZofiaNeural"], male: ["pl-PL-MarekNeural"] },
  ps: { female: ["ps-AF-LatifaNeural"], male: ["ps-AF-GulNawazNeural"] },
  pt: {
    female: ["pt-BR-ThalitaMultilingualNeural", "pt-BR-FranciscaNeural"],
    male: ["pt-BR-AntonioNeural"],
  },
  ro: { female: ["ro-RO-AlinaNeural"], male: ["ro-RO-EmilNeural"] },
  ru: { female: ["ru-RU-SvetlanaNeural"], male: ["ru-RU-DmitryNeural"] },
  si: { female: ["si-LK-ThiliniNeural"], male: ["si-LK-SameeraNeural"] },
  sk: { female: ["sk-SK-ViktoriaNeural"], male: ["sk-SK-LukasNeural"] },
  sl: { female: ["sl-SI-PetraNeural"], male: ["sl-SI-RokNeural"] },
  so: { female: ["so-SO-UbaxNeural"], male: ["so-SO-MuuseNeural"] },
  sq: { female: ["sq-AL-AnilaNeural"], male: ["sq-AL-IlirNeural"] },
  sr: { female: ["sr-RS-SophieNeural"], male: ["sr-RS-NicholasNeural"] },
  su: { female: ["su-ID-TutiNeural"], male: ["su-ID-JajangNeural"] },
  sv: { female: ["sv-SE-SofieNeural"], male: ["sv-SE-MattiasNeural"] },
  sw: { female: ["sw-KE-ZuriNeural"], male: ["sw-KE-RafikiNeural"] },
  ta: { female: ["ta-IN-PallaviNeural"], male: ["ta-IN-ValluvarNeural"] },
  te: { female: ["te-IN-ShrutiNeural"], male: ["te-IN-MohanNeural"] },
  th: { female: ["th-TH-PremwadeeNeural"], male: ["th-TH-NiwatNeural"] },
  tl: { female: ["fil-PH-BlessicaNeural"], male: ["fil-PH-AngeloNeural"] },
  tr: { female: ["tr-TR-EmelNeural"], male: ["tr-TR-AhmetNeural"] },
  uk: { female: ["uk-UA-PolinaNeural"], male: ["uk-UA-OstapNeural"] },
  ur: { female: ["ur-PK-UzmaNeural"], male: ["ur-PK-AsadNeural"] },
  uz: { female: ["uz-UZ-MadinaNeural"], male: ["uz-UZ-SardorNeural"] },
  vi: { female: ["vi-VN-HoaiMyNeural"], male: ["vi-VN-NamMinhNeural"] },
  yue: {
    female: ["zh-HK-HiuGaaiNeural", "zh-HK-HiuMaanNeural"],
    male: ["zh-HK-WanLungNeural"],
  },
  zh: {
    female: ["zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural"],
    male: ["zh-CN-YunxiNeural", "zh-CN-YunjianNeural"],
  },
  zu: { female: ["zu-ZA-ThandoNeural"], male: ["zu-ZA-ThembaNeural"] },
};

/**
 * The locales Edge actually has Neural voices for.
 *
 * This is the source of truth the shared capability list has to agree with. A
 * locale missing from here is not a lesser voice, it is the English
 * multilingual fallback, so it must not be advertised as Edge coverage.
 */
export const EDGE_LOCALE_CODES: readonly string[] = Object.keys(EDGE_VOICES);

/**
 * Index 0 is the Clear voice and index 1 the Warm voice, matching the persona
 * contract the slot pools assume. Most locales list only one voice per gender,
 * so the Warm persona simply has no Edge candidate there and the resolver skips
 * it — which is correct: Edge is the safety net, not the voice's identity.
 *
 * No `languageCode` equivalent is set: the catalogue is keyed by locale and the
 * model reads the text as written.
 */
export function voices(
  gender: "male" | "female" | undefined,
  langCode: string,
): string[] {
  const set = EDGE_VOICES[langCode] ?? EDGE_FALLBACK_VOICES;
  if (gender) return [...(gender === "male" ? set.male : set.female)];
  // No preference: the female list's heads (Jenny, Ava) are the most widely
  // supported names on the service.
  return [...set.female];
}

const MAX_SPEECH_BYTES = 8 * 1024 * 1024;
const SOCKET_CONNECT_TIMEOUT_MS = 8_000;
const TURN_TIMEOUT_MS = 15_000;

const OPCODE_TEXT = 0x1;
const OPCODE_BINARY = 0x2;
const OPCODE_CLOSE = 0x8;
const OPCODE_PING = 0x9;
const OPCODE_PONG = 0xa;

const CRLFCRLF = new Uint8Array([13, 10, 13, 10]);

function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function removeInvalidXmlCharacters(text: string): string {
  // eslint-disable-next-line no-control-regex
  const controlChars = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g;
  return text.replace(controlChars, " ");
}

function normalizeVoiceName(voice: string): string {
  const trimmed = voice.trim();

  if (trimmed.startsWith("Microsoft Server Speech Text to Speech Voice")) {
    return trimmed;
  }

  const providerMatch = /^([a-z]{2,}-[A-Z]{2,})-([^:]+):.+Neural$/.exec(
    trimmed,
  );
  if (providerMatch) {
    const [, locale, baseName] = providerMatch;
    return normalizeVoiceName(`${locale}-${baseName}Neural`);
  }

  const shortMatch = /^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/.exec(trimmed);
  if (!shortMatch) return trimmed;

  const lang = shortMatch[1];
  let region = shortMatch[2];
  let name = shortMatch[3];
  if (name.includes("-")) {
    const [regionSuffix, ...nameParts] = name.split("-");
    region += `-${regionSuffix}`;
    name = nameParts.join("-");
  }
  return `Microsoft Server Speech Text to Speech Voice (${lang}-${region}, ${name})`;
}

function timestamp(): string {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, -1);
}

function makeConnectionId(): string {
  return crypto.randomUUID().replace(/-/g, "");
}

function makeMuid(): string {
  return crypto.randomUUID().replace(/-/g, "").toUpperCase().slice(0, 32);
}

function buildSynthesisUrl(
  secMsGec: string,
  connectionId: string,
  trustedToken: string,
): string {
  const url = new URL(`wss://${BING_HOST}${READALOUD_PATH}`);
  url.searchParams.set("TrustedClientToken", trustedToken);
  url.searchParams.set("Sec-MS-GEC", secMsGec);
  url.searchParams.set("Sec-MS-GEC-Version", SEC_MS_GEC_VERSION);
  url.searchParams.set("ConnectionId", connectionId);
  return url.toString();
}

function buildSpeechConfigMessage(): string {
  return (
    `X-Timestamp:${timestamp()}\r\n` +
    `Content-Type:application/json; charset=utf-8\r\n` +
    `Path:speech.config\r\n\r\n` +
    `    {"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"false"},"outputFormat":"${AUDIO_FORMAT}"}}}}\r\n`
  );
}

function buildSsmlMessage(
  requestId: string,
  voiceName: string,
  text: string,
): string {
  const xmlLang = /\(([^,]+),/.exec(voiceName)?.[1] ?? "en-US";
  const ssml =
    `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='${xmlLang}'>` +
    `<voice name='${voiceName}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>` +
    `${escapeXml(removeInvalidXmlCharacters(text))}</prosody></voice></speak>`;
  return (
    `X-RequestId:${requestId}\r\n` +
    `Content-Type:application/ssml+xml\r\n` +
    `X-Timestamp:${timestamp()}Z\r\n` +
    `Path:ssml\r\n\r\n${ssml}`
  );
}

function parseTextHeaders(textFrame: string): Record<string, string[]> {
  const headers: Record<string, string[]> = {};
  const lines = textFrame.split("\r\n");
  for (const line of lines) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (!headers[key]) headers[key] = [];
    headers[key].push(value);
  }
  return headers;
}

const HEADER_DECODER = new TextDecoder();

/**
 * A binary frame is `uint16 headerLength | header text | CRLF | body`, where the
 * length counts its own two-byte prefix and the body runs to the end of the
 * frame — there is no body-length field. Treating the MP3's leading `ff f3`
 * frame sync as one decodes as a 65523-byte length, so the parse overshoots and
 * yields nothing.
 */
export function extractAudioSegment(data: Uint8Array): Uint8Array | null {
  if (data.length < 4) return null;

  const headerLength = (data[0] << 8) | data[1];
  if (headerLength < 2) return null;

  // 2 (own prefix) + (headerLength - 2) (text) + 2 (CRLF)
  const bodyStart = headerLength + 2;
  if (bodyStart > data.length) return null;

  const headers = parseTextHeaders(
    HEADER_DECODER.decode(data.subarray(2, bodyStart - 2)),
  );
  if (headers["Path"]?.[0] !== "audio") return null;
  if (!headers["Content-Type"]?.[0]?.includes("audio/mpeg")) return null;

  const body = data.subarray(bodyStart);
  return body.length > 0 ? body : null;
}

function concatBytes(parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const total = parts.reduce((sum, c) => sum + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of parts) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

function indexOf(hay: Uint8Array, needle: Uint8Array): number {
  outer: for (let i = 0; i + needle.length <= hay.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (hay[i + j] !== needle[j]) continue outer;
    }
    return i;
  }
  return -1;
}

interface WsFrame {
  opcode: number;
  payload: Uint8Array;
}

class FrameReader {
  private chunks: Uint8Array[] = [];
  private totalBytes = 0;

  private constructor(
    private reader: ReadableStreamDefaultReader<Uint8Array>,
  ) {}

  static lock(stream: ReadableStream): FrameReader {
    const reader =
      stream.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    return new FrameReader(reader);
  }

  async readExact(bytes: number): Promise<Uint8Array | null> {
    while (this.totalBytes < bytes) {
      const { value, done } = await this.reader.read();
      if (done || !value) {
        if (this.totalBytes === 0) return null;
        break;
      }
      this.chunks.push(value);
      this.totalBytes += value.length;
    }
    if (this.totalBytes < bytes) return null;

    const out = new Uint8Array(bytes);
    let outOffset = 0;

    while (outOffset < bytes) {
      const chunk = this.chunks[0];
      const needed = bytes - outOffset;
      if (chunk.length <= needed) {
        out.set(chunk, outOffset);
        outOffset += chunk.length;
        this.totalBytes -= chunk.length;
        this.chunks.shift();
      } else {
        out.set(chunk.subarray(0, needed), outOffset);
        outOffset += needed;
        this.chunks[0] = chunk.subarray(needed);
        this.totalBytes -= needed;
      }
    }
    return out;
  }

  async readUpTo(maxBytes: number): Promise<Uint8Array> {
    if (this.totalBytes > 0) {
      return this.readExact(
        Math.min(maxBytes, this.totalBytes),
      ) as Promise<Uint8Array>;
    }
    const { value, done } = await this.reader.read();
    if (done || !value) return new Uint8Array(0);
    if (value.length <= maxBytes) return value;

    const out = value.subarray(0, maxBytes);
    this.chunks.push(value.subarray(maxBytes));
    this.totalBytes += value.length - maxBytes;
    return out;
  }

  prepend(data: Uint8Array<ArrayBuffer>): void {
    if (data.length === 0) return;
    this.chunks.unshift(data);
    this.totalBytes += data.length;
  }

  release(): void {
    this.reader.releaseLock();
  }
}

function maskFrame(payload: Uint8Array, opcode: number): Uint8Array {
  const key = crypto.getRandomValues(new Uint8Array(4));
  const masked = new Uint8Array(payload.length);
  for (let i = 0; i < payload.length; i++) masked[i] = payload[i] ^ key[i % 4];

  let hdr: number[];
  if (payload.length < 126) {
    hdr = [0x80 | opcode, 0x80 | payload.length];
  } else if (payload.length < 65536) {
    hdr = [
      0x80 | opcode,
      0x80 | 126,
      payload.length >> 8,
      payload.length & 0xff,
    ];
  } else {
    const len = new Uint8Array(8);
    new DataView(len.buffer).setUint32(4, payload.length);
    hdr = [0x80 | opcode, 0x80 | 127, ...len];
  }
  return concatBytes([new Uint8Array(hdr), key, masked]);
}

async function readFrame(reader: FrameReader): Promise<WsFrame | null> {
  const h = await reader.readExact(2);
  if (!h) return null;
  const opcode = h[0] & 0x0f;
  const masked = (h[1] & 0x80) !== 0;
  let len = h[1] & 0x7f;
  if (len === 126) {
    const e = await reader.readExact(2);
    if (!e) return null;
    len = (e[0] << 8) | e[1];
  } else if (len === 127) {
    const e = await reader.readExact(8);
    if (!e) return null;
    const hi = (e[0] << 24) | (e[1] << 16) | (e[2] << 8) | e[3];
    const lo = (e[4] << 24) | (e[5] << 16) | (e[6] << 8) | e[7];
    len = hi * 0x100000000 + (lo >>> 0);
  }
  if (opcode >= 0x8 && len > 125) return null;
  let mask: Uint8Array | null = null;
  if (masked) mask = await reader.readExact(4);
  const payload = await reader.readExact(len);
  if (!payload) return null;
  if (mask) {
    for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i % 4];
  }
  return { opcode, payload };
}

class EdgeUpgradeError extends Error {
  readonly status: number;
  constructor(status: number, statusLine: string) {
    super(`Edge TTS: upgrade rejected (${statusLine})`);
    this.name = "EdgeUpgradeError";
    this.status = status;
  }
}

function parseHttpStatus(statusLine: string): number {
  const match = /^\S+\s+(\d{3})/.exec(statusLine);
  return match ? Number(match[1]) : 0;
}

class EdgeWsSession {
  private constructor(
    private writer: WritableStreamDefaultWriter<Uint8Array>,
    private frames: FrameReader,
    private tls: Socket,
  ) {}

  static async open(upgradeUrl: string): Promise<EdgeWsSession> {
    const source = connect(
      { hostname: BING_HOST, port: 443 },
      { secureTransport: "starttls", allowHalfOpen: true },
    );
    const tls = source.startTls();
    const writer =
      tls.writable.getWriter() as WritableStreamDefaultWriter<Uint8Array>;
    const frames = FrameReader.lock(tls.readable);

    const key = bytesToBase64(crypto.getRandomValues(new Uint8Array(16)));
    const requestTarget = upgradeUrl.replace(/^wss:\/\//, "");
    const request = [
      `GET /${requestTarget.slice(requestTarget.indexOf("/") + 1)} HTTP/1.1`,
      `Host: ${BING_HOST}:443`,
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Key: ${key}`,
      "Sec-WebSocket-Version: 13",
      "User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36 Edg/143.0.0.0",
      "Origin: chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold",
      "Accept-Encoding: gzip, deflate, br, zstd",
      "Pragma: no-cache",
      "Cache-Control: no-cache",
      "Accept-Language: en-US,en;q=0.9",
      `Cookie: muid=${makeMuid()};`,
      "",
      "",
    ].join("\r\n");

    try {
      await writer.write(new TextEncoder().encode(request));

      const headBuffer: Uint8Array[] = [];
      let head: string | null = null;
      let leftover: Uint8Array<ArrayBuffer> | null = null;
      const decoder = new TextDecoder();
      while (head === null) {
        const chunk = await frames.readUpTo(2048);
        if (chunk.length === 0) break;
        headBuffer.push(chunk);
        const joined = concatBytes(headBuffer);
        const idx = indexOf(joined, CRLFCRLF);
        if (idx >= 0) {
          head = decoder.decode(joined.subarray(0, idx));
          leftover = joined.subarray(idx + 4);
        }
      }
      if (!head) throw new Error("Edge TTS: no upgrade response");
      if (leftover && leftover.length > 0) frames.prepend(leftover);

      const statusLine = head.split("\r\n")[0];
      if (!statusLine.includes(" 101 ")) {
        throw new EdgeUpgradeError(parseHttpStatus(statusLine), statusLine);
      }

      const acceptHeader = /^sec-websocket-accept\s*:\s*(.+)$/im
        .exec(head)?.[1]
        ?.trim();
      if (!acceptHeader) {
        throw new Error(
          "Edge TTS: upgrade response missing Sec-WebSocket-Accept",
        );
      }

      const digest = new Uint8Array(
        await crypto.subtle.digest(
          "SHA-1",
          new TextEncoder().encode(`${key}${WS_MAGIC_GUID}`),
        ),
      );
      if (bytesToBase64(digest) !== acceptHeader) {
        throw new Error("Edge TTS: Sec-WebSocket-Accept mismatch");
      }
      return new EdgeWsSession(writer, frames, tls);
    } catch (err) {
      try {
        await tls.close();
      } catch {
        // already closed or errored
      }
      throw err;
    }
  }

  async sendText(text: string): Promise<void> {
    await this.writer.write(
      maskFrame(new TextEncoder().encode(text), OPCODE_TEXT),
    );
  }

  async sendFrame(payload: Uint8Array, opcode: number): Promise<void> {
    await this.writer.write(maskFrame(payload, opcode));
  }

  async readFrame(): Promise<WsFrame | null> {
    return readFrame(this.frames);
  }

  async teardown(): Promise<void> {
    try {
      await this.writer.close();
    } catch {
      // already closed or errored
    }
    try {
      this.frames.release();
    } catch {
      // reader may already be released
    }
    try {
      await this.tls.close();
    } catch {
      // already closed or errored
    }
  }
}

// The Edge read-aloud endpoint silently truncates a turn at ~600 s of audio,
// and every turn costs a fresh TCP + TLS + WebSocket handshake. Mainstream
// clients therefore cap each turn at 4096 bytes of escaped text
// (rany2/edge-tts PR #394). Budget against escaped UTF-8 bytes rather than
// characters: CJK costs 3 bytes and XML entities up to 6, so a character
// count under-uses the budget for Latin text and overshoots it for CJK.
const CHUNK_BUDGET_BYTES = 3584;

const XML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&apos;",
};

function escapedByteLength(ch: string): number {
  const escaped = XML_ESCAPES[ch];
  if (escaped !== undefined) return escaped.length;
  const code = ch.codePointAt(0) ?? 0;
  if (code < 0x80) return 1;
  if (code < 0x800) return 2;
  if (code < 0x10000) return 3;
  return 4;
}

function escapedByteLengthOf(text: string): number {
  let total = 0;
  for (const ch of text) total += escapedByteLength(ch);
  return total;
}

function hardSplit(text: string): string[] {
  const parts: string[] = [];
  let run = "";
  let runBytes = 0;
  for (const ch of text) {
    const size = escapedByteLength(ch);
    if (run && runBytes + size > CHUNK_BUDGET_BYTES) {
      parts.push(run);
      run = "";
      runBytes = 0;
    }
    run += ch;
    runBytes += size;
  }
  if (run) parts.push(run);
  return parts;
}

function splitSpeechChunks(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed || escapedByteLengthOf(trimmed) <= CHUNK_BUDGET_BYTES) {
    return [trimmed];
  }

  const sentenceRe = /[^.!?।！？。…؛؟]+[.!?।！？。…؛؟]*\s*/g;
  const sentences = trimmed.match(sentenceRe) ?? [trimmed];
  const chunks: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const sentence of sentences) {
    const s = sentence.trim();
    if (!s) continue;
    const weight = escapedByteLengthOf(s);
    if (weight > CHUNK_BUDGET_BYTES) {
      if (current) {
        chunks.push(current);
        current = "";
        currentBytes = 0;
      }
      chunks.push(...hardSplit(s));
      continue;
    }
    if (current && currentBytes + 1 + weight > CHUNK_BUDGET_BYTES) {
      chunks.push(current);
      current = s;
      currentBytes = weight;
    } else {
      if (current) currentBytes += 1;
      current = current ? `${current} ${s}` : s;
      currentBytes += weight;
    }
  }
  if (current) chunks.push(current);
  return chunks.filter(Boolean);
}

async function synthOnce(
  text: string,
  voiceName: string,
  token: string,
  signal: AbortSignal,
): Promise<SpeechAttempt> {
  const gec = generateSecMsGecV2();
  const connectionId = makeConnectionId();
  const upgradeUrl = buildSynthesisUrl(gec, connectionId, token);

  let session: EdgeWsSession;
  try {
    session = await withTimeout(
      SOCKET_CONNECT_TIMEOUT_MS,
      "connect timeout",
      signal,
      () => EdgeWsSession.open(upgradeUrl),
    );
  } catch (err) {
    logger.error("[speech:edge] Upgrade failed", {
      error: err instanceof Error ? err.message : String(err),
    });
    if (err instanceof EdgeUpgradeError)
      return { result: null, status: err.status };
    return { result: null, status: null };
  }
  logger.info("[speech:edge] Connection open", { connectionId });

  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let settled = false;

  const result = await new Promise<SpeechAttempt>((resolve) => {
    let turnTimer: ReturnType<typeof setTimeout> | undefined;
    const clearTurnTimer = (): void => {
      if (turnTimer !== undefined) clearTimeout(turnTimer);
    };
    const finish = (attempt: SpeechAttempt): void => {
      if (settled) return;
      settled = true;
      clearTurnTimer();
      signal.removeEventListener("abort", onAbort);
      resolve(attempt);
    };
    const onAbort = () => finish({ result: null, status: null });
    signal.addEventListener("abort", onAbort);

    const armTurnTimer = (): void => {
      clearTurnTimer();
      turnTimer = setTimeout(() => {
        logger.warn("[speech:edge] Turn timeout");
        finish({ result: null, status: null });
      }, TURN_TIMEOUT_MS);
    };

    void (async () => {
      try {
        await session.sendText(buildSpeechConfigMessage());
        const requestId = makeConnectionId();
        await session.sendText(buildSsmlMessage(requestId, voiceName, text));
        logger.info("[speech:edge] Header + SSML sent", { requestId });

        armTurnTimer();
        while (!settled) {
          const frame = await session.readFrame();
          if (!frame) break;
          armTurnTimer();

          if (frame.opcode === OPCODE_TEXT) {
            const path = parseTextHeaders(
              new TextDecoder().decode(frame.payload),
            )["Path"]?.[0];
            if (path === "turn.start") {
              logger.info("[speech:edge] turn.start");
            } else if (path === "turn.end") {
              logger.info("[speech:edge] turn.end");
              await session.sendFrame(new Uint8Array(0), OPCODE_CLOSE);
              break;
            }
          } else if (frame.opcode === OPCODE_BINARY) {
            const segment = extractAudioSegment(frame.payload);
            if (segment) {
              bytes += segment.length;
              if (bytes > MAX_SPEECH_BYTES) {
                logger.warn("[speech:edge] Output exceeds size cap");
                finish({ result: null, status: null });
                return;
              }
              if (chunks.length === 0) {
                logger.info("[speech:edge] First audio frame");
              }
              chunks.push(segment);
            }
          } else if (frame.opcode === OPCODE_PING) {
            await session.sendFrame(frame.payload, OPCODE_PONG);
          } else if (frame.opcode === OPCODE_CLOSE) {
            break;
          }
        }

        if (settled) return;
        if (bytes > 0) {
          logger.info("[speech:edge] Complete", { bytes });
          finish({
            result: {
              audio: concatBytes(chunks),
              mime: "audio/mpeg",
              provider: "edge",
            },
            status: null,
          });
        } else {
          logger.warn("[speech:edge] Closed before audio");
          finish({ result: null, status: null });
        }
      } catch (err) {
        if (settled) return;
        logger.error("[speech:edge] Session error", {
          error: err instanceof Error ? err.message : String(err),
        });
        finish({ result: null, status: null });
      }
    })();
  });

  await session.teardown();
  return result;
}

export async function tts(
  text: string,
  env: Env,
  signal: AbortSignal,
  voice?: string,
): Promise<SpeechAttempt> {
  if (signal.aborted) return { result: null, status: null };
  if (!text || !text.trim()) return { result: null, status: null };

  const trustedToken = env.EDGE_CLIENT_TOKEN ?? TRUSTED_CLIENT_TOKEN;
  const voiceName = normalizeVoiceName(voice ?? DEFAULT_VOICE);
  const turns = splitSpeechChunks(text);
  const audio: Uint8Array[] = [];
  let bytes = 0;

  for (const turn of turns) {
    if (signal.aborted) return { result: null, status: null };
    const attempt = await synthOnce(turn, voiceName, trustedToken, signal);
    if (!attempt.result) return attempt;
    bytes += attempt.result.audio.byteLength;
    if (bytes > MAX_SPEECH_BYTES) {
      logger.warn("[speech:edge] Output exceeds size cap");
      return { result: null, status: null };
    }
    audio.push(attempt.result.audio);
  }

  return {
    result: {
      audio: concatBytes(audio),
      mime: "audio/mpeg",
      provider: "edge",
    },
    status: null,
  };
}
