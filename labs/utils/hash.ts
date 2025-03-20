/**
 * Generate a hash string from any number of input strings
 *
 * @param inputs - Any number of strings to be hashed together
 * @returns An 8-character hex string hash
 */
export function hash(...inputs: string[]): string {
  // Combine all inputs with a delimiter
  const dataToHash = inputs.join();

  // Simple hash function using a variant of djb2
  let hashValue = 0;

  for (let i = 0; i < dataToHash.length; i++) {
    const char = dataToHash.charCodeAt(i);
    hashValue = ((hashValue << 5) - hashValue + char) | 0; // Force 32-bit integer with | 0
  }

  // Convert to 8-character hex string with consistent sign handling
  const hashUint = hashValue < 0 ? hashValue + 4294967296 : hashValue; // Convert negative to positive
  const hashStr = hashUint.toString(16).padStart(8, '0');

  return hashStr;
}
