// Multiple of 3 so every chunk but the last encodes without interior padding.
const B64_CHUNK = 32766;

export function bytesToBase64(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";

  if (bytes.length <= B64_CHUNK) {
    return btoa(String.fromCharCode(...bytes));
  }

  // Encode in slices. Building one latin1 string the size of the input first
  // would hold both it and the base64 result in memory at once.
  let out = "";
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    out += btoa(
      String.fromCharCode(
        ...bytes.subarray(i, Math.min(i + B64_CHUNK, bytes.length)),
      ),
    );
  }
  return out;
}

export function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** Base64 a blob without materialising it whole. */
export async function blobToBase64(blob: Blob): Promise<string> {
  let out = "";
  for (let offset = 0; offset < blob.size; offset += B64_CHUNK) {
    const slice = await blob
      .slice(offset, Math.min(offset + B64_CHUNK, blob.size))
      .arrayBuffer();
    out += btoa(String.fromCharCode(...new Uint8Array(slice)));
  }
  return out;
}
