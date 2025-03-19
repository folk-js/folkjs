/**
 * Base36 encoding utilities for numbers up to 46655.
 * Uses alphanumeric characters [0-9a-z] for a compact 3-character representation.
 */

/**
 * Convert a number to 3-char base36 string.
 * @param num Number to encode (0-46655)
 * @returns 3-character base36 string
 * @throws Error if number is out of range
 */
export function numToBase36(num: number): string {
  if (num < 0 || num > 46655) throw new Error('Number out of range');

  // Convert to base36 and pad to 3 characters
  return num.toString(36).padStart(3, '0');
}

/**
 * Convert a 3-char base36 string back to a number.
 * @param str 3-character base36 string
 * @returns Number (0-46655)
 * @throws Error if string length is not 3 or contains invalid characters
 */
export function base36ToNum(str: string): number {
  if (str.length !== 3) throw new Error('Invalid length');

  // Validate characters (only allow 0-9 and a-z)
  if (!/^[0-9a-z]{3}$/.test(str)) throw new Error('Invalid character');

  // Parse base36 string
  return parseInt(str, 36);
}
