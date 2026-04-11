import { jwtVerify, importSPKI } from 'jose';

interface Env {
  GROQ_KEY_1: string;
  GROQ_KEY_2: string;
  GROQ_KEY_3: string;
  GROQ_KEY_4: string;
  GROQ_KEY_5: string;
  GROQ_KEY_6: string;
  GROQ_KEY_7: string;
  GROQ_KEY_8: string;
  GROQ_KEY_9: string;
  GROQ_KEY_10: string;
  DEEPSEEK_KEY_1: string;
  DEEPSEEK_KEY_2: string;
  DEEPSEEK_KEY_3: string;
  MISTRAL_KEY: string;
  OPENROUTER_KEY: string;
  DEEPGRAM_KEY: string;
  ASSEMBLYAI_KEY: string;
  CLERK_PEM_PUBLIC_KEY: string;
  AI: any; // Cloudflare Workers AI
}

const GROQ_TRANSCRIBE = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const ASSEMBLYAI_UPLOAD = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT = 'https://api.assemblyai.com/v2/transcript';
const DEEPSEEK_CHAT = 'https://api.deepseek.com/chat/completions';
const MISTRAL_CHAT = 'https://api.mistral.ai/v1/chat/completions';
const OPENROUTER_CHAT = 'https://openrouter.ai/api/v1/chat/completions';
const DEEPGRAM_TRANSCRIBE = 'https://api.deepgram.com/v1/listen';

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25MB hard limit

// ─── Infrastructure State ──────────────────────────────────────

const keyCooldowns = new Map<string, number>();

function isKeyCoolingDown(key: string): boolean {
  const cooldown = keyCooldowns.get(key);
  if (!cooldown) return false;
  if (Date.now() > cooldown) {
    keyCooldowns.delete(key);
    return false;
  }
  return true;
}

function setKeyCooldown(key: string, seconds = 60) {
  keyCooldowns.set(key, Date.now() + seconds * 1000);
}

function getRandomUserAgent(): string {
  const uas = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36',
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
  ];
  return uas[Math.floor(Math.random() * uas.length)];
}

// ─── Main Worker ───────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let response: Response;

    // --- Authentication ---
    const authHeader = request.headers.get('Authorization');
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return this.addCorsHeaders(
        Response.json(
          { error: 'UNAUTHORIZED', message: 'Missing or invalid token' },
          { status: 401 },
        ),
        corsHeaders,
      );
    }
    const token = authHeader.split(' ')[1];

    // We only verify if the PEM key is configured
    if (env.CLERK_PEM_PUBLIC_KEY && env.CLERK_PEM_PUBLIC_KEY.length > 10) {
      try {
        const publicKey = await importSPKI(env.CLERK_PEM_PUBLIC_KEY, 'RS256');
        await jwtVerify(token, publicKey);
        // User is authenticated
      } catch (err: any) {
        return this.addCorsHeaders(
          Response.json(
            { error: 'UNAUTHORIZED', message: err.message },
            { status: 401 },
          ),
          corsHeaders,
        );
      }
    }

    try {
      if (request.method === 'POST' && url.pathname === '/transcribe') {
        response = await handleTranscribe(request, env);
      } else if (request.method === 'POST' && url.pathname === '/translate') {
        response = await handleTranslate(request, env);
      } else {
        response = Response.json({ error: 'NOT_FOUND' }, { status: 404 });
      }
    } catch (e: any) {
      response = Response.json(
        { error: 'EKWE_NETWORK_LOST', message: e.message },
        { status: 500 },
      );
    }

    return this.addCorsHeaders(response, corsHeaders);
  },

  addCorsHeaders(
    response: Response,
    corsHeaders: Record<string, string>,
  ): Response {
    const newHeaders = new Headers(response.headers);
    Object.entries(corsHeaders).forEach(([k, v]) => newHeaders.set(k, v));
    return new Response(response.body, {
      status: response.status,
      headers: newHeaders,
    });
  },
};

// ─── Transcription ────────────────────────────────────────────

