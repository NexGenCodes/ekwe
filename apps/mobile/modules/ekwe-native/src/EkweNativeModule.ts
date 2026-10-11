// From `expo`, which re-exports it. `expo-modules-core` is a transitive
// dependency and is not resolvable from here.
import { requireNativeModule } from "expo";

import { type EkweNativeModuleType } from "./EkweNative.types";

const NativeModule = requireNativeModule<EkweNativeModuleType>("EkweNative");

export default NativeModule;
