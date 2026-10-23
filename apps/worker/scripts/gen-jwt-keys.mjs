import { generateKeyPair, exportJWK } from "jose";

const { privateKey, publicKey } = await generateKeyPair("EdDSA", {
  crv: "Ed25519",
  extractable: true,
});

const privateJwk = await exportJWK(privateKey);
const publicJwk = await exportJWK(publicKey);
const pepper = crypto.randomUUID() + crypto.randomUUID();

console.log("JWT_PRIVATE_JWK  -> wrangler secret put JWT_PRIVATE_JWK");
console.log(JSON.stringify(privateJwk));
console.log("");
console.log("JWT_PUBLIC_JWK   -> wrangler.jsonc vars");
console.log(JSON.stringify(publicJwk));
console.log("");
console.log("OTP_PEPPER       -> wrangler secret put OTP_PEPPER");
console.log(pepper);
