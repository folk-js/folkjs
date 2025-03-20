/**
 * Base64-encoded 8-character hash using FNV-1a
 * Roughly 2^48 possible values
 * @param data - The data to hash
 * @returns An 8-character Base64 hash string
 */
export function hash(...data: string[]): string {
  const dataToHash = data.join();

  // Simple non-cryptographic hash function (FNV-1a)
  let hash = 2166136261; // FNV offset basis
  for (let i = 0; i < dataToHash.length; i++) {
    hash ^= dataToHash.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }

  // Convert to Base64 and truncate
  const hashHex = (hash >>> 0).toString(16).padStart(8, '0');
  const hashBytes = new Uint8Array(4);
  for (let i = 0; i < 4; i++) {
    hashBytes[i] = parseInt(hashHex.substring(i * 2, i * 2 + 2), 16);
  }

  const hashBase64 = btoa(String.fromCharCode(...hashBytes));
  return hashBase64.substring(0, 8);
}
