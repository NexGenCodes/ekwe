interface Env {
  GROQ_KEY_1: string;
  GROQ_KEY_2: string;
  ASSEMBLYAI_KEY: string;
  DEEPSEEK_KEY: string;
}

interface TranscribeRequest {
  audio: string;
  language?: string;
}

interface TranslateRequest {
  text: string;
  sourceLang: string;
  targetLang: string;
}

interface ErrorResponse {
  error: string;
}

interface TranscribeResponse {
  text: string;
  language: string;
}

interface TranslateResponse {
  translation: string;
}

type ApiResponse = TranscribeResponse | TranslateResponse | ErrorResponse;

const GROQ_WHISPER_URL = 'https://api.groq.com/openai/v1/audio/transcriptions';
const GROQ_LLAMA_URL = 'https://api.groq.com/openai/v1/chat/completions';
const DEEPSEEK_URL = 'https://api.deepseek.com/v1/chat/completions';
const ASSEMBLYAI_URL = 'https://api.assemblyai.com/v2/transcript';

async function tryTranscribeGroq(
  audioBlob: Blob,
  language: string | undefined,
  apiKey: string,
): Promise<Response> {
  const formData = new FormData();
  formData.append('file', audioBlob, 'audio.webm');
  formData.append('model', 'whisper-large-v3');
  if (language) {
    formData.append('language', language);
  }

  return fetch(GROQ_WHISPER_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}` },
    body: formData,
  });
}

async function tryTranscribeAssemblyAI(
  audioBlob: Blob,
  apiKey: string,
): Promise<Response> {
  // Upload audio first
  const uploadRes = await fetch('https://api.assemblyai.com/v2/upload', {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/octet-stream',
    },
    body: audioBlob,
  });

  const uploadData = (await uploadRes.json()) as { upload_url: string };

  // Request transcription
  const transcriptRes = await fetch(ASSEMBLYAI_URL, {
    method: 'POST',
    headers: {
      Authorization: apiKey,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ audio_url: uploadData.upload_url }),
  });

  return transcriptRes;
}

async function tryTranslateGroq(
  text: string,
  sourceLang: string,
  targetLang: string,
  apiKey: string,
): Promise<Response> {
  return fetch(GROQ_LLAMA_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: 'llama-3.3-70b-versatile',
      messages: [
        {
          role: 'system',
          content: `You are a translator. Translate the following text from ${sourceLang} to ${targetLang}. Return only the translation, nothing else.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
    }),
  });
}

async function tryTranslateDeepSeek(
  text: string,
  sourceLang: string,
  targetLang: string,
  apiKey: string,
): Promise<Response> {
  return fetch(DEEPSEEK_URL, {
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
          content: `You are a translator. Translate the following text from ${sourceLang} to ${targetLang}. Return only the translation, nothing else.`,
        },
        { role: 'user', content: text },
      ],
      temperature: 0.3,
    }),
  });
}

function jsonResponse(data: ApiResponse, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    // POST /transcribe
    if (url.pathname === '/transcribe') {
      const formData = await request.formData();
      interface WorkerFormData {
        get(name: string): Blob | string | null;
      }
      const workerFormData = formData as unknown as WorkerFormData;
      const audioFile = workerFormData.get('file') as Blob | null;
      const language = workerFormData.get('language') as string | null;

      if (!audioFile) {
        return jsonResponse({ error: 'EKWE_BAD_FORMAT' }, 400);
      }

      // Try GROQ_KEY_1
      const res1 = await tryTranscribeGroq(
        audioFile,
        language ?? undefined,
        env.GROQ_KEY_1,
      );
      if (res1.ok) {
        const data = (await res1.json()) as TranscribeResponse;
        return jsonResponse(data, 200);
      }
      if (res1.status !== 429) {
        return jsonResponse({ error: 'EKWE_TRANSCRIPTION_FAIL' }, 502);
      }

      // Try GROQ_KEY_2
      const res2 = await tryTranscribeGroq(
        audioFile,
        language ?? undefined,
        env.GROQ_KEY_2,
      );
      if (res2.ok) {
        const data = (await res2.json()) as TranscribeResponse;
        return jsonResponse(data, 200);
      }
      if (res2.status !== 429) {
        return jsonResponse({ error: 'EKWE_TRANSCRIPTION_FAIL' }, 502);
      }

      // Try AssemblyAI
      const res3 = await tryTranscribeAssemblyAI(audioFile, env.ASSEMBLYAI_KEY);
      if (res3.ok) {
        const data = (await res3.json()) as TranscribeResponse;
        return jsonResponse(data, 200);
      }

      return jsonResponse({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, 503);
    }

    // POST /translate
    if (url.pathname === '/translate') {
      const body = (await request.json()) as TranslateRequest;
      const { text, sourceLang, targetLang } = body;

      if (!text || !sourceLang || !targetLang) {
        return jsonResponse({ error: 'EKWE_TRANSLATION_FAIL' }, 400);
      }

      // Try Groq LLaMA
      const res1 = await tryTranslateGroq(
        text,
        sourceLang,
        targetLang,
        env.GROQ_KEY_1,
      );
      if (res1.ok) {
        const data = (await res1.json()) as {
          choices: { message: { content: string } }[];
        };
        return jsonResponse(
          { translation: data.choices[0].message.content },
          200,
        );
      }

      // Try DeepSeek
      const res2 = await tryTranslateDeepSeek(
        text,
        sourceLang,
        targetLang,
        env.DEEPSEEK_KEY,
      );
      if (res2.ok) {
        const data = (await res2.json()) as {
          choices: { message: { content: string } }[];
        };
        return jsonResponse(
          { translation: data.choices[0].message.content },
          200,
        );
      }

      return jsonResponse({ error: 'EKWE_ALL_PROVIDERS_FAIL' }, 503);
    }

    return jsonResponse({ error: 'Not found' }, 404);
  },
};
