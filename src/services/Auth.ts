import { Clerk } from '@clerk/clerk-expo';

export const AuthService = {
  async getToken(): Promise<string | null> {
    try {
      const session = Clerk.session;
      if (!session) return null;
      return await session.getToken();
    } catch {
      return null;
    }
  },

  isAuthenticated(): boolean {
    return !!Clerk.session;
  },

  getUserTier(): 'free' | 'pro' {
    const user = Clerk.user;
    if (!user) return 'free';

    // Typically you can store user tier in Clerk's public metadata
    // e.g., user.publicMetadata.tier === 'pro'
    const publicMetadata = user.publicMetadata as { tier?: string };
    if (publicMetadata?.tier === 'pro') {
      return 'pro';
    }

    return 'free';
  },
};
