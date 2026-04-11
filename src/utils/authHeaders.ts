import { Clerk } from '@clerk/clerk-expo';

/**
 * Utility to get current auth headers for the API Worker
 */
export const getAuthHeaders = async (
  headers: HeadersInit = {},
): Promise<HeadersInit> => {
  try {
    // We try to get the clerk token
    const session = Clerk.session;
    if (session) {
      const token = await session.getToken();
      if (token) {
        return {
          ...headers,
          Authorization: `Bearer ${token}`,
        };
      }
    }
  } catch (error) {
    console.error('[AuthHeaders] Error fetching token:', error);
  }
  return headers;
};
