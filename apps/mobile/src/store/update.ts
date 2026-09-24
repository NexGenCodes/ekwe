import { observable } from "@legendapp/state";
import type { UpdateManifest } from "@/services/otaUpdates";

export type UpdateChannel = "store" | "apk-sideload";

interface UpdateState {
  manifest: UpdateManifest | null;
  channel: UpdateChannel;
}

export const update$ = observable<UpdateState>({
  manifest: null,
  channel: "apk-sideload",
});
