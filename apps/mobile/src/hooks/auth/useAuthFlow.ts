/**
 * useAuthFlow — Shared auth handler for social sign-in + success routing.
 *
 * Eliminates copy-pasted handleApple/handleGoogle/handleAuthSuccess
 * across every auth screen. Screens call `run()` or the social helpers.
 */
import { useRouter } from "expo-router";
import { useState, useCallback } from "react";

import { signInWithApple, signInWithGoogle, AuthResult } from "@/services/auth";

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
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const clearError = useCallback((): void => setError(""), []);

  const onSuccess = useCallback((): void => {
    router.replace("/(tabs)");
  }, [router]);

  const run = useCallback(
    async (fn: () => Promise<AuthResult>): Promise<AuthResult> => {
      setIsLoading(true);
      setError("");
      try {
        const result = await fn();

        if (result.ok && !result.needsOtp) {
          onSuccess();
        } else if (result.error) {
          setError(result.error);
        }

        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [onSuccess],
  );

  const handleSocial = useCallback(
    (signIn: () => Promise<AuthResult>): Promise<AuthResult> =>
      run(async () => {
        const result = await signIn();
        if (result.needsLink) {
          router.push({
            pathname: "/(auth)/verify",
            params: { email: result.needsLink.email, source: "link" },
          });
        }
        return result;
      }),
    [run, router],
  );

  const handleApple = useCallback(
    (): Promise<AuthResult> => handleSocial(signInWithApple),
    [handleSocial],
  );

  const handleGoogle = useCallback(
    (): Promise<AuthResult> => handleSocial(signInWithGoogle),
    [handleSocial],
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
