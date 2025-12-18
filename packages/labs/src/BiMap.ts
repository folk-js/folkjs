/** Bidirectional map that keeps two maps in sync */
export class BiMap<A, B> {
  #aToB = new Map<A, B>();
  #bToA = new Map<B, A>();

  set(a: A, b: B): void {
    this.#aToB.set(a, b);
    this.#bToA.set(b, a);
  }

  getByA(a: A): B | undefined {
    return this.#aToB.get(a);
  }

  getByB(b: B): A | undefined {
    return this.#bToA.get(b);
  }

  hasA(a: A): boolean {
    return this.#aToB.has(a);
  }

  hasB(b: B): boolean {
    return this.#bToA.has(b);
  }

  deleteByA(a: A): boolean {
    const b = this.#aToB.get(a);
    if (b === undefined) return false;
    this.#aToB.delete(a);
    this.#bToA.delete(b);
    return true;
  }

  deleteByB(b: B): boolean {
    const a = this.#bToA.get(b);
    if (a === undefined) return false;
    this.#bToA.delete(b);
    this.#aToB.delete(a);
    return true;
  }

  clear(): void {
    this.#aToB.clear();
    this.#bToA.clear();
  }
}
