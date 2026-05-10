/**
 * Auth form validation schemas.
 *
 * Every auth screen uses these with react-hook-form + zodResolver.
 * Validation messages are user-facing — no technical jargon.
 */
import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
  password: z.string().min(1, 'Please enter your password.'),
});

export const signupSchema = z
  .object({
    email: z.string().email('Please enter a valid email address.'),
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const otpSchema = z.object({
  token: z.string().length(6, 'Please enter the 6-digit code.'),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email('Please enter a valid email address.'),
});

export const resetPasswordSchema = z
  .object({
    password: z.string().min(8, 'Password must be at least 8 characters.'),
    confirmPassword: z.string().min(1, 'Please confirm your password.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

// Inferred types — screens use these, never manual interfaces
export type LoginForm = z.infer<typeof loginSchema>;
export type SignupForm = z.infer<typeof signupSchema>;
export type OtpForm = z.infer<typeof otpSchema>;
export type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;
