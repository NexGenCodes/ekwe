import { auth$ } from '@/store';
import { logger } from '@/utils';

/**
 * Utility to get current auth headers for the API Worker.
 * Gracefully returns empty headers when the Supabase session is unavailable
 * (e.g., in a context where auth hasn't hydrated yet).
 */
export const getAuthHeaders = async (
  headers: HeadersInit = {},
): Promise<HeadersInit> => {
  try {
    const session = auth$.session.get();
    if (session?.access_token) {
      return {
        ...headers,
        Authorization: `Bearer ${session.access_token}`,
      };
    }
  } catch (error) {
    logger.warn(
      '[AuthHeaders] Supabase session unavailable:',
      (error as Error).message,
    );
  }
  return headers;
};
