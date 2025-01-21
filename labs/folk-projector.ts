import { DOMRectTransform } from '@lib';
import { FolkShape } from './folk-shape';

declare global {
  interface HTMLElementTagNameMap {
    'folk-projector': FolkProjector;
  }
}

export class FolkProjector extends HTMLElement {
  static tagName = 'folk-projector';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  #isProjecting = false;
  #mappedElements = new Map<FolkShape, HTMLElement>();
  #isTransitioning = false;

  constructor() {
    super();
    const style = document.createElement('style');
    style.textContent = `
      :host {
        display: block;
        position: relative;
      }
      /* Add styles for mapped elements and their children */
      div {
        opacity: 1;
        box-sizing: border-box;
        display: flex;
        flex-wrap: wrap;
        position: absolute;
        border-radius: 4px;
        overflow: hidden;
      }
      div input:first-of-type {
        border-right: 2px solid lightgray;
      }
      div input {
        background-color: #36454f;
        color: white;
        width: 50%;
        min-width: 0;
        font-size: 12px;
        box-sizing: border-box;
        border: none;
        text-align: center;
      }
    `;
    this.appendChild(style);
  }

  // TODO: avoid this kind of hack
  #maintainProjectedPositions() {
    if (!this.#isProjecting) return;

    const shapes = Array.from(this.children).filter((el): el is FolkShape => el instanceof FolkShape);
    const mappedElements = shapes
      .map((shape) => this.#mappedElements.get(shape))
      .filter((el): el is HTMLElement => el !== null);

    shapes.forEach((shape, i) => {
      const mappedEl = mappedElements[i];
      // Restore the projected position before paint
      shape.style.transform = mappedEl.style.transform;
      shape.style.width = mappedEl.style.width;
      shape.style.height = mappedEl.style.height;
    });

    requestAnimationFrame(() => this.#maintainProjectedPositions());
  }

  mapping(shape: FolkShape, mappingFn: (element: FolkShape) => HTMLElement) {
    const mappedEl = mappingFn(shape);
    const rect = shape.getTransformDOMRect();

    mappedEl.style.position = 'absolute';
    mappedEl.style.width = rect.width + 'px';
    mappedEl.style.height = rect.height + 'px';
    mappedEl.style.transform = shape.style.transform;
    mappedEl.style.transformOrigin = '0 0';
    mappedEl.style.opacity = '0';
    mappedEl.style.pointerEvents = 'none';

    this.appendChild(mappedEl);
    this.#mappedElements.set(shape, mappedEl);
  }

  async project(spacing = 20) {
    if (this.#isTransitioning) return;

    this.#isTransitioning = true;

    const shapes = Array.from(this.children).filter((el): el is FolkShape => el instanceof FolkShape);

    const mappedElements = shapes
      .map((shape) => this.#mappedElements.get(shape))
      .filter((el): el is HTMLElement => el !== null);

    const CELL_WIDTH = 100;
    const CELL_HEIGHT = 50;
    const X_OFFSET = 20;

    let yOffset = 0;

    const positions = shapes.map((shape) => {
      if (this.#isProjecting) {
        return shape.getTransformDOMRect();
      } else {
        const newRect = new DOMRectTransform({
          x: X_OFFSET,
          y: yOffset,
          width: CELL_WIDTH,
          height: CELL_HEIGHT,
          rotation: 0,
        });

        yOffset += CELL_HEIGHT + spacing;
        return newRect;
      }
    });

    if (!document.startViewTransition) {
      shapes.forEach((shape, i) => {
        const newTransform = positions[i].toCssString();
        const newRect = positions[i];
        if (this.#isProjecting) {
          shape.style.translate = '0 0';
          shape.style.rotate = '0deg';
        } else {
          shape.style.translate = '';
          shape.style.rotate = '';
        }
        shape.style.transform = newTransform;
        shape.style.width = `${newRect.width}px`;
        shape.style.height = `${newRect.height}px`;
        const mappedEl = mappedElements[i];
        if (mappedEl) {
          mappedEl.style.transform = newTransform;
          mappedEl.style.width = `${newRect.width}px`;
          mappedEl.style.height = `${newRect.height}px`;
          mappedEl.style.opacity = this.#isProjecting ? '1' : '0';
        }
      });
    } else {
      shapes.forEach((shape, i) => {
        shape.style.viewTransitionName = `shape-${i}`;
        mappedElements[i].style.viewTransitionName = `mapped-${i}`;
      });

      await new Promise(requestAnimationFrame);

      const transition = document.startViewTransition(() => {
        shapes.forEach((shape, i) => {
          const newTransform = positions[i].toCssString();
          const newRect = positions[i];
          shape.style.transform = newTransform;
          shape.style.width = `${newRect.width}px`;
          shape.style.height = `${newRect.height}px`;
          console.log(this.#isProjecting);
          if (this.#isProjecting) {
            shape.style.translate = '0 0';
            shape.style.rotate = '0deg';
            shape.blur();
            shape.style.zIndex = '0';
          } else {
            shape.style.translate = '';
            shape.style.rotate = '';
          }
          const mappedEl = mappedElements[i];
          if (mappedEl) {
            mappedEl.style.transform = newTransform;
            mappedEl.style.width = `${newRect.width}px`;
            mappedEl.style.height = `${newRect.height}px`;
            mappedEl.style.opacity = this.#isProjecting ? '1' : '0';
          }
        });
      });

      transition.finished.finally(() => {
        this.#isTransitioning = false;
        shapes.forEach((shape, i) => {
          shape.style.viewTransitionName = '';
          shape.style.pointerEvents = this.#isProjecting ? 'none' : 'all';
          mappedElements[i].style.viewTransitionName = '';
          mappedElements[i].style.pointerEvents = this.#isProjecting ? 'all' : 'none';
        });
      });
    }
    this.#isProjecting = !this.#isProjecting;

    if (this.#isProjecting) {
      this.#maintainProjectedPositions();
    }
  }
}
