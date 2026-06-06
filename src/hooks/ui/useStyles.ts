import { useRef, useMemo } from "react";

import type { Tokens } from "./useTokens";
import { useTokens } from "./useTokens";

export function useStyles<T>(factory: (tokens: Tokens) => T): T {
  const tokens = useTokens();
  const factoryRef = useRef(factory);
  factoryRef.current = factory;
  return useMemo(() => factoryRef.current(tokens), [tokens]);
}
