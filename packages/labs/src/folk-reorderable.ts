import { canIUseMoveBefore } from '@folkjs/dom/CanIUse';
import { CustomAttribute } from '@folkjs/dom/CustomAttribute';
import { css } from '@folkjs/dom/tags';

// Type declaration for the experimental moveBefore API
declare global {
  interface Element {
    moveBefore?(child: Element, referenceChild: Element | null): void;
  }
}

export class FolkReorderableAttribute extends CustomAttribute<HTMLElement> {
  static override attributeName = 'folk-reorderable';

  static {
    document.adoptedStyleSheets.push(css`
      [folk-reorderable] {
        --drag-x: 0px;
        --drag-y: 0px;
        cursor: grab;
        transition: transform 0.2s ease;
        /* Fallback transform for when no custom CSS is provided */
        transform: translate(var(--drag-x), var(--drag-y));
      }

      [folk-reorderable][aria-grabbed='true'] {
        position: relative;
        z-index: 999999;
        transition: none;
        cursor: grabbing;
      }
    `);
  }

  #container: HTMLElement | null = null;
  #offsetX: number = 0;
  #offsetY: number = 0;
  #abortController: AbortController | null = null;

  #updatePosition(clientX: number, clientY: number) {
    if (!this.ownerElement) return;

    this.ownerElement.style.setProperty('--drag-x', '0px');
    this.ownerElement.style.setProperty('--drag-y', '0px');

    const rect = this.ownerElement.getBoundingClientRect();

    const targetX = clientX - (rect.left + this.#offsetX);
    const targetY = clientY - (rect.top + this.#offsetY);

    this.ownerElement.style.setProperty('--drag-x', `${targetX}px`);
    this.ownerElement.style.setProperty('--drag-y', `${targetY}px`);
  }

  #onPointerDown = (event: PointerEvent) => {
    // Only handle left mouse button or primary touch
    if (event.button !== 0) return;

    if (event.target !== this.ownerElement) {
      return;
    }
    const container = this.ownerElement.parentElement;
    if (!container || container.children.length < 2) return;

    event.preventDefault();

    this.#container = container;

    this.ownerElement.setAttribute('aria-grabbed', 'true');

    // Now calculate offset based on the actual dragging state (not hover state)
    const rect = this.ownerElement.getBoundingClientRect();
    this.#offsetX = event.clientX - rect.left;
    this.#offsetY = event.clientY - rect.top;

    // Use AbortController for clean event management
    this.#abortController = new AbortController();
    const { signal } = this.#abortController;

    document.addEventListener('pointermove', this.#onPointerMove, { signal });
    document.addEventListener('pointerup', this.#onPointerUp, { signal });
  };

  #onPointerMove = (event: PointerEvent) => {
    if (!this.#container) return;

    this.#updatePosition(event.clientX, event.clientY);

    // Use elementFromPoint for hit detection among any siblings
    this.ownerElement.style.pointerEvents = 'none';
    const elementBelow = document.elementFromPoint(event.clientX, event.clientY);
    this.ownerElement.style.pointerEvents = '';

    let targetSibling = elementBelow;
    while (targetSibling && targetSibling.parentElement !== this.#container) {
      targetSibling = targetSibling.parentElement;
    }

    if (targetSibling && targetSibling !== this.ownerElement && targetSibling.parentElement === this.#container) {
      const siblings = Array.from(this.#container.children);
      const currentIndex = siblings.indexOf(this.ownerElement);
      const targetIndex = siblings.indexOf(targetSibling);

      // Determine if we should move before or after based on mouse position
      const siblingRect = targetSibling.getBoundingClientRect();
      const shouldMoveBefore = event.clientY < siblingRect.top + siblingRect.height / 2;

      const insertIndex = shouldMoveBefore ? targetIndex : targetIndex + 1;

      // Only move if it would actually change position
      if (insertIndex !== currentIndex && insertIndex !== currentIndex + 1) {
        this.#moveToIndex(insertIndex, event.clientX, event.clientY);
      }
    }
  };

  #moveToIndex = (targetIndex: number, clientX: number, clientY: number) => {
    if (!this.#container) return;

    const siblings = Array.from(this.#container.children);

    if (targetIndex >= siblings.length) {
      this.#container.moveBefore!(this.ownerElement, null);
    } else {
      this.#container.moveBefore!(this.ownerElement, siblings[targetIndex]);
    }

    // Recalculate position to prevent jumping
    this.#updatePosition(clientX, clientY);
  };

  #onPointerUp = () => {
    if (!this.ownerElement) return;

    // Clean up drag state
    this.ownerElement.removeAttribute('aria-grabbed');
    this.ownerElement.style.removeProperty('--drag-x');
    this.ownerElement.style.removeProperty('--drag-y');

    this.#abortController?.abort();
    this.#abortController = null;
  };

  override connectedCallback(): void {
    if (!canIUseMoveBefore()) return;

    this.ownerElement.addEventListener('pointerdown', this.#onPointerDown);
    this.ownerElement.addEventListener('dragstart', (e) => e.preventDefault());
  }

  override disconnectedCallback(): void {
    this.ownerElement.removeEventListener('pointerdown', this.#onPointerDown);
    this.#onPointerUp(); // Clean up any active drag
  }

  override connectedMoveCallback = () => {
    // When this callback is present, moveBefore() calls fire this and not the connected/disconnected callbacks
  };
}
