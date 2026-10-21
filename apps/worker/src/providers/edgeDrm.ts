/**
 * Microsoft Edge Read Aloud DRM token generation.
 *
 * The service rejects the legacy v1 `Sec-MS-GEC` token (a bare SHA-256 of the
 * five-minute-rounded Windows filetime) with HTTP 403 since around October
 * 2026. The v2 token is `<16 hex CS64>-<64 hex SHA-256>` and the
 * `Sec-MS-GEC-Version` header must start with `2-`.
 *
 * This is a direct port of `rany2/edge-tts` 7.3.1 `src/edge_tts/drm.py`,
 * including its fused first-block hash state. The digest is deliberately not
 * the standard SHA-256 the reference implementation describes: the first
 * round of the salt block uses an adjusted constant, so a WebCrypto digest
 * cannot replace it. Every operation below is 32-bit modular arithmetic, which
 * `Math.imul` and the `>>> 0` shifts keep exact.
 *
 * Reference: https://github.com/rany2/edge-tts/pull/492
 */

const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const WIN_EPOCH_SECONDS = 11644473600;
const TICKS_PER_SECOND = 10_000_000n;

const SHA256_INITIAL = [
  0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c,
  0x1f83d9ab, 0x5be0cd19,
];
const SHA256_STATE = [
  0xfd9fbea2, 0x91243ce7, 0xbe499094, 0xcd2e1e0a, 0x6c006f49, 0x04bd35ab,
  0xfeb0a7e4, 0x03effbd2,
];
const SHA256_SCHEDULE = [
  0xeb24bf9e, 0x1558691f, 0xa0c09ee2, 0x0cfa32ba, 0xa622ee8c, 0xd1dd9491,
  0xc0dd25a0, 0xf9e70ab6, 0xf0c31573, 0x7058ce4e, 0x7188e606, 0x00e5ab33,
  0xd258b060, 0x72766564,
];
const SHA256_ROUND_CONSTANTS = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1,
  0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786,
  0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
  0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a,
  0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];
const SHA256_ADJUSTMENT = 0xc9dc06a7;
const SHA256_BLOCK_CONSTANTS = [
  ...SHA256_ROUND_CONSTANTS.slice(0, 14),
  SHA256_ADJUSTMENT,
  ...SHA256_ROUND_CONSTANTS.slice(15),
];
const SHA256_SIGMA0_ADJUSTMENT = 0x059c0b80;
const SHA256_SIGMA1_ADJUSTMENT = 0x000b92c0;

const CS64_COEFFICIENTS: ReadonlyArray<readonly [number, number]> = [
  [0xe82e91b1, 0xb32700d0],
  [0x44de24c6, 0x88dff51d],
  [0x3beb65bc, 0x29514038],
  [0xc89c5933, 0xb328cbdf],
  [0x8d1ec211, 0xd405b4d5],
  [0x314ef5d5, 0x26e55f3c],
  [0xe92491b1, 0x607801c6],
  [0xf0a5b9d5, 0x82b2c1fb],
  [0x06064cf3, 0xfa51a3da],
  [0xda79fa60, 0x207cc464],
  [0xbed20560, 0x3c3c74f3],
  [0x89f9c9f8, 0xd2d14b61],
  [0x35fa38c6, 0xbb04a2c1],
  [0xcb49e3c6, 0xc5626167],
];
const CS64_FACTOR = 0x82893933;
const CS64_ADJUSTMENT0 = 0xf2f90b1a;
const CS64_ADJUSTMENT1 = 0x0b1a0000;

const u32 = (value: number): number => value >>> 0;
const imul = (left: number, right: number): number =>
  Math.imul(left, right) >>> 0;

function rotr(value: number, bits: number): number {
  return ((value >>> bits) | (value << (32 - bits))) >>> 0;
}

function rol16(value: number): number {
  return ((value << 16) | (value >>> 16)) >>> 0;
}

function sigma0(value: number): number {
  const word = u32(value);
  return (
    ((word >>> 7) ^
      (word << 25) ^
      (word >>> 18) ^
      (word << 14) ^
      (word >>> 3)) >>>
    0
  );
}

function sigma1(value: number): number {
  const word = u32(value);
  return (
    ((word >>> 17) ^
      (word << 15) ^
      (word >>> 19) ^
      (word << 13) ^
      (word >>> 10)) >>>
    0
  );
}

