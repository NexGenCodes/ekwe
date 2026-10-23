import { useState, useCallback, useEffect } from "react";

import { verifyOtp, sendOtp, AuthResult } from "@/services/auth";
import { track, AnalyticsEvents } from "@/utils/analytics";

interface OtpVerifyHook {
  isLoading: boolean;
  error: string;
  cooldown: number;
  verify: (email: string, token: string) => Promise<AuthResult>;
  resend: (email: string) => Promise<boolean>;
}

export function useOtpVerify(): OtpVerifyHook {
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown > 0) {
      const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
      return (): void => clearTimeout(timer);
    }
  }, [cooldown]);

  const verify = useCallback(
    async (email: string, token: string): Promise<AuthResult> => {
      setIsLoading(true);
      setError("");
      try {
        const result = await verifyOtp(email, token);
        if (!result.ok) setError(result.error || "Verification failed");
        return result;
      } finally {
        setIsLoading(false);
      }
    },
    [],
  );

  const resend = useCallback(
    async (email: string): Promise<boolean> => {
      if (cooldown > 0) return false;
      setIsLoading(true);
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
        setIsLoading(false);
      }
    },
    [cooldown],
  );

  return { isLoading, error, cooldown, verify, resend };
}
