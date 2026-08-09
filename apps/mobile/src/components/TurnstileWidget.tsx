/**
 * TurnstileWidget — invisible Cloudflare Turnstile challenge for native apps.
 *
 * Turnstile only runs in a browser, so this renders a hidden WebView that
 * auto-solves the challenge and posts the token back to React Native. The
 * token is single-use (300s TTL) and must be validated server-side via
 * siteverify before the protected action runs.
 *
 * The widget re-renders automatically when a token expires so the screen
 * always holds a fresh token while mounted.
 */
import React, { useCallback, useEffect, useMemo, useRef } from "react";
import { WebView, WebViewMessageEvent } from "react-native-webview";

import logger from "@/utils/logger";

const DEFAULT_BASE_URL = "https://ekwe.app";

interface TurnstileWidgetProps {
  sitekey: string;
  action?: string;
  onToken: (token: string) => void;
  onError?: (message?: string) => void;
}

const buildHtml = (sitekey: string, action: string): string => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' https://challenges.cloudflare.com 'unsafe-inline'; connect-src 'self' https://challenges.cloudflare.com; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline';" />
  <script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit&onload=onTurnstileLoaded" async defer></script>
</head>
<body style="margin:0;padding:0;background:transparent">
  <div id="ts"></div>
  <script>
    function post(type, payload) {
      window.ReactNativeWebView.postMessage(JSON.stringify({ type: type, ...(payload || {}) }));
    }
    function onTurnstileLoaded() {
      try {
        if (!window.turnstile) { post('error', { error: 'turnstile-not-loaded' }); return; }
        window.turnstile.render('ts', {
          sitekey: ${JSON.stringify(sitekey)},
          action: ${JSON.stringify(action)},
          callback: function (token) { post('token', { token: token }); },
          'error-callback': function (code) { post('error', { error: code }); },
          'expired-callback': function () { post('expired'); },
        });
      } catch (e) { post('error', { error: String(e) }); }
    }
    var deadline = setTimeout(function () { post('error', { error: 'turnstile-timeout' }); }, 15000);
    window.addEventListener('message', function () { window.clearTimeout(deadline); }, { once: true });
  </script>
</body>
</html>`;

export const TurnstileWidget = ({
  sitekey,
  action = "send_otp",
  onToken,
  onError,
}: TurnstileWidgetProps): React.ReactElement => {
  const onTokenRef = useRef(onToken);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    onTokenRef.current = onToken;
  }, [onToken]);
  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  const html = useMemo(() => buildHtml(sitekey, action), [sitekey, action]);
  const baseUrl =
    process.env.EXPO_PUBLIC_TURNSTILE_BASE_URL || DEFAULT_BASE_URL;

  const handleMessage = useCallback((event: WebViewMessageEvent): void => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as {
        type?: string;
        token?: string;
        error?: string;
      };
      if (data.type === "token" && typeof data.token === "string") {
        onTokenRef.current?.(data.token);
      } else if (data.type === "error") {
        logger.warn("[Turnstile] widget error:", data.error);
        onErrorRef.current?.(data.error);
      } else if (data.type === "expired") {
        onTokenRef.current?.("");
        onErrorRef.current?.("expired");
      }
    } catch (err) {
      logger.warn("[Turnstile] invalid message:", err);
    }
  }, []);

  return (
    <WebView
      source={{ html, baseUrl }}
      originWhitelist={["*"]}
      javaScriptEnabled
      domStorageEnabled
      setSupportMultipleWindows={false}
      onMessage={handleMessage}
      style={{ width: 1, height: 1, opacity: 0 }}
      containerStyle={{ width: 1, height: 1, opacity: 0 }}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    />
  );
};
