import { Env, TranscribeResult } from '../types';
import { rotateKeys, isHallucination, fetchWithTimeout, TIMEOUT_FAST, abortableDelay } from '../utils';

const ASSEMBLYAI_UPLOAD = 'https://api.assemblyai.com/v2/upload';
const ASSEMBLYAI_TRANSCRIPT = 'https://api.assemblyai.com/v2/transcript';
const POLL_INTERVAL = 2000;
const MAX_POLLS = 10; // 20s max wait

/**
 * AssemblyAI — async upload → poll pattern.
 * Multi-key rotation. High maintenance (one-time $50 credit).
 */
export async function transcribe(
  blob: Blob,
  lang: string,
  env: Env,
  signal: AbortSignal,
): Promise<TranscribeResult | null> {
  const res = await rotateKeys(
    env,
    'ASSEMBLYAI_KEY_',
    async (key) => {
      // Step 1: Upload audio
      const uploadRes = await fetchWithTimeout(ASSEMBLYAI_UPLOAD, {
        method: 'POST',
        headers: {
          'Authorization': key,
          'Content-Type': 'application/octet-stream',
        },
        body: blob,
      }, TIMEOUT_FAST, signal);

      if (!uploadRes.ok) {
        if (uploadRes.status === 402 || uploadRes.status === 403) {
          console.error('[CREDIT_EXHAUSTED] AssemblyAI key requires manual rotation!');
        } else {
          console.error('[assemblyai] Upload error:', await uploadRes.text().catch(() => ''));
        }
        return new Response(null, { status: uploadRes.status }); // Pass status back to rotateKeys so it can retry
      }
      const { upload_url } = await uploadRes.json() as { upload_url: string };

      // Step 2: Create transcript
      const isAuto = !lang || lang === 'auto';
      const createBody: Record<string, unknown> = { audio_url: upload_url };
      if (isAuto) {
        createBody.language_detection = true;
      } else {
        createBody.language_code = lang;
      }

      const createRes = await fetchWithTimeout(ASSEMBLYAI_TRANSCRIPT, {
        method: 'POST',
        headers: {
          'Authorization': key,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(createBody),
      }, TIMEOUT_FAST, signal);

      if (!createRes.ok) {
        if (createRes.status === 402 || createRes.status === 403) {
          console.error('[CREDIT_EXHAUSTED] AssemblyAI key requires manual rotation!');
        } else {
          console.error('[assemblyai] Create error:', await createRes.text().catch(() => ''));
        }
        return new Response(null, { status: createRes.status });
      }
      const { id } = await createRes.json() as { id: string };

      // Step 3: Poll for result
      for (let i = 0; i < MAX_POLLS; i++) {
        await abortableDelay(POLL_INTERVAL, signal);

        const poll = await fetch(`${ASSEMBLYAI_TRANSCRIPT}/${id}`, {
          headers: { 'Authorization': key },
          signal,
        });

        const data = await poll.json() as AssemblyResult;

        if (data.status === 'completed' && data.text) {
          return new Response(JSON.stringify({ text: data.text, duration: data.audio_duration }), { status: 200 });
        }
        if (data.status === 'error') {
          console.error('[assemblyai] Processing error:', data.error);
          return new Response(null, { status: 500 }); // Break polling
        }
      }
      return new Response(null, { status: 504 }); // Timeout
    },
    signal,
  );

  if (!res?.ok) return null;

  const finalData = await res.json() as { text: string; duration?: number };
  if (!isHallucination(finalData.text)) {
    return { text: finalData.text, provider: 'assemblyai', duration: finalData.duration };
  }

  return null;
}

interface AssemblyResult {
  status?: string;
  text?: string;
  error?: string;
  audio_duration?: number;
}

export const supportsAutoLang = true;
