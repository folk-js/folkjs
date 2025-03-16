/**
 * A spatial hash. For an explanation, see
 * https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/spatial-hashing-r2697/
 *
 * For computational efficiency, the positions are bit-shifted n times. This means that they are divided by a factor of power of two.
 *
 * Ported from https://zufallsgenerator.github.io/assets/code/2014-01-26/spatialhash/spatialhash.js
 */

export class SpatialHash<T> {
  #rects = new Map<T, DOMRectReadOnly>();
  #hash = new Map<string, Set<T>>();

  add(object: T, rect: DOMRectReadOnly): void {
    this.#rects.set(object, rect);

    for (const key of this.#getKeys(rect)) {
      let rects = this.#hash.get(key);

      if (rects === undefined) {
        rects = new Set();
        this.#hash.set(key, rects);
      }

      rects.add(object);
    }
  }

  update(object: T, rect: DOMRectReadOnly) {
    const previousRect = this.#rects.get(object);

    if (previousRect !== undefined) {
      const keysToDelete = new Set([...this.#getKeys(previousRect)].filter((x) => !this.#getKeys(rect).has(x)));

      for (const key of keysToDelete) {
        this.#hash.get(key)?.delete(object);
      }
    }

    this.add(object, rect);
  }

  get(rect: DOMRectReadOnly): T[] {
    const objects: T[] = [];

    for (const key of this.#getKeys(rect)) {
      this.#hash.get(key)?.forEach((object) => objects.push(object));
    }

    return objects;
  }

  delete(object: T): void {
    this.#rects.delete(object);
    this.#hash.forEach((set) => set.delete(object));
  }

  clear(): void {
    this.#rects.clear();
    this.#hash.clear();
  }

  #getKeys(rect: DOMRectReadOnly): Set<string> {
    // How many times the rects should be shifted when hashing
    const shift = 5;
    const sx = rect.x >> shift;
    const sy = rect.y >> shift;
    const ex = (rect.x + rect.width) >> shift;
    const ey = (rect.y + rect.height) >> shift;
    const keys = new Set<string>();

    for (let y = sy; y <= ey; y++) {
      for (let x = sx; x <= ex; x++) {
        keys.add('' + x + ':' + y);
      }
    }
    return keys;
  }
}
