import { observable } from "@legendapp/state";

export const clipboard$ = observable({
  copied: false,
});

let timer: ReturnType<typeof setTimeout> | null = null;

export function setClipboardCopied(): void {
  clipboard$.copied.set(true);
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => clipboard$.copied.set(false), 2000);
}
