import { FolkElement, toDOMPrecision } from '@lib';
import { html } from '@lib/tags';
import { css } from '@lit/reactive-element';
import { FolkShapeAttribute } from './folk-shape-attribute';

declare global {
  interface HTMLElementTagNameMap {
    'folk-shape-overlay': FolkShapeOverlay;
  }
}

export class FolkShapeOverlay extends FolkElement {
  static tagName = 'folk-shape-overlay';

  static styles = css`
    :host {
      background: unset;
      border: unset;
      inset: unset;
      padding: 0;
      position: absolute;
      overflow: visible;
      transform-origin: center center;
    }

    [part] {
      aspect-ratio: 1;
      position: absolute;
      padding: 0;
    }

    [part^='resize'] {
      background: hsl(210, 20%, 98%);
      width: 9px;
      transform: translate(-50%, -50%);
      border: 1.5px solid hsl(214, 84%, 56%);
      border-radius: 2px;

      @media (any-pointer: coarse) {
        width: 15px;
      }
    }

    [part^='rotation'] {
      opacity: 0;
      width: 16px;

      @media (any-pointer: coarse) {
        width: 25px;
      }
    }

    [part$='top-left'] {
      top: 0;
      left: 0;
    }

    [part='rotation-top-left'] {
      translate: -100% -100%;
    }

    [part$='top-right'] {
      top: 0;
      left: 100%;
    }

    [part='rotation-top-right'] {
      translate: 0% -100%;
    }

    [part$='bottom-right'] {
      top: 100%;
      left: 100%;
    }

    [part='rotation-bottom-right'] {
      translate: 0% 0%;
    }

    [part$='bottom-left'] {
      top: 100%;
      left: 0;
    }

    [part='rotation-bottom-left'] {
      translate: -100% 0%;
    }
  `;

  #shapes = new Set<FolkShapeAttribute>();

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot() as ShadowRoot;

    this.popover = 'manual';

    (root as ShadowRoot).setHTMLUnsafe(
      html`<button part="rotation-top-left" tabindex="-1" aria-label="Rotate shape from top left"></button>
        <button part="rotation-top-right" tabindex="-1" aria-label="Rotate shape from top right"></button>
        <button part="rotation-bottom-right" tabindex="-1" aria-label="Rotate shape from bottom right"></button>
        <button part="rotation-bottom-left" tabindex="-1" aria-label="Rotate shape from bottom left"></button>
        <button part="resize-top-left" tabindex="-1" aria-label="Resize shape from top left"></button>
        <button part="resize-top-right" tabindex="-1" aria-label="Resize shape from top right"></button>
        <button part="resize-bottom-right" tabindex="-1" aria-label="Resize shape from bottom right"></button>
        <button part="resize-bottom-left" tabindex="-1" aria-label="Resize shape from bottom left"></button>`,
    );

    return root;
  }

  addShape(shape: FolkShapeAttribute) {
    this.#shapes.add(shape);
  }

  removeShape(shape: FolkShapeAttribute) {
    this.#shapes.delete(shape);
  }

  open() {
    console.log('open overlay');
    this.#update();
    this.showPopover();
  }

  close() {
    this.#shapes.clear();
    this.hidePopover();
  }

  #update() {
    let x, y, width, height, rotation;
    if (this.#shapes.size === 1) {
      const shape = this.#shapes.keys().next().value!;

      x = shape.x;
      y = shape.y;
      width = shape.width;
      height = shape.height;
      rotation = shape.rotation;
    } else {
      const shapes = Array.from(this.#shapes);

      x = Math.min.apply(
        null,
        shapes.map((rect) => rect.left),
      );
      y = Math.min.apply(
        null,
        shapes.map((rect) => rect.top),
      );
      const right = Math.max.apply(
        null,
        shapes.map((rect) => rect.right),
      );
      const bottom = Math.max.apply(
        null,
        shapes.map((rect) => rect.bottom),
      );

      width = right - x;
      height = bottom - y;
      rotation = 0;
    }

    this.style.top = `${toDOMPrecision(y)}px`;
    this.style.left = `${toDOMPrecision(x)}px`;
    this.style.width = `${toDOMPrecision(width)}px`;
    this.style.height = `${toDOMPrecision(height)}px`;
    this.style.rotate = `${toDOMPrecision(rotation)}rad`;
  }
}
