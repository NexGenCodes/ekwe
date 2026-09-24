// Test-only stub for the Workers runtime module `cloudflare:sockets`.
// The real module only exists in the Cloudflare runtime; vitest runs in Node.
// Edge TTS is always mocked in the unit suite, so this only needs to be
// import-safe — it is never actually invoked.
export function connect(): undefined {
  return undefined;
}
