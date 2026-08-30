import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

// Types for the Supabase Database Webhook payload
interface WebhookPayload {
  type: "INSERT" | "UPDATE" | "DELETE";
  table: string;
  schema: string;
  record: {
    id: string;
    email?: string;
    [key: string]: unknown;
  };
  old_record: Record<string, unknown> | null;
}

// Brevo SMTP relay — same credentials Supabase Auth already uses for OTP emails.
const SMTP_HOST = "smtp-relay.brevo.com";
const SMTP_PORT = 465;
const SMTP_USER = Deno.env.get("BREVO_SMTP_USER") || "";
const SMTP_PASS = Deno.env.get("BREVO_SMTP_PASS") || "";
const SENDER_EMAIL =
  Deno.env.get("SENDER_EMAIL") || "emmanuelforchinagorom@gmail.com";
const SENDER_NAME = "Ekwe";

// Shared-secret auth for the Database Webhook.
const WEBHOOK_SECRET = Deno.env.get("SEND_WELCOME_EMAIL_SECRET") || "";
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

function timingSafeEqualStr(a: string, b: string): boolean {
  const A = new TextEncoder().encode(a);
  const B = new TextEncoder().encode(b);
  if (A.length !== B.length) return false;
  let diff = 0;
  for (let i = 0; i < A.length; i++) diff |= A[i] ^ B[i];
  return diff === 0;
}

async function isAuthorized(req: Request): Promise<boolean> {
  const provided = req.headers.get("authorization") || "";
  const token = provided.startsWith("Bearer ")
    ? provided.slice("Bearer ".length)
    : provided;
  if (!token) return false;

  const candidates = [WEBHOOK_SECRET, SERVICE_ROLE_KEY].filter(Boolean);
  if (candidates.length === 0) return false;

  for (const candidate of candidates) {
    if (timingSafeEqualStr(token, candidate)) return true;
  }
  return false;
}

// ─── Minimal SMTP client (implicit TLS on 465) ─────────────────────

class LineReader {
  private buffer = "";
  constructor(private conn: Deno.Conn) {}
  async readLine(): Promise<string> {
    const decoder = new TextDecoder();
    while (true) {
      const idx = this.buffer.indexOf("\r\n");
      if (idx >= 0) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 2);
        return line;
      }
      const chunk = new Uint8Array(1024);
      const n = await this.conn.read(chunk);
      if (n === null) throw new Error("SMTP connection closed");
      this.buffer += decoder.decode(chunk.subarray(0, n));
    }
  }
}

async function readResponse(lr: LineReader): Promise<string> {
  const first = await lr.readLine();
  let last = first;
  while (first.length >= 4 && first[3] === "-") {
    const line = await lr.readLine();
    last = line;
    if (line.length < 4 || line[3] !== "-") break;
  }
  return last;
}

async function exchange(
  conn: Deno.Conn,
  lr: LineReader,
  cmd: string,
): Promise<string> {
  await conn.write(new TextEncoder().encode(cmd + "\r\n"));
  const resp = await readResponse(lr);
  const code = parseInt(resp.slice(0, 3), 10);
  if (code >= 400) throw new Error(`SMTP ${cmd.split(" ")[0]}: ${resp}`);
  return resp;
}

function emailMessage(to: string, html: string): string {
  return [
    `From: ${SENDER_NAME} <${SENDER_EMAIL}>`,
    `To: ${to}`,
    "Subject: Welcome to Ekwe!",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "",
    html,
  ].join("\r\n");
}

async function sendWelcomeEmail(to: string, html: string): Promise<void> {
  const conn = await Deno.connectTls({ hostname: SMTP_HOST, port: SMTP_PORT });
  try {
    const lr = new LineReader(conn);
    await readResponse(lr); // 220 greeting
    await exchange(conn, lr, `EHLO ${SMTP_HOST}`);
    await exchange(conn, lr, "AUTH LOGIN");
    await exchange(conn, lr, btoa(SMTP_USER));
    await exchange(conn, lr, btoa(SMTP_PASS)); // 235 auth ok
    await exchange(conn, lr, `MAIL FROM:<${SENDER_EMAIL}>`);
    await exchange(conn, lr, `RCPT TO:<${to}>`);
    await exchange(conn, lr, "DATA"); // 354
    await conn.write(
      new TextEncoder().encode(emailMessage(to, html) + "\r\n.\r\n"),
    );
    const done = await readResponse(lr);
    const code = parseInt(done.slice(0, 3), 10);
    if (code >= 400) throw new Error(`SMTP DATA: ${done}`);
    await exchange(conn, lr, "QUIT");
  } finally {
    try {
      conn.close();
    } catch {
      // ignore
    }
  }
}

const WELCOME_HTML = `
  <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
      <div style="max-width: 600px; margin: 0 auto; padding: 20px; text-align: center;">
        <img
          src="https://ekwe.pages.dev/logo.png"
          alt="Ekwe"
          width="88"
          height="88"
          style="border: 0; outline: none; text-decoration: none;"
        />
        <h2 style="color: #4A90E2;">Welcome to Ekwe!</h2>
        <p>Hi there,</p>
        <p>We're thrilled to have you join us. Ekwe is designed to help you unlock your creativity.</p>
        <p>If you have any questions or need help getting started, just reply to this email!</p>
        <br />
        <p>Best regards,<br/>The Ekwe Team</p>
      </div>
    </body>
  </html>
`;

serve(async (req) => {
  try {
    if (!(await isAuthorized(req))) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
      });
    }

    const payload: WebhookPayload = await req.json();

    if (payload.type === "INSERT" && payload.table === "users") {
      const userEmail = payload.record.email;

      if (!userEmail) {
        return new Response(
          JSON.stringify({ error: "No email found in record" }),
          { status: 400 },
        );
      }

      await sendWelcomeEmail(userEmail, WELCOME_HTML);

      return new Response(
        JSON.stringify({ success: true, message: "Welcome email sent" }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    }

    return new Response(
      JSON.stringify({ message: "Ignored: not an INSERT on auth.users" }),
      { status: 200 },
    );
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
    });
  }
});
