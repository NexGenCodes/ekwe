import { useState, useCallback, useEffect } from "react";

import { verifyOtp, sendOtp, AuthResult } from "@/services/auth";
import { track, AnalyticsEvents } from "@/utils/analytics";

interface OtpVerifyHook {
  isLoading: boolean;
  error: string;
  cooldown: number;
  verify: (
    email: string,
    token: string,
    type?: "signup" | "email",
  ) => Promise<AuthResult>;
  resend: (email: string) => Promise<void>;
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
    async (
      email: string,
      token: string,
      type: "signup" | "email" = "email",
    ): Promise<AuthResult> => {
      setIsLoading(true);
      setError("");
      const result = await verifyOtp(email, token, type);
      setIsLoading(false);
      if (!result.ok) setError(result.error || "Verification failed");
      return result;
    },
    [],
  );

  const resend = useCallback(
    async (email: string): Promise<void> => {
      if (cooldown > 0) return;
      setIsLoading(true);
      setError("");
      const result = await sendOtp(email);
      setIsLoading(false);
      if (result.ok) {
        track(AnalyticsEvents.AUTH_OTP_RESENT, { method: "otp" });
        setCooldown(60);
      } else {
        setError(result.error || "Failed to resend code");
      }
    },
    [cooldown],
  );

  return { isLoading, error, cooldown, verify, resend };
}
