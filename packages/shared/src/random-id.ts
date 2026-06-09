const RANDOM_ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/**
 * Generate a short URL/database friendly random identifier suffix.
 */
export function randomId(length = 12): string {
  const normalizedLength = Number.isFinite(length) && length > 0 ? Math.floor(length) : 12;
  const bytes = new Uint8Array(normalizedLength);
  const cryptoApi = globalThis.crypto;

  if (cryptoApi?.getRandomValues) {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let index = 0; index < bytes.length; index += 1) {
      bytes[index] = Math.floor(Math.random() * 256);
    }
  }

  let output = "";
  for (const byte of bytes) {
    output += RANDOM_ID_ALPHABET[byte % RANDOM_ID_ALPHABET.length];
  }
  return output;
}
