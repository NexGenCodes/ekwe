/**
 * useAuthFlow — Shared auth handler for social sign-in + success routing.
 *
 * Eliminates copy-pasted handleApple/handleGoogle/handleAuthSuccess
 * across every auth screen. Screens call `run()` or the social helpers.
 */
import { useRouter } from 'expo-router';
import { useState, useCallback } from 'react';

import {
  signInWithApple,
  signInWithGoogle,
  AuthResult,
} from '@/services/auth';
import { useSettingsStore } from '@/store';

interface UseAuthFlowReturn {
  isLoading: boolean;
  error: string;
  setError: (msg: string) => void;
  clearError: () => void;
  run: (fn: () => Promise<AuthResult>) => Promise<AuthResult>;
  handleApple: () => Promise<AuthResult>;
  handleGoogle: () => Promise<AuthResult>;
  onSuccess: () => void;
}

export const useAuthFlow = (): UseAuthFlowReturn => {
  const router = useRouter();
  const { setOnboardingCompleted } = useSettingsStore();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  const clearError = useCallback((): void => setError(''), []);

  const onSuccess = useCallback((): void => {
    setOnboardingCompleted(true);
    router.replace('/(tabs)');
  }, [setOnboardingCompleted, router]);

  const run = useCallback(
    async (fn: () => Promise<AuthResult>): Promise<AuthResult> => {
      setIsLoading(true);
      setError('');
      const result = await fn();
      setIsLoading(false);

      if (result.ok) {
        onSuccess();
      } else if (result.error) {
        setError(result.error);
      }

      return result;
    },
    [onSuccess],
  );

  const handleApple = useCallback(
    (): Promise<AuthResult> => run(signInWithApple),
    [run],
  );

  const handleGoogle = useCallback(
    (): Promise<AuthResult> => run(signInWithGoogle),
    [run],
  );

  return {
    isLoading,
    error,
    setError,
    clearError,
    run,
    handleApple,
    handleGoogle,
    onSuccess,
  };
};
