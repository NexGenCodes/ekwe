const LOGO_URL = "https://ekwe.pages.dev/logo.png";

export interface OtpEmailContent {
  html: string;
  text: string;
}

export function renderOtpEmail(
  code: string,
  expiryMinutes: number,
): OtpEmailContent {
  return {
    html: `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <meta name="supported-color-schemes" content="light dark" />
    <title>Your Ekwe Login Code</title>
    <style>
      :root { color-scheme: light dark; }

      @media (prefers-color-scheme: dark) {
        body, .bg-body { background-color: #0a0a0a !important; }
        .bg-container { background-color: #141414 !important; }
        .border-container { border-color: #262626 !important; }
        .text-heading { color: #ffffff !important; }
        .text-body { color: #a3a3a3 !important; }
        .text-muted { color: #525252 !important; }
        .bg-otp { background-color: #1a1a1a !important; }
        .border-otp { border-color: #333333 !important; }
        .text-otp { color: #ffffff !important; }
        .border-footer { border-top-color: #262626 !important; }
        .text-footer { color: #404040 !important; }
      }
    </style>
  </head>
  <body
    class="bg-body"
    style="
      margin: 0;
      padding: 0;
      background-color: #f5f5f5;
      font-family:
        -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    "
  >
    <table
      role="presentation"
      width="100%"
      cellpadding="0"
      cellspacing="0"
      class="bg-body"
      style="background-color: #f5f5f5; padding: 40px 20px"
    >
      <tr>
        <td align="center">
          <table
            role="presentation"
            width="420"
            cellpadding="0"
            cellspacing="0"
            class="bg-container border-container"
            style="
              background-color: #ffffff;
              border-radius: 16px;
              border: 1px solid #e5e5e5;
              overflow: hidden;
            "
          >
            <tr>
              <td style="padding: 32px 32px 0; text-align: center">
                <img
                  src="${LOGO_URL}"
                  alt="Ekwe"
                  width="88"
                  height="88"
                  style="
                    border: 0;
                    outline: none;
                    text-decoration: none;
                    margin-bottom: 16px;
                  "
                />
                <h1
                  class="text-heading"
                  style="
                    margin: 0;
                    font-size: 24px;
                    font-weight: 700;
                    color: #171717;
                    letter-spacing: -0.02em;
                  "
                >
                  Ekwe
                </h1>
              </td>
            </tr>

            <tr>
              <td style="padding: 24px 32px 8px; text-align: center">
                <p
                  class="text-body"
                  style="
                    margin: 0;
                    font-size: 15px;
                    color: #525252;
                    line-height: 1.6;
                  "
                >
                  Enter this code to sign in to your account:
                </p>
              </td>
            </tr>

            <tr>
              <td style="padding: 16px 32px; text-align: center">
                <div
                  class="bg-otp border-otp"
                  style="
                    display: inline-block;
                    background-color: #fafafa;
                    border: 1px solid #d4d4d4;
                    border-radius: 12px;
                    padding: 20px 40px;
                    letter-spacing: 0.35em;
                  "
                >
                  <span
                    class="text-otp"
                    style="
                      font-size: 32px;
                      font-weight: 700;
                      color: #171717;
                      font-family:
                        'SF Mono', 'Fira Code', 'Consolas', monospace;
                    "
                  >
                    ${code}
                  </span>
                </div>
              </td>
            </tr>

            <tr>
              <td style="padding: 8px 32px 32px; text-align: center">
                <p
                  class="text-muted"
                  style="
                    margin: 0;
                    font-size: 13px;
                    color: #a3a3a3;
                    line-height: 1.5;
                  "
                >
                  This code expires in ${expiryMinutes} minutes.<br />
                  If you didn't request this, you can safely ignore this email.
                </p>
              </td>
            </tr>

            <tr>
              <td
                class="border-footer"
                style="
                  padding: 20px 32px;
                  text-align: center;
                  border-top: 1px solid #e5e5e5;
                "
              >
                <p class="text-footer" style="margin: 0; font-size: 12px; color: #a3a3a3">
                  &copy; Ekwe &mdash; Your voice, transcribed.
                </p>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`,
    text: `Your Ekwe verification code is ${code}. It expires in ${expiryMinutes} minutes.\n\nIf you didn't request this, you can safely ignore this email.\n\n© Ekwe — Your voice, transcribed.`,
  };
}
