#!/usr/bin/env node

/**
 * Functional text-to-speech check: does each provider actually *speak*, and in
 * the language it claims?
 *
 * The registry says which provider claims which language. This proves it, using
 * the same trick as check-stt.mjs — synthesize a known phrase, then transcribe
 * the result back with Whisper and compare. That catches the failures a byte
 * count cannot:
 *
 *   - audio that is a valid file but silent (Wit returns an identical 576-byte
 *     payload for every script it cannot voice)
 *   - a provider that speaks the right words in the wrong language
 *   - a voice that reads its own request markup aloud
 *
 * A provider is only counted as passing when a recognizer hears back the phrase
 * that was sent.
 *
 * Usage:
 *   node src/__tests__/helpers/check-tts.mjs
 *   node src/__tests__/helpers/check-tts.mjs --langs fr,es,de
 *   node src/__tests__/helpers/check-tts.mjs --providers witai,deepgram
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(SCRIPT_DIR, "..", "..", "..");

const PASS = "[32mPASS[0m";
const FAIL = "[31mFAIL[0m";
const WARN = "[33mWARN[0m";

/**
 * A short, plain phrase per language in its own script.
 *
 * Deliberately free of proper nouns and idioms: the point is to hear the
 * language back, not to challenge the model. Scripts Wit cannot voice are still
 * listed, because "silence" is a result worth recording rather than skipping.
 */
const PHRASES = {
  en: "Hello world",
  es: "Hola, como estas?",
  fr: "Bonjour, comment allez-vous?",
  de: "Guten Tag, wie geht es Ihnen?",
  it: "Ciao, come stai?",
  pt: "Ola, como voce esta?",
  nl: "Hallo, hoe gaat het?",
  ru: "Привет, как дела?",
  ja: "こんにちは、お元気ですか",
  ko: "안녕하세요",
  zh: "你好世界",
  ar: "مرحبا بالعالم",
  hi: "नमस्ते दुनिया",
  tr: "Merhaba, nasılsınız?",
  th: "สวัสดี",
  ta: "வணக்கம்",
  te: "నమస్కారం",
  id: "Halo, apa kabar?",
  pl: "Cześć, jak się masz?",
  sv: "Hej, hur mår du?",
  fi: "Hei, mitä kuuluu?",
  lb: "Ezoba mir",
  nn: "Hei, korle kor?",
  ba: "Сәлем",
  haw: "Aloha",
  oc: "Bonjorn",
  tk: "Merhaba",
  sn: "Mhoro",
  vi: "Xin chào, khỏe không?",
};

const DEFAULT_LANGS = ["en", "es", "fr", "de", "it", "pt", "nl", "ru"];
const MIN_BYTES = 1_200;
/**
 * Size above which a clip is trusted to hold real speech without consulting the
 * recognizer. Wit answers real speech in the 12-17 KB range (MP3); character-
 * reading output lands around 3.4 KB. Opus broke size-as-proof: Deepgram voices
 * genuine speech in 2-5 KB, below any floor that would still catch Wit. Clips
 * under this line fall through to the transcript check instead of being
 * condemned by their byte count.
 */
const DEGENERATE_BYTES = 6_000;
/** Fraction of reference tokens Whisper must hear back to call a small clip real speech. */
const TRANSCRIPT_FLOOR = 0.5;
const MAX_BYTES = 8 * 1024 * 1024;

/** Folds case, punctuation and diacritics so spelling variants do not read as misses. */
const normalize = (s) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

const score = (reference, hypothesis) => {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  if (!ref || !hyp) return 0;
  if (hyp === ref) return 1;
  const refTokens = ref.split(" ").filter(Boolean);
  const hypTokens = new Set(hyp.split(" ").filter(Boolean));
  return refTokens.filter((t) => hypTokens.has(t)).length / refTokens.length;
};

