import { registerRootComponent } from "expo";
import { AppRegistry } from "react-native";
import { useEffect, useState } from "react";

import { preventAutoHideAsync } from "expo-splash-screen";

if (typeof globalThis !== "undefined") {
  globalThis.appStartTime = Date.now();
}

// Hold the native splash from the very first line of JS evaluation. On a cold
// start the window behind the splash is unpainted (styles.xml sets the native
// windowBackground to the splash color), so if the splash auto-hides the
// instant the bundle starts evaluating, you see a black/native void until the
// app's first frame paints. Hooking here guarantees the splash stays up while
// the module graph evaluates; the layout decides exactly when to hideAsync.
preventAutoHideAsync();

// Global unhandled promise rejection handler — logs full stack to Metro
if (typeof ErrorUtils !== "undefined") {
  const origHandler = ErrorUtils.getGlobalHandler();
  ErrorUtils.setGlobalHandler((error, isFatal) => {
    console.error(
      "[GlobalErrorHandler] isFatal:",
      isFatal,
      "message:",
      error?.message,
    );
    console.error("[GlobalErrorHandler] stack:", error?.stack);
    if (origHandler) origHandler(error, isFatal);
  });
}

// ⚠️ Keep the share/Echo module graph OFF the top of this entry. index.js is
// the bundle root for BOTH the main app and the Android share-extension;
// static top-level imports evaluate the instant the bundle loads, so importing
// ShareGate (→ Echo → useEchoFlow → auth → audio pipeline) here would force
// EVERY launcher cold start to parse the whole share graph before the main
// app's first frame. Everything share-related is required lazily below, so a
// plain app cold start never evaluates it.
const loadShareGate = () => require( "@/components/features/Echo").ShareGate;


// The share-extension root is hosted by the native ShareActivity — a
// translucent ReactActivity that renders the share gate OVER the source app (no
// main app opens, no deep link). audioUri/mimeType/sourceApp arrive as launch
// props. ShareGate resolves the signed-in state before mounting the Echo UI:
// signed-in users get the full flow, signed-out users get a "Sign in to use
// Echo" card. Provider wrappers mirror src/app/_layout.tsx so QueryClient /
// SafeArea contexts exist — all required lazily on first mount.
const ShareExtensionRoot = (props) => {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    setReady(true);
  }, []);
  if (!ready) return null;

  const { GestureHandlerRootView } = require("react-native-gesture-handler");
  const { SafeAreaProvider } = require("react-native-safe-area-context");
  const { ErrorBoundary } = require( "@/components/ErrorBoundary");
  const { AppAlertModal } = require( "@/components/AppAlertModal");
  const ShareGate = loadShareGate();


  return (
    <GestureHandlerRootView style={{ flex: 1, backgroundColor: "transparent" }}>
      <SafeAreaProvider>
          <ErrorBoundary>
            <ShareGate {...props} />
            <AppAlertModal />
          </ErrorBoundary>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
};

AppRegistry.registerComponent("share-extension", () => ShareExtensionRoot);

// Main app entry. Android and iOS share paths are handled natively
// (ShareActivity / ShareViewController) and render the extension root
// directly — there is no /share route and no deep-link handoff.
const MainAppWrapper = (props) => {
  const App = require( "@/app/AppEntry").default;
  return <App {...props} />;
};

registerRootComponent(MainAppWrapper);
