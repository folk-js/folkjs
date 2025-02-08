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
      background: oklch(0.54 0.01 0 / 0.2);
      border: unset;
      cursor: move;
      inset: unset;
      padding: 0;
      position: absolute;
      overflow: visible;
      transform-origin: center center;
      transition: outline-width 75ms ease-out;
      outline: solid 1.5px hsl(214, 84%, 56%);
    }

    :host(:hover) {
      outline-width: 2.25px;
    }

    [part] {
      aspect-ratio: 1;
      position: absolute;
      padding: 0;
    }

    [part^='resize'] {
      background: hsl(210, 20%, 98%);
      width: 10px;
      transform: translate(-50%, -50%);
      border: 1.5px solid hsl(214, 84%, 56%);
      border-radius: 2px;

      @media (any-pointer: coarse) {
        width: 15px;
      }
    }

    [part^='rotation'] {
      opacity: 0;
      width: 15px;

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

  #isOpen = false;

  get isOpen() {
    return this.#isOpen;
  }

  #shape: FolkShapeAttribute | null = null;
  #canReceivePreviousFocus = false;

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

  handleEvent(event: KeyboardEvent | FocusEvent) {
    // TODO: if someone back tabs into the element the overlay should be show second and the focus element first?

    // the overlay was just closed due to a forward tab.
    if (this.#canReceivePreviousFocus) {
      // when someone tabbed away from the overlay, then shift+tabbed back
      if (event instanceof KeyboardEvent && event.type === 'keydown' && event.key === 'Tab' && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.#canReceivePreviousFocus = false;
        document.removeEventListener('keydown', this, { capture: true });
        document.removeEventListener('focusout', this, { capture: true });
        const shape = (event.target as Element).getShape();

        if (shape) {
          this.open(shape);
        }
      }

      // in the case the we lost focus
      if (event instanceof FocusEvent && event.type === 'focusout') {
        this.#canReceivePreviousFocus = false;
        document.removeEventListener('keydown', this, { capture: true });
        document.removeEventListener('focusout', this, { capture: true });
      }

      return;
    }

    // when the overlay is open and someone tabs forward we need to close it and prepare if they tab back
    if (event instanceof KeyboardEvent && event.type === 'keydown' && event.key === 'Tab') {
      if (!event.shiftKey) {
        event.stopPropagation();
        event.stopImmediatePropagation();
        event.preventDefault();
        this.close();
        this.#canReceivePreviousFocus = true;
        // make sure to close the overlay before adding these event listeners otherwise the keydown event will be removed.
        document.addEventListener('keydown', this, { capture: true });
        // FIX: focusout isn't what we want
        document.addEventListener('focusout', this, { capture: true });
      }
      return;
    }

    event.preventDefault();
  }

  open(shape: FolkShapeAttribute) {
    this.#shape = shape;
    this.#update();
    this.showPopover();
    document.addEventListener('keydown', this, { capture: true });
    this.#isOpen = true;
  }

  close() {
    this.#shape = null;
    this.hidePopover();
    document.removeEventListener('keydown', this, { capture: true });
    this.#isOpen = false;
  }

  #update() {
    if (this.#shape === null) return;

    // TODO: use css anchoring in the future when it's supported.
    this.style.top = `${toDOMPrecision(this.#shape.y)}px`;
    this.style.left = `${toDOMPrecision(this.#shape.x)}px`;
    this.style.width = `${toDOMPrecision(this.#shape.width)}px`;
    this.style.height = `${toDOMPrecision(this.#shape.height)}px`;
    this.style.rotate = `${toDOMPrecision(this.#shape.rotation)}rad`;
  }
}

// https://github.com/ai/keyux
// https://github.com/nolanlawson/arrow-key-navigation
