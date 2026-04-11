import { useAuth as copyClerkUseAuth, useUser } from '@clerk/clerk-expo';
import { useCallback } from 'react';

export const useAuth = () => {
  const { isLoaded, isSignedIn, signOut, sessionId, getToken } =
    copyClerkUseAuth();
  const { user } = useUser();

  const handleSignOut = useCallback(async () => {
    try {
      await signOut();
    } catch (error) {
      console.error('[useAuth] Error signing out:', error);
    }
  }, [signOut]);

  const tier = (user?.publicMetadata?.tier as 'free' | 'pro') || 'free';

  return {
    isLoaded,
    isSignedIn,
    user,
    tier,
    signOut: handleSignOut,
    sessionId,
    getToken,
  };
};
