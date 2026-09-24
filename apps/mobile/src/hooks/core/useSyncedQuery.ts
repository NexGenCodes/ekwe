import { observable } from "@legendapp/state";
import { synced } from "@legendapp/state/sync";
import { useValue } from "@legendapp/state/react";
import { mmkvPlugin } from "@/store/mmkvPlugin";

interface SyncedQueryResult<T> {
  useQuery: () => {
    data: T | undefined;
    isLoading: boolean;
    isError: boolean;
    error: unknown;
    refetch: () => void;
  };
  query$: ReturnType<typeof observable>;
  invalidate: () => void;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Legend State synced observables expose syncState at runtime but not in static types
type SyncedObservable = ReturnType<typeof observable> & { syncState?: any };

export function createSyncedQuery<T>(
  cacheKey: string,
  fetchFn: () => Promise<T>,
): SyncedQueryResult<T> {
  const query$ = observable(
    synced({
      get: fetchFn,
      persist: {
        name: cacheKey,
        plugin: mmkvPlugin,
      },
    }),
  ) as SyncedObservable;

  function useQuery(): SyncedQueryResult<T>["useQuery"] extends (
    ...args: never[]
  ) => infer R
    ? R
    : never {
    const data = useValue(query$);
    const syncState = useValue(query$.syncState);

    return {
      data: data as T | undefined,
      isLoading: syncState?.isSyncing ?? false,
      isError: !!syncState?.error,
      error: syncState?.error,
      refetch: (): void => {
        query$.syncState?.refresh?.();
      },
    };
  }

  function invalidate(): void {
    query$.syncState?.refresh?.();
  }

  return {
    useQuery,
    query$,
    invalidate,
  };
}
