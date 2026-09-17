import { observable } from "@legendapp/state";
import type { UpdateManifest } from "@/services/otaUpdates";

interface UpdateState {
  /** Latest APK manifest from the startup check, null until it resolves. */
  manifest: UpdateManifest | null;
}

export const update$ = observable<UpdateState>({
  manifest: null,
});
