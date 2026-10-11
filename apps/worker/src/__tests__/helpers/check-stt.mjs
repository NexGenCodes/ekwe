#!/usr/bin/env node

/**
 * Functional speech-to-text check: does each provider actually *transcribe*,
 * not merely authenticate?
 *
 * `check-providers.mjs` proves a key is live. It cannot catch the failure that
 * matters most here: a provider that accepts the request, returns HTTP 200, and
 * answers with silence, the wrong language, or a hallucinated subtitle. Those
 * only appear when real audio goes through the real endpoint.
 *
 * Reference audio is synthesized once per phrase, then the same bytes are sent
 * to every provider so the comparison is like-for-like. Accuracy is scored on
 * normalized token overlap, because providers differ in punctuation and casing
 * even when the words are right.
 *
 * Cloudflare is absent by construction: its Whisper binding is reached through
 * `env.AI.run`, which only exists inside a Worker, not from a script.
 *
 * Usage:
 *   node src/__tests__/helpers/check-stt.mjs                 # core languages
 *   node src/__tests__/helpers/check-stt.mjs --langs yo,ig,fr
 *   node src/__tests__/helpers/check-stt.mjs --providers witai,groq
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const WORKER_DIR = join(SCRIPT_DIR, "..", "..", "..");
const AUDIO_DIR = join(SCRIPT_DIR, "..", "fixtures", "audio");

const PASS = "[32mPASS[0m";
const FAIL = "[31mFAIL[0m";
const WARN = "[33mWARN[0m";

/**
 * One short, unambiguous phrase per language.
 *
 * Kept deliberately plain: no proper nouns, no numbers and no idioms, so a
 * miss is a genuine recognition failure rather than a hard test. Yoruba and Igbo
 * use their standard orthography, which is what the catalog's `yo`/`ig` codes
 * mean.
 */
const PHRASES = {
  en: "Good morning. How are you today?",
  es: "Buenos dias. Como estas hoy?",
  fr: "Bonjour. Comment allez-vous aujourd'hui ?",
  yo: "Ẹ káàárọ̀. Báwo ni o ṣe ní ọjọ́ ìwọ?",
  ig: "Ọ nwoke. Kedu otu i si na anyi?",
  ha: "Barka da safiya. Yaya kake yanzu?",
  de: "Guten Morgen. Wie geht es Ihnen heute?",
};

const DEFAULT_LANGS = ["en", "es", "fr", "yo", "ig"];

/* ------------------------------------------------------------------ env --- */

export function loadEnv() {
  const env = {};
  const path = join(WORKER_DIR, ".dev.vars");
  if (!existsSync(path)) return env;
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const match = raw.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "");
  }
  return env;
}

function keysFor(env, prefix) {
  return Object.keys(env)
    .filter((k) => k.startsWith(prefix))
    .map((k) => env[k])
    .filter((v) => typeof v === "string" && v.length > 10);
}

function firstKey(env, prefix) {
  return keysFor(env, prefix)[0];
}

/* ------------------------------------------------------- reference audio --- */

/**
 * Wraps raw PCM in a RIFF/WAV header.
 *
 * Gemini's TTS endpoint answers with headerless `audio/L16;codec=pcm`, while
 * every STT provider below wants a real container. Wrapping it here keeps the
 * test honest — the providers see the same bytes a device would send.
 */
function pcmToWav(
  pcm,
  { sampleRate = 24000, channels = 1, bitsPerSample = 16 } = {},
) {
  const byteRate = (sampleRate * channels * bitsPerSample) / 8;
  const blockAlign = (channels * bitsPerSample) / 8;
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // PCM chunk size
  header.writeUInt16LE(1, 20); // format = PCM
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

const GEMINI_TTS =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent";

/**
 * Synthesizes the reference clip for one language, cached on disk.
 *
 * Cached because generation is slow and, more importantly, because every
 * provider must receive *identical* audio — regenerating per provider would let
 * a model's mood swing masquerade as a recognition difference.
 */
async function referenceAudio(env, lang, { refresh = false } = {}) {
  mkdirSync(AUDIO_DIR, { recursive: true });
  const path = join(AUDIO_DIR, `${lang}.wav`);
  if (!refresh && existsSync(path)) return readFileSync(path);

  const text = PHRASES[lang];
  if (!text) throw new Error(`no reference phrase for "${lang}"`);

  // Rotates across every key, as the worker does. A single key is enough to hit
  // Gemini's per-key TTS quota and fail a run that a rotation would carry.
  const keys = keysFor(env, "GEMINI_KEY_");
  if (keys.length === 0) throw new Error("no GEMINI_KEY_ available to synthesize audio");

  let lastStatus = 0;
  for (const key of keys) {
    const res = await fetch(GEMINI_TTS, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text }] }],
        generationConfig: {
          responseModalities: ["AUDIO"],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } },
          },
        },
      }),
    });
    lastStatus = res.status;
    if (!res.ok) continue;

    const data = await res.json();
    const inline = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
    if (!inline) {
      // Seen for Yoruba: a 200 with no audio part. The model answers rather than
      // refusing, so the absence is the only signal that it cannot speak it.
      throw new Error(
        `Gemini TTS returned no audio for "${lang}" (finishReason=${
          data.candidates?.[0]?.finishReason ?? "unknown"
        })`,
      );
    }

    const wav = pcmToWav(Buffer.from(inline.inlineData.data, "base64"));
    writeFileSync(path, wav);
    return wav;
  }
  throw new Error(`Gemini TTS HTTP ${lastStatus} on all ${keys.length} keys`);
}

