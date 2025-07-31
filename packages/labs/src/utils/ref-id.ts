/**
 * Utility class for generating unique reference-based IDs for objects.
 * Uses a WeakMap to associate objects with incrementing numeric or alphabetic IDs.
 */
export class RefID {
  static #refs = new WeakMap();
  static #counter = 0;

  /**
   * Get a unique numeric ID for an object.
   * @param obj - The object to get an ID for
   * @returns A unique numeric ID
   */
  static get(obj: object) {
    if (!this.#refs.has(obj)) {
      this.#refs.set(obj, this.#counter++);
    }
    return this.#refs.get(obj);
  }

  /**
   * Get a unique alphabetic ID for an object (a, b, c, ..., z, aa, ab, etc.).
   * @param obj - The object to get an ID for
   * @returns A unique alphabetic ID string
   */
  static getAlphabetic(obj: object) {
    if (!this.#refs.has(obj)) {
      this.#refs.set(obj, this.#counter++);
    }
    let result = '';
    let num = this.#refs.get(obj);
    while (num >= 0) {
      result = String.fromCharCode(97 + (num % 26)) + result;
      num = Math.floor(num / 26) - 1;
      if (num < 0) break;
    }
    return result;
  }
}