function sha256Rounds(
  state: readonly number[],
  words: readonly number[],
  firstRound = 0,
): number[] {
  let [a, b, c, d, e, f, g, h] = state.map(u32);
  const constants =
    firstRound === 14 ? SHA256_BLOCK_CONSTANTS : SHA256_ROUND_CONSTANTS;

  for (let index = firstRound; index < 64; index += 1) {
    const sum1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
    const choice = g ^ (e & (f ^ g));
    const temp1 = (h + sum1 + choice + constants[index] + words[index]) >>> 0;
    const sum0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
    const majority = (a & b) | (c & (a | b));
    const temp2 = (sum0 + majority) >>> 0;

    h = g;
    g = f;
    f = e;
    e = (d + temp1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (temp1 + temp2) >>> 0;
  }

  return [a, b, c, d, e, f, g, h];
}

function expandSchedule(words: number[], firstWord = 16): void {
  for (let index = firstWord; index < 64; index += 1) {
    words.push(
      (sigma1(words[index - 2]) +
        words[index - 7] +
        sigma0(words[index - 15]) +
        words[index - 16]) >>>
        0,
    );
  }
}

function sha256Init(prefix: Uint8Array): number[] {
  const words: number[] = new Array(14).fill(0);
  words.push(((prefix[0] << 16) | (prefix[1] << 8) | prefix[2]) >>> 0);
  words.push(
    ((prefix[3] << 24) | (prefix[4] << 16) | (prefix[5] << 8) | prefix[6]) >>>
      0,
  );

  for (let index = 16; index < 30; index += 1) {
    let value = SHA256_SCHEDULE[index - 16];
    if (index - 2 >= 14) {
      value +=
        index === 16
          ? sigma1(words[index - 2]) ^ SHA256_SIGMA1_ADJUSTMENT
          : sigma1(words[index - 2]);
    }
    if (index - 7 >= 14) value += words[index - 7];
    if (index - 15 >= 14) {
      value +=
        index === 29
          ? sigma0(words[index - 15]) ^ SHA256_SIGMA0_ADJUSTMENT
          : sigma0(words[index - 15]);
    }
    words.push(value >>> 0);
  }

  words.push(
    (sigma1(words[28]) +
      words[23] +
      sigma0(words[15]) +
      words[14] +
      SHA256_ADJUSTMENT -
      SHA256_ROUND_CONSTANTS[14]) >>>
      0,
  );

  expandSchedule(words, 31);
  const working = sha256Rounds(SHA256_STATE, words, 14);
  return SHA256_INITIAL.map((word, index) => (word + working[index]) >>> 0);
}

function sha256Digest(data: Uint8Array): Uint8Array {
  if (data.length < 7) {
    throw new Error("Token salt must contain at least seven bytes");
  }

  // The first seven bytes seed the fused salt block; the rest of the message
  // starts a fresh block with standard SHA-256 padding.
  const length = 57 + data.length;
  const rest = data.subarray(7);
  const padding = (((55 - length) % 64) + 64) % 64;
  const padded = new Uint8Array(rest.length + 1 + padding + 8);
  padded.set(rest, 0);
  padded[rest.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setBigUint64(padded.length - 8, BigInt(length * 8));

  let state = sha256Init(data.subarray(0, 7));
  for (let offset = 0; offset < padded.length; offset += 64) {
    const words: number[] = [];
    for (let index = 0; index < 16; index += 1) {
      words.push(view.getUint32(offset + index * 4));
    }
    expandSchedule(words);
    const working = sha256Rounds(state, words);
    state = state.map((word, index) => (word + working[index]) >>> 0);
  }

  const digest = new Uint8Array(32);
  const digestView = new DataView(digest.buffer);
  state.forEach((word, index) => digestView.setUint32(index * 4, word));
  return digest;
}

/** Little-endian words of `0x00 || data`, zero-padded to an even count. */
function wordsLe4Even(data: Uint8Array): number[] {
  const prefixed = new Uint8Array(data.length + 1);
  prefixed.set(data, 1);

  const paddedLength = prefixed.length + ((4 - (prefixed.length % 4)) % 4);
  const padded = new Uint8Array(paddedLength);
  padded.set(prefixed);

  const words: number[] = [];
  for (let offset = 0; offset < paddedLength; offset += 4) {
    words.push(
      (padded[offset] |
        (padded[offset + 1] << 8) |
        (padded[offset + 2] << 16) |
        (padded[offset + 3] << 24)) >>>
        0,
    );
  }
  if (words.length % 2 === 1) words.push(0);
  return words;
}

function cs64Digest(data: Uint8Array, digest: Uint8Array): [number, number] {
  const view = new DataView(
    digest.buffer,
    digest.byteOffset,
    digest.byteLength,
  );
  const keyA = view.getUint32(0, true) | 1;
  const keyB = view.getUint32(4, true) | 1;
  const factors = [imul(keyA, CS64_FACTOR), imul(keyB, CS64_FACTOR)];

  const terms = CS64_COEFFICIENTS.map(([coefficient], index) =>
    imul(coefficient, factors[index % 2]),
  );
  const offsets = CS64_COEFFICIENTS.map(([, offset]) => u32(offset));

  wordsLe4Even(data).forEach((word, index) => {
    const even = index % 2 === 0;
    let term = imul(word, even ? keyA : keyB);
    let offset = imul(rol16(word), even ? 0xef0569fb : 0xc31713db);
    if (index === 0) {
      term = (term + imul(CS64_ADJUSTMENT0, factors[0])) >>> 0;
      offset = (offset + CS64_ADJUSTMENT1) >>> 0;
    }
    terms.push(term);
    offsets.push(offset);
  });

  let swapAcc = 0;
  let swapLast = 0;
  let state = 0;
  let acc = 0;

  for (let index = 0; index < terms.length; index += 2) {
    const x = terms[index];
    const y = terms[index + 1];

    let mixed = rol16((offsets[index] + x) >>> 0);
    let product = imul(mixed, 0x76f50f34);
    swapAcc =
      (swapAcc + ((imul(rol16(product), 0xc3efea97) + product) >>> 0)) >>> 0;

    mixed = rol16((offsets[index + 1] + y) >>> 0);
    product = imul(mixed, 0x1881ce3c);
    swapLast = (imul(rol16(product), 0x35bd1ec9) + product) >>> 0;
    swapAcc = (swapAcc + swapLast) >>> 0;

    state = (imul(state, keyA) + x) >>> 0;
    state = imul(rol16(state), 0xcf98b111);
    state = imul(rol16(state), 0x87085b9f);
    state = imul(rol16(state), 0x12ceb96d);
    state = imul(rol16(state), 0x257e1d83);
    acc = (acc + state) >>> 0;

    let second = (imul(state, keyB) + y) >>> 0;
    second = imul(rol16(second), 0xa27416f5);
    second = imul(rol16(second), 0xd38396ff);
    state = imul(rol16(imul(rol16(second), 0x7c932b89)), 0xbfa49f69);
    acc = (acc + state) >>> 0;
  }

  return [u32(swapLast ^ state), u32(swapAcc ^ acc)];
}

function bswap32(value: number): number {
  return (
    (((value & 0xff) << 24) |
      ((value & 0xff00) << 8) |
      ((value >>> 8) & 0xff00) |
      (value >>> 24)) >>>
    0
  );
}

function hexWordLittleEndian(value: number): string {
  return bswap32(value).toString(16).padStart(8, "0").toUpperCase();
}

function hexBytes(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("")
    .toUpperCase();
}

/**
 * Builds the v2 `Sec-MS-GEC` token for the five-minute window containing
 * `unixTimestamp` (milliseconds are accepted and ignored, matching the
 * reference implementation's float timestamp).
 *
 * `unixTimestamp` exists for tests; production calls it with no argument.
 */
export function generateSecMsGecV2(unixTimestamp?: number): string {
  const seconds =
    unixTimestamp === undefined ? Date.now() / 1000 : unixTimestamp;
  const rounded = Math.floor(seconds / 300) * 300;
  const ticks = BigInt(rounded + WIN_EPOCH_SECONDS) * TICKS_PER_SECOND;
  const data = new TextEncoder().encode(`${ticks}${TRUSTED_CLIENT_TOKEN}`);
  const digest = sha256Digest(data);
  const [low, high] = cs64Digest(data, digest);

  return `${hexWordLittleEndian(low)}${hexWordLittleEndian(high)}-${hexBytes(digest)}`;
}
