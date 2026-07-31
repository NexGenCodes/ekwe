/**
 * Auth form validation schemas.
 *
 * Every auth screen uses these with react-hook-form + zodResolver.
 * Validation messages are user-facing — no technical jargon.
 */
import { z } from "zod";

export const loginSchema = z.object({
  email: z.string().email("Please enter a valid email address."),
});

export const otpSchema = z.object({
  token: z.string().length(6, "Please enter the 6-digit code."),
});

// Inferred types — screens use these, never manual interfaces
export type LoginForm = z.infer<typeof loginSchema>;
export type OtpForm = z.infer<typeof otpSchema>;
