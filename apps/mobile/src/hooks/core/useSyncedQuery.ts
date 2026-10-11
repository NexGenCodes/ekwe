import { observable, syncState } from "@legendapp/state";
import type { ObservableParam } from "@legendapp/state";
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
  query$: ObservableParam<unknown>;
  invalidate: () => void;
}

type ResetHandler = () => Promise<void>;

const userScopedResetters = new Set<ResetHandler>();

export function registerUserScopedQuery(reset: ResetHandler): void {
  userScopedResetters.add(reset);
}

export async function resetUserScopedQueries(): Promise<void> {
  await Promise.allSettled([...userScopedResetters].map((fn) => fn()));
}

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
    // `observable(synced(...))` widens to a union that TS cannot reconcile with
    // `ObservableParam`; the runtime value is the mutable synced observable.
  ) as unknown as ObservableParam<unknown>;

  // Legend v3 exposes the sync state through the standalone `syncState()`
  // helper, not as a `query$.syncState` property — reading that property
  // yields `{}` and calling anything off it throws "Object is not a function".
  const sync$ = syncState(query$);

  registerUserScopedQuery(() => {
    query$.set(undefined);
    return Promise.resolve();
  });

  function useQuery(): SyncedQueryResult<T>["useQuery"] extends (
    ...args: never[]
  ) => infer R
    ? R
    : never {
    const data = useValue(query$);
    const syncStatus = useValue(sync$);

    return {
      data: data as T | undefined,
      isLoading: syncStatus.isGetting ?? false,
      isError: !!syncStatus.error,
      error: syncStatus.error,
      refetch: (): void => {
        void sync$.sync();
      },
    };
  }

  function invalidate(): void {
    void sync$.sync();
  }

  return {
    useQuery,
    query$,
    invalidate,
  };
}
