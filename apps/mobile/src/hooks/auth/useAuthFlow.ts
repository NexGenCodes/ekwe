import { useRouter } from "expo-router";
import { useState, useCallback } from "react";

import { signInWithApple, signInWithGoogle, AuthResult } from "@/services/auth";

interface UseAuthFlowReturn {
  isLoading: boolean;
  loadingProvider: "apple" | "google" | "email" | null;
  error: string;
  setError: (msg: string) => void;
  clearError: () => void;
  run: (
    fn: () => Promise<AuthResult>,
    provider?: "apple" | "google" | "email",
  ) => Promise<AuthResult>;
  handleApple: () => Promise<AuthResult>;
  handleGoogle: () => Promise<AuthResult>;
  onSuccess: () => void;
}

export const useAuthFlow = (): UseAuthFlowReturn => {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);
  const [loadingProvider, setLoadingProvider] = useState<
    "apple" | "google" | "email" | null
  >(null);
  const [error, setError] = useState("");

  const clearError = useCallback((): void => setError(""), []);

  const onSuccess = useCallback((): void => {
    router.replace("/(tabs)");
  }, [router]);

  const run = useCallback(
    async (
      fn: () => Promise<AuthResult>,
      provider?: "apple" | "google" | "email",
    ): Promise<AuthResult> => {
      setIsLoading(true);
      if (provider) setLoadingProvider(provider);
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
        setLoadingProvider(null);
      }
    },
    [onSuccess],
  );

  const handleApple = useCallback(
    (): Promise<AuthResult> => run(signInWithApple, "apple"),
    [run],
  );

  const handleGoogle = useCallback(
    (): Promise<AuthResult> => run(signInWithGoogle, "google"),
    [run],
  );

  return {
    isLoading,
    loadingProvider,
    error,
    setError,
    clearError,
    run,
    handleApple,
    handleGoogle,
    onSuccess,
  };
};
