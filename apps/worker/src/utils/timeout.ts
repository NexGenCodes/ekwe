export async function withTimeout<T>(
  ms: number,
  label: string,
  signal: AbortSignal,
  open: () => Promise<T>,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new Error(`${label} aborted`));
      return;
    }
    let settled = false;
    const timer = setTimeout(() => {
      finish(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
    const onAbort = (): void => {
      finish(new Error(`${label} aborted`));
    };
    const finish = (err: Error | null, value?: T): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      if (err) reject(err);
      else resolve(value as T);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    open().then(
      (value) => finish(null, value),
      (err) => finish(err instanceof Error ? err : new Error(String(err))),
    );
  });
}
