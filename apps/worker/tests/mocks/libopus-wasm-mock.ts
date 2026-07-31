import { readFileSync } from "node:fs";
import { join } from "node:path";

const wasmPath = join(__dirname, "../../src/utils/libopus.wasm");
const wasmBuffer = readFileSync(wasmPath);
const wasmModule = new WebAssembly.Module(wasmBuffer);

export default wasmModule;