/* -------------------------------------------------------------- scoring --- */

/**
 * Folds case, punctuation and the diacritics Whisper likes to drop.
 *
 * Diacritics are removed because the reference phrases are written in plain
 * ASCII where that is natural to type, while a good transcriber restores the
 * accents from the audio: "Comment allez-vous aujourd'hui" against a reference
 * of "Comment allez vous aujourd hui" is a perfect answer, not a miss. Treating
 * them as equal is the difference between measuring recognition and measuring
 * my typing.
 */
const normalize = (s) =>
  (s ?? "")
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase()
    // A hyphen is punctuation to a reader and a word break to a tokenizer:
    // "allez-vous" must become two tokens or it can never match the reference.
    .replace(/[-\u2010-\u2015]/g, " ")
    .replace(/[^\p{Letter}\p{Number}\s]/gu, "")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Token overlap against the reference, as a fraction.
 *
 * Deliberately not exact-match: providers disagree about punctuation and
 * casing on text they all transcribe correctly, and scoring that as a failure
 * would bury the real misses.
 */
export function score(reference, hypothesis) {
  const ref = normalize(reference);
  const hyp = normalize(hypothesis);
  if (!ref) return 0;
  if (!hyp) return 0;
  if (hyp === ref) return 1;

  const refTokens = ref.split(" ").filter(Boolean);
  const hypTokens = new Set(hyp.split(" ").filter(Boolean));
  const hits = refTokens.filter((t) => hypTokens.has(t)).length;
  return hits / refTokens.length;
}

/* ------------------------------------------------------------ providers --- */

const wav = (buf) => new Blob([buf], { type: "audio/wav" });

async function time(label, fn) {
  const started = Date.now();
  try {
    const text = await fn();
    return { label, text, ms: Date.now() - started };
  } catch (err) {
    return { label, error: err instanceof Error ? err.message : String(err), ms: Date.now() - started };
  }
}

function groqStt(key, audio, lang) {
  return async () => {
    const body = new FormData();
    body.append("file", wav(audio), "audio.wav");
    body.append("model", "whisper-large-v3");
    body.append("language", lang);
    body.append("temperature", "0");
    const res = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.text ?? "";
  };
}

