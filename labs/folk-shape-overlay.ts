import { FolkElement } from '@lib';
import { html } from '@lib/tags';
import { css } from '@lit/reactive-element';

declare global {
  interface HTMLElementTagNameMap {
    'folk-shape-overlay': FolkShapeOverlay;
  }
}

export class FolkShapeOverlay extends FolkElement {
  static tagName = 'folk-shape-overlay';

  static styles = css`
    [part] {
      aspect-ratio: 1;
      display: none;
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

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot() as ShadowRoot;

    this.popover = 'auto';

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
}
