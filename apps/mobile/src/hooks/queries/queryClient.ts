import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 1000 * 60 * 5,
      retry: 2,
      gcTime: 1000 * 60 * 30,
      refetchOnWindowFocus: false,
      // `onlineManager` is wired to NetInfo in services/networkMonitor.ts, so
      // in React Native this actually pauses queries when the device drops
      // offline instead of erroring, and refetches them on reconnect.
      networkMode: "online",
      refetchOnReconnect: true,
    },
    mutations: {
      // Manage offline behavior in the service layer (fail-fast → NETWORK_LOST
      // via the network store) rather than letting TanStack pause mutations.
      // `always` guarantees mutationFn always runs, so the result is
      // deterministic and testable — no surprise "paused" hangs in the Echo
      // state machine while offline.
      networkMode: "always",
      retry: 2,
      retryDelay: (attemptIndex: number): number =>
        Math.min(1000 * 2 ** attemptIndex, 10000),
    },
  },
});
