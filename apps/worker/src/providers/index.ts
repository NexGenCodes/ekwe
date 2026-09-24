import {
  getStreamingProviderNames,
  getTranscribeProviderNames,
  getTranslateProviderNames,
  getSpeechProviderNames,
  speechProviderSupports,
} from "@/core/providers";
import { ASSEMBLYAI_STREAM_LANGUAGES } from "@/core/languages";
import type {
  Env,
  ProviderCapability,
  ProviderModule,
  SpeechAttempt,
  TtsFn,
  Tier,
} from "@/core/types";
import * as assemblyai from "./assemblyai";
import * as cloudflare from "./cloudflare";
import * as cohere from "./cohere";
import * as deepgram from "./deepgram";
import * as edge from "./edge";
import * as gemini from "./gemini";
import * as gladia from "./gladia";
import * as groq from "./groq";
import * as mistral from "./mistral";
import * as openrouter from "./openrouter";
import * as witai from "./witai";

function ttsNoLang(
  fn: (
    text: string,
    env: Env,
    signal: AbortSignal,
    voice?: string,
  ) => Promise<SpeechAttempt>,
): TtsFn {
  return (text, _lang, env, signal, voice) => fn(text, env, signal, voice);
}

function ttsWithLang(
  fn: (
    text: string,
    lang: string,
    env: Env,
    signal: AbortSignal,
    voice?: string,
  ) => Promise<SpeechAttempt>,
): TtsFn {
  return (text, lang, env, signal, voice) => fn(text, lang, env, signal, voice);
}

export const PROVIDER_MODULES: Readonly<Record<string, ProviderModule>> = {
  witai: {
    name: "witai",
    capabilities: ["stt", "sttStream", "tts"],
    supportedLanguages: witai.supportedLanguages,
    stt: witai.stt,
    sttStream: witai.sttStream,
    tts: ttsWithLang(witai.tts),
    voice: witai.voice,
  },
  groq: {
    name: "groq",
    capabilities: ["stt", "translate"],
    supportedLanguages: groq.supportedLanguages,
    stt: groq.stt,
    translate: groq.translate,
  },
  cloudflare: {
    name: "cloudflare",
    capabilities: ["stt", "translate"],
    supportedLanguages: cloudflare.supportedLanguages,
    stt: cloudflare.stt,
    translate: cloudflare.translate,
  },
  gladia: {
    name: "gladia",
    capabilities: ["stt", "sttStream"],
    supportedLanguages: gladia.supportedLanguages,
    stt: gladia.stt,
    sttStream: gladia.sttStream,
  },
  openrouter: {
    name: "openrouter",
    capabilities: ["stt", "translate"],
    supportedLanguages: openrouter.supportedLanguages,
    stt: openrouter.stt,
    translate: openrouter.translate,
  },
  cohere: {
    name: "cohere",
    capabilities: ["stt", "translate"],
    supportedLanguages: cohere.supportedLanguages,
    stt: cohere.stt,
    translate: cohere.translate,
  },
  deepgram: {
    name: "deepgram",
    capabilities: ["stt", "sttStream", "tts"],
    supportedLanguages: deepgram.supportedLanguages,
    stt: deepgram.stt,
    sttStream: deepgram.sttStream,
    tts: ttsWithLang(deepgram.tts),
    voice: deepgram.voice,
  },
  assemblyai: {
    name: "assemblyai",
    capabilities: ["stt", "sttStream"],
    supportedLanguages: assemblyai.supportedLanguages,
    stt: assemblyai.stt,
    sttStream: assemblyai.sttStream,
  },
  gemini: {
    name: "gemini",
    capabilities: ["translate", "tts"],
    translate: gemini.translate,
    tts: ttsNoLang(gemini.tts),
    voice: gemini.voice,
  },
  mistral: {
    name: "mistral",
    capabilities: ["translate"],
    translate: mistral.translate,
  },
  edge: {
    name: "edge",
    capabilities: ["tts"],
    tts: ttsNoLang(edge.tts),
    voice: edge.voice,
  },
};

const CAPABILITY_TO_PIPELINE: Readonly<
  Record<ProviderCapability, (tier: Tier) => readonly string[]>
> = {
  stt: getTranscribeProviderNames,
  sttStream: () => getStreamingProviderNames(),
  translate: getTranslateProviderNames,
  tts: getSpeechProviderNames,
  ttsStream: () => [],
};

export function getProviderModule(name: string): ProviderModule | undefined {
  return PROVIDER_MODULES[name];
}

function supportsCapability(
  name: string,
  capability: ProviderCapability,
): boolean {
  return PROVIDER_MODULES[name]?.capabilities.includes(capability) ?? false;
}

export function getProviderNamesFor(
  capability: ProviderCapability,
  tier: Tier,
): readonly string[] {
  return CAPABILITY_TO_PIPELINE[capability](tier).filter((name) =>
    supportsCapability(name, capability),
  );
}

export function providerSupportsLanguage(
  name: string,
  capability: ProviderCapability,
  lang: string,
): boolean {
  const mod = PROVIDER_MODULES[name];
  if (!mod || !supportsCapability(name, capability)) return false;
  switch (capability) {
    case "translate":
      return true;
    case "tts":
      return speechProviderSupports(name, lang);
    case "sttStream":
      if (name === "assemblyai") return ASSEMBLYAI_STREAM_LANGUAGES.has(lang);
      return mod.supportedLanguages?.has(lang) ?? false;
    case "stt":
      return mod.supportedLanguages?.has(lang) ?? false;
    case "ttsStream":
      return false;
  }
}
