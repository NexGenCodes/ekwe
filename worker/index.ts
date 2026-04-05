interface Env {
  GROQ_KEY_1: string;
  GROQ_KEY_2: string;
  ASSEMBLYAI_KEY: string;
  DEEPSEEK_KEY: string;
}

const GROQ_TRANSCRIBE = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_CHAT = 'https://api.groq.com/openai/v1/chat/completions';
const ASSEMBLYAI_UPLOAD = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT = 'https://api.assemblyai.com/v2/transcript';
const DEEPSEEK_CHAT = 'https://api.deepseek.com/chat/completions';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // CORS headers for all responses
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

    if (request.method === 'POST' && url.pathname === '/transcribe') {
      response = await handleTranscribe(request, env);
    } else if (request.method === 'POST' && url.pathname === '/translate') {
      response = await handleTranslate(request, env);
    } else {
      response = Response.json({ error: 'NOT_FOUND' }, { status: 404 });
    }

    // Add CORS headers to every response
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
  const formData = (await request.formData()) as any; // eslint-disable-line @typescript-eslint/no-explicit-any
  const file = formData.get('file') as File | null;
  const language = formData.get('language') as string | null;
  const timestampGranularities = formData.get('timestamp_granularities') as
    | string
    | null;

  if (file === null) {
    return Response.json({ error: 'EKWE_SHARE_COPY_FAIL' }, { status: 400 });
  }

  // Try Groq key 1
  const attempt1 = await groqTranscribe(
    file,
    language,
    timestampGranularities,
    env.GROQ_KEY_1,
  );
  if (attempt1.status !== 429 && attempt1.status !== 503) {
    return attempt1;
  }

  // Try Groq key 2
  const attempt2 = await groqTranscribe(
    file,
    language,
    timestampGranularities,
    env.GROQ_KEY_2,
  );
  if (attempt2.status !== 429 && attempt2.status !== 503) {
    return attempt2;
  }

  // Fallback to AssemblyAI
  const attempt3 = await assemblyAITranscribe(
    file,
    language,
    env.ASSEMBLYAI_KEY,
  );
  if (attempt3.ok) return attempt3;

  return Response.json({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, { status: 503 });
}

async function groqTranscribe(
  file: File,
  language: string | null,
  timestampGranularities: string | null,
  apiKey: string,
): Promise<Response> {
  const form = new FormData();
  form.append('file', file);
  form.append('model', 'whisper-large-v3');
  form.append('response_format', 'verbose_json');

  if (language !== null && language.length > 0) {
    form.append('language', language);
  }

  // Always request word timestamps for punctuation reconstruction
  form.append('timestamp_granularities[]', timestampGranularities ?? 'word');
  form.append('timestamp_granularities[]', 'segment');

  try {
    const response = await fetch(GROQ_TRANSCRIBE, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    return response;
  } catch {
    return Response.json({ error: 'EKWE_NETWORK_LOST' }, { status: 503 });
  }
}

async function assemblyAITranscribe(
  file: File,
  language: string | null,
  apiKey: string,
): Promise<Response> {
  try {
    // Step 1 — Upload the audio file
    const uploadResponse = await fetch(ASSEMBLYAI_UPLOAD, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/octet-stream',
      },
      body: file,
    });

    if (!uploadResponse.ok) {
      return Response.json(
        { error: 'EKWE_ALL_PROVIDERS_FAIL' },
        { status: 503 },
      );
    }

    const { upload_url } = (await uploadResponse.json()) as {
      upload_url: string;
    };

    // Step 2 — Request transcription
    const transcriptBody: Record<string, unknown> = {
      audio_url: upload_url,
      word_boost: [],
    };

    if (language !== null && language.length > 0) {
      transcriptBody['language_code'] = language;
    }

    const transcriptResponse = await fetch(ASSEMBLYAI_TRANSCRIPT, {
      method: 'POST',
      headers: {
        authorization: apiKey,
        'content-type': 'application/json',
      },
      body: JSON.stringify(transcriptBody),
    });

    if (!transcriptResponse.ok) {
      return Response.json(
        { error: 'EKWE_ALL_PROVIDERS_FAIL' },
        { status: 503 },
      );
    }

    const transcript = (await transcriptResponse.json()) as {
      id: string;
      status: string;
      text: string;
    };

    // Step 3 — Poll until complete (max 30 seconds)
    let pollAttempts = 0;
    let result = transcript;

    while (
      result.status !== 'completed' &&
      result.status !== 'error' &&
      pollAttempts < 30
    ) {
      await new Promise((resolve) => setTimeout(resolve, 1000));
      const pollResponse = await fetch(
        `${ASSEMBLYAI_TRANSCRIPT}/${transcript.id}`,
        { headers: { authorization: apiKey } },
      );
      result = (await pollResponse.json()) as typeof transcript;
      pollAttempts++;
    }

    if (result.status === 'error' || result.status !== 'completed') {
      return Response.json(
        { error: 'EKWE_ALL_PROVIDERS_FAIL' },
        { status: 503 },
      );
    }

    // Return in Groq-compatible format so the app does not need
    // to handle two different response shapes
    return Response.json({
      text: result.text,
      segments: [],
      words: [],
      language: language ?? 'en',
    });
  } catch {
    return Response.json({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, { status: 503 });
  }
}

