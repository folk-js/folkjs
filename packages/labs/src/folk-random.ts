/**
 * A custom element that randomly orders and/or shows a subset of its children.
 * This element processes its children once when connected.
 *
 * @attr {boolean} order - When true (default), randomly orders the children elements
 * @attr {number} subset - Shows up to this number of children as a random subset
 *
 * @example
 * ```html
 * <folk-random order="true" subset="3">
 *   <div>Item 1</div>
 *   <div>Item 2</div>
 *   <div>Item 3</div>
 *   <div>Item 4</div>
 *   <div>Item 5</div>
 * </folk-random>
 * ```
 */
export class FolkRandom extends HTMLElement {
  static tagName = 'folk-random';

  connectedCallback() {
    this.#processChildren();
  }

  #processChildren(): void {
    // Get actual element children, filtering out text nodes (whitespace)
    const children = Array.from(this.children);

    // Get attribute values
    const shouldOrder = this.getAttribute('order') !== 'false';
    const subsetSizeAttr = this.getAttribute('subset');
    const subsetSize = subsetSizeAttr ? parseInt(subsetSizeAttr, 10) : null;

    // Apply subset if needed
    let processedChildren = children;
    if (subsetSize !== null && !isNaN(subsetSize)) {
      processedChildren = this.#getRandomSubset(children, subsetSize);
    }

    // Apply random ordering if needed
    if (shouldOrder && processedChildren.length > 1) {
      this.#shuffleArray(processedChildren);
    }

    // Update the DOM (single time operation)
    this.#updateChildren(processedChildren);
  }

  #getRandomSubset<T>(array: T[], size: number): T[] {
    // Create a copy of the array to avoid modifying the original
    const arrayCopy = [...array];

    // Ensure size is valid
    const effectiveSize = Math.min(size, arrayCopy.length);

    // Shuffle the entire array
    this.#shuffleArray(arrayCopy);

    // Return exactly the number of elements requested (or all if less available)
    return arrayCopy.slice(0, effectiveSize);
  }

  #shuffleArray<T>(array: T[]): void {
    // Fisher-Yates shuffle algorithm
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
  }

  #updateChildren(children: Element[]): void {
    // Clear current children
    while (this.firstChild) {
      this.removeChild(this.firstChild);
    }

    // Add the processed children
    children.forEach((child: Element) => {
      this.appendChild(child.cloneNode(true));
    });
  }
}

// Define the custom element
customElements.define(FolkRandom.tagName, FolkRandom);