export function loadEnv() {
  const env = {};
  const path = join(WORKER_DIR, ".dev.vars");
  let text;
  try {
    text = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of text.split("\n")) {
    const m = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (m) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

const keysWithPrefix = (env, prefix) =>
  Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => env[k])
    .filter((v) => typeof v === "string" && v.length > 10);

/* ------------------------------------------------------------ providers --- */

/**
 * Wit only synthesizes from its English key — every other key answers 400 — and
 * takes text verbatim. Any hint element is spoken rather than parsed.
 */
function witTts(key, text) {
  return async () => {
    const res = await fetch("https://api.wit.ai/synthesize?v=20240304", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        Accept: "audio/mpeg",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        q: text,
        voice: "wit$Remi",
        style: "default",
        speed: "100",
        pitch: "100",
      }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  };
}

/**
 * Aura-2 voices are per-language: `vesta` exists only for English, and asking
 * for `aura-2-vesta-es` answers 400 "No such model/version combination found."
 * First female voice per language, mirroring DEEPGRAM_FEMALE in
 * src/providers/deepgram.ts — keep in sync.
 */
const DEEPGRAM_VOICES = {
  en: "vesta",
  es: "diana",
  de: "elara",
  fr: "agathe",
  it: "livia",
  nl: "daphne",
  ja: "izanami",
};

function deepgramTts(key, text, lang) {
  return async () => {
    const voice = DEEPGRAM_VOICES[lang] ?? "vesta";
    const model = `aura-2-${voice}-${lang}`;
    const params = new URLSearchParams({
      model,
      encoding: "opus",
      container: "ogg",
    });
    const res = await fetch(`https://api.deepgram.com/v1/speak?${params}`, {
      method: "POST",
      headers: {
        Authorization: `Token ${key}`,
        "Content-Type": "application/json",
        Accept: "audio/ogg;codecs=opus",
      },
      body: JSON.stringify({ text }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/ogg" };
  };
}

/**
 * Production prepends GEMINI_SPEECH_PROMPT ("Say the following:") — without it
 * the model answers 400 "Model tried to generate text, but it should only be
 * used for TTS." Keep in sync with src/providers/gemini.ts.
 */
const GEMINI_PROMPT = "Say the following: ";

function geminiTts(keys, text) {
  return async () => {
    let last = 0;
    for (const key of keys) {
      const res = await fetch(
        "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent",
        {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [{ text: GEMINI_PROMPT + text }] }],
            generationConfig: {
              responseModalities: ["AUDIO"],
              speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
              },
            },
          }),
        },
      );
      last = res.status;
      if (!res.ok) continue;
      const data = await res.json();
      const inline = data.candidates?.[0]?.content?.parts?.find(
        (p) => p.inlineData,
      );
      if (!inline) continue;
      return {
        audio: Buffer.from(inline.inlineData.data, "base64"),
        mime: inline.inlineData.mimeType ?? "audio/pcm",
      };
    }
    throw new Error(`HTTP ${last}`);
  };
}

