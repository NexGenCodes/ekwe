import { ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

/**
 * Share intent handling is done natively. This provider is a no-op.
 */
export function ShareIntentProvider({ children }: Props): ReactNode {
  return children;
}
