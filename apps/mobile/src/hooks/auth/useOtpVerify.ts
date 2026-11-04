import { useState, useCallback, useEffect } from "react";

import { verifyOtp, sendOtp, AuthResult } from "@/services/auth";
import { track, AnalyticsEvents } from "@/utils/analytics";

interface OtpVerifyHook {
  isLoading: boolean;
  isVerifying: boolean;
  isResending: boolean;
  error: string;
  cooldown: number;
  verify: (email: string, token: string) => Promise<AuthResult>;
  resend: (email: string) => Promise<boolean>;
}

export function useOtpVerify(): OtpVerifyHook {
  const [isVerifying, setIsVerifying] = useState(false);
  const [isResending, setIsResending] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  const isLoading = isVerifying || isResending;

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return (): void => clearTimeout(timer);
    }
  }, [cooldown]);

  const verify = useCallback(
    async (email: string, token: string): Promise<AuthResult> => {
      setIsVerifying(true);
      setError("");
      try {
        const result = await verifyOtp(email, token);
        if (!result.ok) setError(result.error || "Verification failed");
        return result;
      } finally {
        setIsVerifying(false);
      }
    },
    [],
  );

  const resend = useCallback(
    async (email: string): Promise<boolean> => {
      if (cooldown > 0) return false;
      setIsResending(true);
      setError("");
      try {
        const result = await sendOtp(email);
        if (result.ok) {
          track(AnalyticsEvents.AUTH_OTP_RESENT, { method: "otp" });
          setCooldown(60);
          return true;
        }
        setError(result.error || "Failed to resend code");
        return false;
      } finally {
        setIsResending(false);
      }
    },
    [cooldown],
  );

  return {
    isLoading,
    isVerifying,
    isResending,
    error,
    cooldown,
    verify,
    resend,
  };
}