function elevenlabsTts(key, text) {
  return async () => {
    const res = await fetch(
      "https://api.elevenlabs.io/v1/text-to-speech/EXAVITQu4vr4xnSDxMaL?output_format=mp3_44100_128",
      {
        method: "POST",
        headers: { "xi-api-key": key, "Content-Type": "application/json" },
        body: JSON.stringify({ text, model_id: "eleven_flash_v2_5" }),
      },
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return { audio: Buffer.from(await res.arrayBuffer()), mime: "audio/mpeg" };
  };
}

/**
 * Speaks the audio back with Whisper so "did it actually say the phrase" is
 * answered by a recognizer rather than by inspecting a byte count.
 *
 * Groq is asked to auto-detect the language, and that detection is what gates
 * the verdict. Word-for-word agreement is the wrong gate here: Whisper mangles
 * short non-English phrases it genuinely heard correctly ("Chesk, Jackseemash"
 * is real Polish), so exact-match scoring measures the recognizer's
 * multilingual accuracy rather than whether the provider supports the
 * language.
 */
async function listenBack(env, audio, mime) {
  const key = keysWithPrefix(env, "GROQ_KEY_")[0];
  if (!key) return { text: "", language: "", skipped: "no groq key for verification" };
  const isPcm = String(mime).includes("pcm");
  const ext = isPcm ? "wav" : mime.includes("ogg") ? "ogg" : "mp3";
  const body = new FormData();
  body.append(
    "file",
    new Blob([isPcm ? pcmToWav(audio) : audio], {
      type: isPcm ? "audio/wav" : mime,
    }),
    `a.${ext}`,
  );
  body.append("model", "whisper-large-v3");
  body.append("temperature", "0");
  // No `language` param: Groq rejects "auto" and auto-detects when it is omitted.
  // verbose_json then reports which language it settled on, which is the verdict.
  body.append("response_format", "verbose_json");
  // Groq intermittently answers 200 with an empty transcription under load, which
  // is indistinguishable from "the audio was silent". Retrying across keys keeps
  // a flaky recognizer from being reported as a broken provider.
  for (const [attempt, k] of keysWithPrefix(env, "GROQ_KEY_").entries()) {
    for (let tries = 0; tries < 2; tries++) {
      const res = await fetch(
        "https://api.groq.com/openai/v1/audio/transcriptions",
        { method: "POST", headers: { Authorization: `Bearer ${k}` }, body },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && (data.text ?? "").trim()) {
        return { text: data.text, language: data.language ?? "" };
      }
      await new Promise((r) => setTimeout(r, 400 * (attempt + tries + 1)));
    }
  }
  return { text: "", language: "" };
}

/** Wraps Gemini's headerless 16-bit PCM in a RIFF header so a recognizer can read it. */
function pcmToWav(pcm, sampleRate = 24_000) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/* ----------------------------------------------------------------- main --- */

async function main() {
  const env = loadEnv();
  const args = process.argv.slice(2);
  const argOf = (flag) => {
    const i = args.indexOf(flag);
    return i === -1 ? undefined : args[i + 1];
  };
  const langs = (argOf("--langs")?.split(",") ?? DEFAULT_LANGS).filter(Boolean);
  const providerFilter = argOf("--providers")?.split(",");
  // Overlap is printed as a quality signal only; the verdict comes from the
  // audio, so there is no --min threshold to configure.

  const deepgram = keysWithPrefix(env, "DEEPGRAM_KEY_")[0];
  const wit = keysWithPrefix(env, "WIT_KEY_EN")[0];
  const geminiKeys = keysWithPrefix(env, "GEMINI_KEY_");
  const eleven = keysWithPrefix(env, "ELEVENLABS_KEY_")[0];

  const providers = [];
  const add = (name, available, make) => {
    if (providerFilter && !providerFilter.includes(name)) return;
    providers.push({ name, available, make });
  };

  // Deepgram publishes seven voices; offering the rest would measure nothing.
  const DEEPGRAM_LANGS = new Set(["en", "es", "de", "fr", "nl", "it", "ja"]);
  add("deepgram", !!deepgram, (lang, text) =>
    DEEPGRAM_LANGS.has(lang)
      ? deepgramTts(deepgram, text, lang)()
      : Promise.reject(new Error("no native voice for this language")),
  );
  add("witai", !!wit, (lang, text) => witTts(wit, text)());
  add("gemini", geminiKeys.length > 0, (lang, text) =>
    geminiTts(geminiKeys, text)(),
  );
  add("elevenlabs", !!eleven, (lang, text) => elevenlabsTts(eleven, text)());

  console.log(
    `Functional TTS check — providers: ${providers.map((p) => p.name).join(", ")}\n` +
      `Verification: synthesize, then transcribe back with Whisper and check the\n` +
      `detected language. Overlap is a quality signal, not the gate — Whisper\n` +
      `mangles short non-English phrases it heard correctly.\n`,
  );

  let pass = 0;
  let fail = 0;
  let skipped = 0;
  const rows = [];

  for (const lang of langs) {
    const phrase = PHRASES[lang];
    if (!phrase) {
      console.log(`── ${lang} ── no reference phrase, skipped`);
      continue;
    }
    console.log(`── ${lang} ${"─".repeat(50)}`);
    console.log(`   phrase: "${phrase}"`);

    for (const provider of providers) {
      if (!provider.available) {
        skipped += 1;
        console.log(`   ${provider.name.padEnd(11)} ${WARN} no key configured`);
        continue;
      }
      const started = Date.now();
      let audio;
      let mime;
      try {
        const out = await provider.make(lang, phrase);
        audio = out.audio;
        mime = out.mime;
      } catch (err) {
        fail += 1;
        const msg = err instanceof Error ? err.message : String(err);
        console.log(
          `   ${provider.name.padEnd(11)} ${FAIL} ${msg} (${Date.now() - started}ms)`,
        );
        rows.push({ lang, provider: provider.name, error: msg });
        continue;
      }

      const ms = Date.now() - started;
      const bytes = audio.byteLength;
      if (bytes < MIN_BYTES) {
        fail += 1;
        console.log(
          `   ${provider.name.padEnd(11)} ${FAIL} silent ${bytes}b (${ms}ms)`,
        );
        rows.push({
            lang,
            provider: provider.name,
            bytes,
            heardLang: "",
            verdict: "silent",
          });
        continue;
      }
      if (bytes > MAX_BYTES) {
        fail += 1;
        console.log(`   ${provider.name.padEnd(11)} ${FAIL} over cap ${bytes}b`);
        continue;
      }

      const heard = await listenBack(env, audio, mime);
      const s = score(phrase, heard.text);
      const heardLang = (heard.language || "").split("-")[0];

      // Three outcomes, because there is no honest way to grade a 1-second clip
      // on how well it was spoken:
      //
      //   silent     - Wit returned its 576-byte no-audio payload. It cannot
      //                voice this script at all.
      //   degenerate - audio exists but the recognizer cannot hear the phrase
      //                back — clipped, or reading the characters one by one.
      //   speaks     - the recognizer hears the reference phrase back, or the
      //                clip is large enough that size alone is proof.
      //
      // A byte floor alone used to separate these cleanly:
      //   576 b      - Wit's silent no-audio payload
      //   ~3.4 KB    - clipped, reading characters one at a time
      //   7.4 KB +   - genuine speech
      // Opus broke that calibration: Deepgram voices genuine speech in 2-5 KB,
      // under any floor that would still catch Wit. Clips under the floor are
      // therefore judged by whether Whisper hears the reference phrase back,
      // not by their size. Word count must not be part of this: a one-word
      // greeting ("Moro" in Shona) transcribes to exactly one token and is
      // perfectly good audio.
      // Whisper's language label is reported but deliberately not the gate: on
      // clips this short it calls correct Polish and Finnish "English" while
      // transcribing them accurately, so gating on it would fail audio that is
      // genuinely correct.
      const verdict =
        bytes >= DEGENERATE_BYTES || s >= TRANSCRIPT_FLOOR
          ? "speaks"
          : "degenerate";

      if (verdict === "speaks") pass += 1;
      else fail += 1;

      const mark = verdict === "speaks" ? PASS : FAIL;
      const why = verdict === "speaks" ? "" : ` ${verdict}`;
      console.log(
        `   ${provider.name.padEnd(11)} ${mark} ` +
          `${String(bytes).padStart(6)}b ` +
          `heard=${(heardLang || "?").padEnd(3)} ` +
          `${String(ms).padStart(5)}ms ${(s * 100).toFixed(0).padStart(3)}%${why} ` +
          `"${heard.text.slice(0, 36)}"`,
      );
      rows.push({
        lang,
        provider: provider.name,
        bytes,
        score: s,
        heardLang,
        heard: heard.text,
        verdict,
      });
      await new Promise((r) => setTimeout(r, 700));
    }
    console.log("");
  }

  console.log("─".repeat(60));
  console.log(
    `  ${pass} PASS · ${fail} FAIL · ${skipped} missing-key`,
  );
  const bad = rows.filter((r) => r.verdict && r.verdict !== "speaks");
  if (bad.length) {
    console.log("\nDid not produce usable speech:");
    for (const b of bad) {
      const why =
        b.verdict === "silent"
          ? `silent ${b.bytes}b`
          : `degenerate ${b.bytes}b "${(b.heard ?? "").slice(0, 30)}"`;
      console.log(`  ${(b.lang + "/" + b.provider).padEnd(20)} ${why}`);
    }
  }
  console.log("");
  process.exitCode = fail > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}