async function handleTranscribe(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const file = (formData as any).get('file') as File | null;
  const language = (formData as any).get('language') as string | null;
  const timestampGranularities = (formData as any).get(
    'timestamp_granularities',
  ) as string | null;

  if (!file)
    return Response.json({ error: 'EKWE_SHARE_COPY_FAIL' }, { status: 400 });
  if (file.size > MAX_FILE_SIZE)
    return Response.json({ error: 'EKWE_FILE_TOO_LARGE' }, { status: 413 });

  // 1. Try Groq (Randomized order of 10 keys)
  const groqKeys = shuffle([
    env.GROQ_KEY_1,
    env.GROQ_KEY_2,
    env.GROQ_KEY_3,
    env.GROQ_KEY_4,
    env.GROQ_KEY_5,
    env.GROQ_KEY_6,
    env.GROQ_KEY_7,
    env.GROQ_KEY_8,
    env.GROQ_KEY_9,
    env.GROQ_KEY_10,
  ]).filter((k) => k && k.length > 5 && !isKeyCoolingDown(k));

  for (let i = 0; i < groqKeys.length; i++) {
    const key = groqKeys[i];
    const res = await groqTranscribe(
      file,
      language,
      timestampGranularities,
      key,
    );

    if (res.status === 429) {
      setKeyCooldown(key, 60); // Break for 60s
      if (i < 2) await new Promise((r) => setTimeout(r, 1000 * (i + 1))); // Small backoff for first 2 failures
      continue;
    }
    if (res.ok || res.status < 400) return res;
  }

  // 2. Try Deepgram
  if (env.DEEPGRAM_KEY && env.DEEPGRAM_KEY.length > 5) {
    const res = await deepgramTranscribe(file, language, env.DEEPGRAM_KEY);
    if (res.ok) return res;
  }

  // 3. Try Cloudflare Workers AI (Whisper)
  if (env.AI) {
    const res = await cloudflareTranscribe(file, env);
    if (res.ok) return res;
  }

  // 4. Try AssemblyAI
  if (env.ASSEMBLYAI_KEY && env.ASSEMBLYAI_KEY.length > 5) {
    const res = await assemblyAITranscribe(file, language, env.ASSEMBLYAI_KEY);
    if (res.ok) return res;
  }

  return Response.json({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, { status: 503 });
}

async function groqTranscribe(
  file: File,
  language: string | null,
  ts: string | null,
  apiKey: string,
): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');
  if (language && language !== 'auto') form.append('language', language);
  form.append('timestamp_granularities[]', ts ?? 'word');
  form.append('timestamp_granularities[]', 'segment');

  return await fetch(GROQ_TRANSCRIBE, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'User-Agent': getRandomUserAgent(),
    },
    body: form,
  });
}

// ─── Translation ──────────────────────────────────────────────

async function handleTranslate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    text: string;
    targetLang: string;
    sourceLang?: string;
  };
  if (!body.text?.trim())
    return Response.json({ error: 'EKWE_EMPTY_TRANSCRIPT' }, { status: 400 });

  // 1. Try DeepSeek (Randomized order of 3 keys)
  const dsKeys = shuffle([
    env.DEEPSEEK_KEY_1,
    env.DEEPSEEK_KEY_2,
    env.DEEPSEEK_KEY_3,
  ]).filter((k) => k && k.length > 5 && !isKeyCoolingDown(k));

  for (const key of dsKeys) {
    const res = await deepSeekTranslate(
      body.text,
      body.targetLang,
      body.sourceLang,
      key,
    );
    if (res.status === 429) {
      setKeyCooldown(key, 30);
      continue;
    }
    if (res.ok) return res;
  }

  // 2. Try Mistral / OpenRouter / Groq LLaMA
  const llmKeys = [
    { type: 'mistral', key: env.MISTRAL_KEY },
    { type: 'openrouter', key: env.OPENROUTER_KEY },
  ].filter((p) => p.key && p.key.length > 5);

  for (const p of shuffle(llmKeys)) {
    let res: Response;
    if (p.type === 'mistral')
      res = await mistralTranslate(
        body.text,
        body.targetLang,
        body.sourceLang,
        p.key,
      );
    else
      res = await openRouterTranslate(
        body.text,
        body.targetLang,
        body.sourceLang,
        p.key,
      );
    if (res.ok) return res;
  }

  // Final fallback to Groq LLaMA
  const groqKeys = shuffle([
    env.GROQ_KEY_1,
    env.GROQ_KEY_2,
    env.GROQ_KEY_3,
  ]).filter((k) => k && k.length > 5);
  for (const key of groqKeys) {
    const res = await groqTranslate(
      body.text,
      body.targetLang,
      body.sourceLang,
      key,
    );
    if (res.ok) return res;
  }

  return Response.json({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, { status: 503 });
}

// ─── API Implementations ──────────────────────────────────────

function shuffle<T>(array: T[]): T[] {
  return [...array].sort(() => Math.random() - 0.5);
}

