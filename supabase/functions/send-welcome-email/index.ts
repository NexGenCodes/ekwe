import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Types for the Supabase Database Webhook payload
interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: {
    id: string;
    email?: string;
    [key: string]: any;
  };
  old_record: any | null;
}

const BREVO_API_KEY = Deno.env.get("BREVO_SMTP_PASS") || "";
const SENDER_EMAIL = "admin@ekwe.app";
const SENDER_NAME = "Ekwe";

serve(async (req) => {
  try {
    // Parse the webhook payload
    const payload: WebhookPayload = await req.json();

    // We only care about new users being inserted into auth.users
    if (payload.type === "INSERT" && payload.table === "users") {
      const userEmail = payload.record.email;

      if (!userEmail) {
        return new Response(
          JSON.stringify({ error: "No email found in record" }),
          { status: 400 },
        );
      }

      // Prepare the payload for Brevo's Transactional Email API
      const emailPayload = {
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: userEmail }],
        subject: "Welcome to Ekwe! 🎉",
        htmlContent: `
          <html>
            <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
              <div style="max-width: 600px; margin: 0 auto; padding: 20px;">
                <h2 style="color: #4A90E2;">Welcome to Ekwe!</h2>
                <p>Hi there,</p>
                <p>We're thrilled to have you join us. Ekwe is designed to help you unlock your creativity.</p>
                <p>If you have any questions or need help getting started, just reply to this email!</p>
                <br />
                <p>Best regards,<br/>The Ekwe Team</p>
              </div>
            </body>
          </html>
        `,
      };

      // Send the email via Brevo API
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          accept: "application/json",
          "api-key": BREVO_API_KEY,
          "content-type": "application/json",
        },
        body: JSON.stringify(emailPayload),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("Brevo API Error:", errorText);
        return new Response(JSON.stringify({ error: "Failed to send email" }), {
          status: response.status,
        });
      }

      return new Response(
        JSON.stringify({ success: true, message: "Welcome email sent" }),
        {
          headers: { "Content-Type": "application/json" },
          status: 200,
        },
      );
    }

    return new Response(
      JSON.stringify({ message: "Ignored: not an INSERT on auth.users" }),
      { status: 200 },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    console.error("Edge Function Error:", errorMessage);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
    });
  }
});
