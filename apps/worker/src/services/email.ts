import type { Env } from "@/core/types";
import { logger } from "@/core/logger";
import { renderOtpEmail } from "@/services/emailTemplates";

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

const BREVO_ENDPOINT = "https://api.brevo.com/v3/smtp/email";

async function sendViaBrevo(env: Env, message: EmailMessage): Promise<boolean> {
  if (!env.BREVO_API_KEY || !env.BREVO_SENDER) {
    logger.error("[email] Brevo is not configured");
    return false;
  }

  try {
    const response = await fetch(BREVO_ENDPOINT, {
      method: "POST",
      headers: {
        "api-key": env.BREVO_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      signal: AbortSignal.timeout(10_000),
      body: JSON.stringify({
        sender: {
          email: env.BREVO_SENDER,
          name: env.BREVO_SENDER_NAME ?? "Ekwe",
        },
        to: [{ email: message.to }],
        subject: message.subject,
        htmlContent: message.html,
        textContent: message.text,
      }),
    });

    if (!response.ok) {
      const body = (await response.text().catch(() => "")).slice(0, 300);
      logger.error("[email] Brevo rejected the message", {
        status: response.status,
        body,
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error("[email] Brevo request failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

async function sendViaBinding(
  env: Env,
  message: EmailMessage,
): Promise<boolean> {
  if (!env.EMAIL || !env.BREVO_SENDER) return false;

  try {
    await env.EMAIL.send({
      to: message.to,
      from: { email: env.BREVO_SENDER, name: env.BREVO_SENDER_NAME ?? "Ekwe" },
      subject: message.subject,
      html: message.html,
      text: message.text,
    });
    return true;
  } catch (error) {
    logger.error("[email] binding send failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

export async function sendEmail(
  env: Env,
  message: EmailMessage,
): Promise<boolean> {
  if (env.EMAIL && (await sendViaBinding(env, message))) return true;
  return sendViaBrevo(env, message);
}

export function sendOtpEmail(
  env: Env,
  to: string,
  code: string,
  expiryMinutes: number,
): Promise<boolean> {
  const { html, text } = renderOtpEmail(code, expiryMinutes);
  return sendEmail(env, {
    to,
    subject: "Your Ekwe Login Code",
    html,
    text,
  });
}
