/**
 * A spatial hash. For an explanation, see
 * https://www.gamedev.net/tutorials/programming/general-and-gameplay-programming/spatial-hashing-r2697/
 *
 * For computational efficiency, the positions are bit-shifted n times. This means that they are divided by a factor of power of two.
 *
 * Ported from https://zufallsgenerator.github.io/assets/code/2014-01-26/spatialhash/spatialhash.js
 */

export class SpatialHash<T> {
  #hash = new Map<string, Set<T>>();

  add(object: T, rect: DOMRectReadOnly): void {
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
    this.delete(object);
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
    this.#hash.forEach((set) => set.delete(object));
  }

  clear(): void {
    this.#hash.clear();
  }

  #getKeys(rect: DOMRectReadOnly): string[] {
    // How many times the rects should be shifted when hashing
    const shift = 5;
    const sx = rect.x >> shift;
    const sy = rect.y >> shift;
    const ex = (rect.x + rect.width) >> shift;
    const ey = (rect.y + rect.height) >> shift;
    const keys = [];

    for (let y = sy; y <= ey; y++) {
      for (let x = sx; x <= ex; x++) {
        keys.push('' + x + ':' + y);
      }
    }
    return keys;
  }
}
