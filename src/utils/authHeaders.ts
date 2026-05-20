import { supabase } from '@/services/supabase';
import { logger } from '@/utils';

/**
 * Utility to get current auth headers for the API Worker.
 * Gracefully returns empty headers when the Supabase session is unavailable
 * (e.g., in a context where auth hasn't hydrated yet).
 *
 * Uses supabase.auth.getSession() instead of local state to guarantee
 * the token is auto-refreshed if it has expired.
 */
export const getAuthHeaders = async (
  headers: HeadersInit = {},
): Promise<HeadersInit> => {
  try {
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

    if (data?.session?.access_token) {
      return {
        ...headers,
        Authorization: `Bearer ${data.session.access_token}`,
      };
    }
  } catch (error) {
    logger.warn(
      '[AuthHeaders] Supabase session unavailable or expired:',
      (error as Error).message,
    );
  }
  return headers;
};