function deepgramStt(key, audio, lang) {
  return async () => {
    const params = new URLSearchParams({
      model: "nova-3",
      language: lang,
      smart_format: "true",
    });
    const res = await fetch(`https://api.deepgram.com/v1/listen?${params}`, {
      method: "POST",
      headers: { Authorization: `Token ${key}`, "Content-Type": "audio/wav" },
      body: audio,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.results?.channels?.[0]?.alternatives?.[0]?.transcript ?? "";
  };
}

function cohereStt(key, audio, lang) {
  return async () => {
    const body = new FormData();
    body.append("model", "cohere-transcribe-03-2026");
    body.append("language", lang);
    body.append("file", wav(audio), "audio.wav");
    const res = await fetch("https://api.cohere.com/v2/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.text ?? "";
  };
}

function witStt(key, audio) {
  return async () => {
    const res = await fetch("https://api.wit.ai/dictation?v=20240304", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${key}`,
        "Content-Type": "audio/wav",
      },
      // The whole container, not a bare PCM payload: Wit's endpoint rejects a
      // headerless body, which is what the streaming route has to add.
      body: audio,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text()).slice(0, 60)}`);
    const raw = await res.text();
    // Mirrors the worker's parseJsonStream: Wit is free to pretty-print an
    // object across several lines, so a chunk that does not parse on its own is
    // buffered and retried with the next one rather than discarded.
    let last = null;
    let pending = "";
    for (const chunk of raw.replace(/^\uFEFF/, "").split("\n")) {
      const trimmed = chunk.replace(/\r$/, "").trim();
      if (!trimmed) continue;
      try {
        pending += trimmed;
        last = JSON.parse(pending);
        pending = "";
      } catch {
        // incomplete, keep building
      }
    }
    if (typeof last?.text === "string" && last.text.trim()) return last.text.trim();
    // No final object parsed: fall back to the last transcript seen, which is
    // what a partial stream leaves behind.
    const partials = [...raw.matchAll(/"text"\s*:\s*"((?:[^"\\]|\\.)*)"/g)];
    return partials.length > 0 ? partials[partials.length - 1][1] : "";
  };
}

function elevenlabsStt(key, audio, lang) {
  return async () => {
    const body = new FormData();
    body.append("file", wav(audio), "audio.wav");
    body.append("model_id", "scribe_v2");
    const spellings = { en: "eng", es: "spa", fr: "fra", yo: "yor", ig: "ibo", ha: "hau", de: "deu" };
    if (lang !== "auto") body.append("language_code", spellings[lang] ?? lang);
    const res = await fetch("https://api.elevenlabs.io/v1/speech-to-text", {
      method: "POST",
      headers: { "xi-api-key": key },
      body,
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    return data.text ?? "";
  };
}

function assemblyaiStt(key, audio) {
  return async () => {
    const upload = await fetch("https://api.assemblyai.com/v2/upload", {
      method: "POST",
      headers: { Authorization: key },
      body: audio,
    });
    if (!upload.ok) throw new Error(`upload HTTP ${upload.status}`);
    const { upload_url } = await upload.json();

    const submit = await fetch("https://api.assemblyai.com/v2/transcript", {
      method: "POST",
      headers: { Authorization: key, "Content-Type": "application/json" },
      body: JSON.stringify({ audio_url: upload_url }),
    });
    if (!submit.ok) throw new Error(`submit HTTP ${submit.status}`);
    const job = await submit.json();

    for (let i = 0; i < 40; i += 1) {
      const poll = await fetch(`https://api.assemblyai.com/v2/transcript/${job.id}`, {
        headers: { Authorization: key },
      });
      const data = await poll.json();
      if (data.status === "completed") return data.text ?? "";
      if (data.status === "error") throw new Error(data.error ?? "job error");
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("timed out");
  };
}

function gladiaStt(key, audio, lang) {
  return async () => {
    // `language_config` is rejected by /upload — it belongs on the submit call,
    // and it takes `languages`, not `code`.
    const form = new FormData();
    form.append("audio", wav(audio), "audio.wav");
    const upload = await fetch("https://api.gladia.io/v2/upload", {
      method: "POST",
      headers: { "x-gladia-key": key },
      body: form,
    });
    if (!upload.ok) throw new Error(`upload HTTP ${upload.status}`);
    const { audio_url } = await upload.json();

    const submit = await fetch("https://api.gladia.io/v2/pre-recorded", {
      method: "POST",
      headers: { "x-gladia-key": key, "Content-Type": "application/json" },
      body: JSON.stringify({
        audio_url,
        language_config: { languages: [lang] },
      }),
    });
    if (!submit.ok) throw new Error(`submit HTTP ${upload.status}: ${(await submit.text()).slice(0, 120)}`);
    const job = await submit.json();

    for (let i = 0; i < 40; i += 1) {
      const poll = await fetch(
        `https://api.gladia.io/v2/pre-recorded/${job.id}`,
        { headers: { "x-gladia-key": key } },
      );
      const data = await poll.json();
      if (data.status === "done") {
        return data.result?.transcription?.full_transcript ?? "";
      }
      if (data.status === "error") throw new Error(data.error_code ?? "job error");
      await new Promise((r) => setTimeout(r, 1500));
    }
    throw new Error("timed out");
  };
}

/**
 * Builds one runner per provider, each already bound to the reference audio.
 *
 * A provider without a key is marked missing rather than dropped: "it passed"
 * and "it was never tried" must not look the same in the summary.
 */
function buildRunners(env, lang, audio, filter) {
  const runners = [];
  // A factory that resolves to null means "no key for this provider", which is
  // a different outcome from a failure and is counted separately in the summary.
  const add = (name, make) => {
    if (filter && !filter.includes(name)) return;
    const run = make();
    runners.push({ name, missing: run === null, run });
  };
  const witKey = env[`WIT_KEY_${lang.toUpperCase()}`];
  const need = (prefix) => {
    const key = firstKey(env, prefix);
    return key ? key : null;
  };

  add("witai", () => (witKey ? witStt(witKey, audio) : null));
  add("groq", () => (need("GROQ_KEY_") ? groqStt(need("GROQ_KEY_"), audio, lang) : null));
  add("cohere", () => (need("COHERE_KEY_") ? cohereStt(need("COHERE_KEY_"), audio, lang) : null));
  add("deepgram", () => (need("DEEPGRAM_KEY_") ? deepgramStt(need("DEEPGRAM_KEY_"), audio, lang) : null));
  add("elevenlabs", () =>
    need("ELEVENLABS_KEY_") ? elevenlabsStt(need("ELEVENLABS_KEY_"), audio, lang) : null,
  );
  add("assemblyai", () => (need("ASSEMBLYAI_KEY_") ? assemblyaiStt(need("ASSEMBLYAI_KEY_"), audio) : null));
  add("gladia", () => (need("GLADIA_KEY_") ? gladiaStt(need("GLADIA_KEY_"), audio, lang) : null));
  return runners;
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
  const refresh = args.includes("--refresh");

  // Threshold is a per-provider quality gate, not a correctness gate. On a
  // seven-word phrase a single differing word costs ~14 points, so 0.6 is
  // "recognised the sentence with at most a word or two off". Orthographic
  // variation (Hausa is written with and without the apostrophe; Spanish and
  // French with and without accents) lands here too and is a real difference, not
  // a bug — read the transcript column before treating a low score as breakage.
  const minScore = Number(argOf("--min") ?? "0.6");

  console.log(
    `Functional STT check — ${langs.join(", ")}\n` +
      `Reference: Gemini TTS, cached in src/__tests__/fixtures/audio/\n` +
      `Threshold: ${Math.round(minScore * 100)}% token overlap\n`,
  );

  let pass = 0;
  let fail = 0;
  let missing = 0;
  let synthesisFailures = 0;
  const report = [];

  for (const lang of langs) {
    const phrase = PHRASES[lang];
    console.log(`── ${lang} ${"─".repeat(52)}`);
    console.log(`   reference: "${phrase}"`);

    let audio;
    try {
      audio = await referenceAudio(env, lang, { refresh });
      console.log(`   audio: ${audio.length} bytes\n`);
    } catch (err) {
      synthesisFailures += 1;
      console.log(`   ${WARN} could not synthesize reference audio: ${err.message}`);
      console.log(`   ${WARN} no provider can be scored against this language\n`);
      report.push({ lang, provider: "(reference audio)", error: err.message });
      continue;
    }

    const runners = buildRunners(env, lang, audio, providerFilter);
    for (const runner of runners) {
      if (runner.missing) {
        missing += 1;
        console.log(`   ${runner.name.padEnd(12)} ${WARN} no key configured`);
        report.push({ lang, provider: runner.name, error: "no key configured" });
        continue;
      }
      const result = await time(runner.name, runner.run);
      record(result, runner.name, phrase, lang);
    }
    console.log("");
  }

  function record(result, label, phrase, lang) {
    if (result.error) {
      fail += 1;
      console.log(`   ${label.padEnd(12)} ${FAIL} ${result.error} (${result.ms}ms)`);
      report.push({ lang, provider: label, error: result.error, ms: result.ms });
      return;
    }
    const s = score(phrase, result.text);
    const ok = s >= minScore;
    if (ok) pass += 1;
    else fail += 1;
    console.log(
      `   ${label.padEnd(12)} ${ok ? PASS : FAIL} ${(s * 100).toFixed(0)}% ` +
        `${String(result.ms).padStart(6)}ms  "${(result.text || "").slice(0, 60)}"`,
    );
    report.push({ lang, provider: label, score: s, ms: result.ms, text: result.text });
  }

  console.log("─".repeat(60));
  console.log(
    `  ${pass} PASS · ${fail} FAIL · ${missing} missing-key · ` +
      `${synthesisFailures} language(s) with no reference audio`,
  );

  const failures = report.filter((r) => r.error || (r.score ?? 0) < minScore);
  if (failures.length > 0) {
    console.log("\nFailures:");
    for (const f of failures) {
      console.log(
        `  ${(f.lang + "/" + f.provider).padEnd(22)} ` +
          (f.error ? f.error : `${((f.score ?? 0) * 100).toFixed(0)}% "${f.text}"`),
      );
    }
  }
  console.log("");
  process.exitCode = fail > 0 ? 1 : 0;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