// ─── Translation ──────────────────────────────────────────────

async function handleTranslate(request: Request, env: Env): Promise<Response> {
  const body = (await request.json()) as {
    text: string;
    targetLang: string;
    sourceLang?: string;
  };

  if (body.text === undefined || body.text.trim().length === 0) {
    return Response.json({ error: 'EKWE_EMPTY_TRANSCRIPT' }, { status: 400 });
  }

  // Try Groq LLaMA
  const groqResult = await groqTranslate(
    body.text,
    body.targetLang,
    body.sourceLang,
    env.GROQ_KEY_1,
  );
  if (groqResult.ok) return groqResult;

  // Fallback to DeepSeek
  const deepseekResult = await deepSeekTranslate(
    body.text,
    body.targetLang,
    body.sourceLang,
    env.DEEPSEEK_KEY,
  );
  if (deepseekResult.ok) return deepseekResult;

  return Response.json({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, { status: 503 });
}

function buildTranslationPrompt(
  targetLang: string,
  sourceLang?: string,
): string {
  const from =
    sourceLang !== undefined && sourceLang.length > 0
      ? ` from ${sourceLang}`
      : '';
  return (
    `You are a translator. Translate the text${from} to ${targetLang}. ` +
    `Preserve the tone, register, and meaning exactly. ` +
    `Return only the translation. No explanation. No preamble.`
  );
}

async function groqTranslate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  apiKey: string,
): Promise<Response> {
  try {
    const response = await fetch(GROQ_CHAT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return response;

    const data = (await response.json()) as {
      choices: {
        message: { content: string };
      }[];
    };

    const translation = data.choices[0]?.message?.content?.trim() ?? '';

    if (translation.length === 0) {
      return Response.json({ error: 'EKWE_TRANSLATION_FAIL' }, { status: 500 });
    }

    return Response.json({ translation });
  } catch {
    return Response.json({ error: 'EKWE_NETWORK_LOST' }, { status: 503 });
  }
}

async function deepSeekTranslate(
  text: string,
  targetLang: string,
  sourceLang: string | undefined,
  apiKey: string,
): Promise<Response> {
  try {
    const response = await fetch(DEEPSEEK_CHAT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
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
        max_tokens: 1000,
        temperature: 0.1,
      }),
    });

    if (!response.ok) return response;

    const data = (await response.json()) as {
      choices: {
        message: { content: string };
      }[];
    };

    const translation = data.choices[0]?.message?.content?.trim() ?? '';

    if (translation.length === 0) {
      return Response.json({ error: 'EKWE_TRANSLATION_FAIL' }, { status: 500 });
    }

    return Response.json({ translation });
  } catch {
    return Response.json({ error: 'EKWE_NETWORK_LOST' }, { status: 503 });
  }
}