function buildTranslationPrompt(
  targetLang: string,
  sourceLang?: string,
): string {
  return `You are a translator. Translate the text${sourceLang ? ` from ${sourceLang}` : ''} to ${targetLang}. Return ONLY the translation. No preamble.`;
}

async function deepSeekTranslate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  apiKey: string,
): Promise<Response> {
  return await fetch(DEEPSEEK_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': getRandomUserAgent(),
    },
    body: JSON.stringify({
      model: 'deepseek-chat',
      messages: [
        {
          role: 'system',
          content: buildTranslationPrompt(targetLang, sourceLang),
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}

async function mistralTranslate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  apiKey: string,
): Promise<Response> {
  return await fetch(MISTRAL_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': getRandomUserAgent(),
    },
    body: JSON.stringify({
      model: 'mistral-small-latest',
      messages: [
        {
          role: 'system',
          content: buildTranslationPrompt(targetLang, sourceLang),
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}

async function openRouterTranslate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  apiKey: string,
): Promise<Response> {
  return await fetch(OPENROUTER_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://ekwe.app',
      'X-Title': 'Ekwe',
      'User-Agent': getRandomUserAgent(),
    },
    body: JSON.stringify({
      model: 'meta-llama/llama-3.1-8b-instruct:free',
      messages: [
        {
          role: 'system',
          content: buildTranslationPrompt(targetLang, sourceLang),
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}

async function groqTranslate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  apiKey: string,
): Promise<Response> {
  return await fetch(GROQ_CHAT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'User-Agent': getRandomUserAgent(),
    },
    body: JSON.stringify({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: buildTranslationPrompt(targetLang, sourceLang),
        },
        { role: 'user', content: text },
      ],
      temperature: 0.1,
    }),
  });
}

async function cloudflareTranscribe(file: File, env: Env): Promise<Response> {
  try {
    const audioArray = await file.arrayBuffer();
    const result = await (env.AI as any).run('@cf/openai/whisper', {
      audio: [...new Uint8Array(audioArray)],
    });
    return Response.json({ text: result.text, words: [], language: 'en' });
  } catch (e) {
    return Response.json({ error: 'EKWE_NETWORK_LOST' }, { status: 503 });
  }
}

async function deepgramTranscribe(
  file: File,
  language: string | null,
  apiKey: string,
): Promise<Response> {
  const url = new URL(DEEPGRAM_TRANSCRIBE);
  url.searchParams.set('model', 'nova-2');
  url.searchParams.set('smart_format', 'true');
  if (language && language !== 'auto')
    url.searchParams.set('language', language);
  const response = await fetch(url.toString(), {
    method: 'POST',
    headers: {
      Authorization: `Token ${apiKey}`,
      'Content-Type': file.type || 'audio/wav',
      'User-Agent': getRandomUserAgent(),
    },
    body: file,
  });
  if (!response.ok) return response;
  const data = (await response.json()) as any;
  return Response.json({
    text: data.results?.channels[0]?.alternatives[0]?.transcript || '',
    words: data.results?.channels[0]?.alternatives[0]?.words || [],
    language: language || 'en',
  });
}

async function assemblyAITranscribe(
  file: File,
  language: string | null,
  apiKey: string,
): Promise<Response> {
  const uploadRes = await fetch(ASSEMBLYAI_UPLOAD, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/octet-stream',
      'User-Agent': getRandomUserAgent(),
    },
    body: file,
  });
  if (!uploadRes.ok) return uploadRes;
  const { upload_url } = (await uploadRes.json()) as { upload_url: string };
  const startRes = await fetch(ASSEMBLYAI_TRANSCRIPT, {
    method: 'POST',
    headers: {
      authorization: apiKey,
      'content-type': 'application/json',
      'User-Agent': getRandomUserAgent(),
    },
    body: JSON.stringify({
      audio_url: upload_url,
      language_code: language === 'auto' ? undefined : language,
    }),
  });
  if (!startRes.ok) return startRes;
  const { id } = (await startRes.json()) as { id: string };
  let result: any = { status: 'queued' };
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 1000));
    const poll = await fetch(`${ASSEMBLYAI_TRANSCRIPT}/${id}`, {
      headers: { authorization: apiKey, 'User-Agent': getRandomUserAgent() },
    });
    if (poll.ok) {
      result = await poll.json();
      if (result.status === 'completed' || result.status === 'error') break;
    }
  }
  if (result.status !== 'completed')
    return Response.json({ error: 'EKWE_TRANSCRIBE_TIMEOUT' }, { status: 504 });
  return Response.json({
    text: result.text,
    words: [],
    language: language || 'en',
  });
}
