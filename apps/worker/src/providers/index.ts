import {
  getTranscribeProviderNames,
  getTranslateProviderNames,
  getSpeechProviderNames,
  speechProviderSupports,
} from "@/core/providers";
import {
  isLanguageSupported,
  STREAM_ROUTES,
  type ProviderId,
  type StreamRoute,
} from "@ekwe/shared/languageCapabilities";
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
import * as elevenlabs from "./elevenlabs";
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
    capabilities: ["stt", "tts", "sttStream"],
    streamRoutes: ["witai"],
    stt: witai.stt,
    sttStream: witai.sttStream,
    tts: ttsWithLang(witai.tts),
    voices: witai.voices,
  },
  groq: {
    name: "groq",
    capabilities: ["stt", "ttt"],
    stt: groq.stt,
    ttt: groq.ttt,
  },
  cloudflare: {
    name: "cloudflare",
    capabilities: ["stt", "ttt"],
    stt: cloudflare.stt,
    ttt: cloudflare.ttt,
  },
  gladia: {
    name: "gladia",
    capabilities: ["stt", "sttStream"],
    streamRoutes: ["gladia-solaria"],
    stt: gladia.stt,
    sttStream: gladia.sttStream,
  },
  openrouter: {
    name: "openrouter",
    capabilities: ["ttt"],
    ttt: openrouter.ttt,
  },
  cohere: {
    name: "cohere",
    capabilities: ["stt", "ttt"],
    stt: cohere.stt,
    ttt: cohere.ttt,
  },
  deepgram: {
    name: "deepgram",
    capabilities: ["stt", "tts", "sttStream"],
    // One module serves two routes: Flux is the turn-detection model and
    // Nova-3 is the wider-coverage fallback. Same keys, two endpoints.
    streamRoutes: ["deepgram-flux-multi", "deepgram-nova-3"],
    stt: deepgram.stt,
    sttStream: deepgram.sttStream,
    tts: ttsWithLang(deepgram.tts),
    voices: deepgram.voices,
  },
  assemblyai: {
    name: "assemblyai",
    capabilities: ["stt", "sttStream"],
    streamRoutes: ["assemblyai-u3-rt-pro"],
    stt: assemblyai.stt,
    sttStream: assemblyai.sttStream,
  },
  elevenlabs: {
    name: "elevenlabs",
    capabilities: ["stt", "tts"],
    stt: elevenlabs.stt,
    tts: elevenlabs.tts,
    voices: elevenlabs.voices,
  },
  gemini: {
    name: "gemini",
    capabilities: ["ttt", "tts"],
    ttt: gemini.ttt,
    tts: ttsNoLang(gemini.tts),
    voices: gemini.voices,
  },
  mistral: {
    name: "mistral",
    capabilities: ["ttt"],
    ttt: mistral.ttt,
  },
  edge: {
    name: "edge",
    capabilities: ["tts"],
    tts: ttsNoLang(edge.tts),
    voices: edge.voices,
  },
};

const CAPABILITY_TO_PIPELINE: Readonly<
  Record<ProviderCapability, (tier: Tier) => readonly string[]>
> = {
  stt: getTranscribeProviderNames,
  ttt: getTranslateProviderNames,
  tts: getSpeechProviderNames,
  ttsStream: () => [],
  sttStream: () => [],
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

/**
 * The routes some provider module has actually claimed, in preference order.
 *
 * Filtering the shared table by what the worker implements means a route can
 * never be offered to a user before the code to serve it exists, and a route
 * whose provider is removed drops out of the pipeline without a second edit.
 */
export function getStreamRoutes(): readonly StreamRoute[] {
  const claimed = new Set<string>();
  for (const mod of Object.values(PROVIDER_MODULES)) {
    for (const id of mod.streamRoutes ?? []) claimed.add(id);
  }
  return STREAM_ROUTES.filter((route) => claimed.has(route.id));
}

export function providerSupportsLanguage(
  name: string,
  capability: ProviderCapability,
  lang: string,
): boolean {
  const mod = PROVIDER_MODULES[name];
  if (!mod || !supportsCapability(name, capability)) return false;
  if (capability === "ttsStream" || capability === "sttStream") return false;
  // "auto" means the provider detects the language itself, so a language gate
  // does not apply — only the provider having the capability does.
  if (lang === "auto") return true;
  if (capability === "tts") return speechProviderSupports(name, lang);
  // File-shaped coverage, including provider-specific code spellings, comes from
  // the shared registry. Streaming has its own route table.
  return isLanguageSupported(name as ProviderId, capability, lang);
}
