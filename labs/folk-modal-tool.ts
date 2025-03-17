import { FolkElement } from '@lib';
import { css, CSSResultGroup } from '@lit/reactive-element';

type PointerEventTypes =
  | 'pointercancel'
  | 'pointerdown'
  | 'pointerenter'
  | 'pointerleave'
  | 'pointermove'
  | 'pointerout'
  | 'pointerover'
  | 'pointerup';

export class FolkModalTool extends FolkElement {
  static tagName = 'folk-modal-tool';

  static shadowRootOptions = { ...FolkElement.shadowRootOptions, delegatesFocus: true };

  static styles = css`
    :host {
      display: block;
      border: solid 1px black;
      padding: 0.125em;
      border-radius: 5px;
    }

    button {
      all: unset;
    }
  `;

  protected createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    const button = document.createElement('button');

    button.appendChild(document.createElement('slot'));

    root.appendChild(button);

    this.addEventListener('focus', this.#onFocus);
    this.addEventListener('blur', this.#onBlur);

    return root;
  }

  #onFocus = () => {
    console.log('focus');
    window.addEventListener('pointerdown', this, { capture: true });
  };

  #onBlur = () => {
    console.log('blur');
    window.removeEventListener('pointerdown', this, { capture: true });
  };

  // Capture all events
  handleEvent(event: PointerEvent) {
    // If the pointer goes down on a tool then ignore it to give the tool an oppurtunity to be focused.
    // TODO: need a better way to check if something is a tool
    if (event.type === 'pointerdown' && event.target instanceof FolkModalTool && event.target !== this) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation();

    if (event.type === 'pointerdown') {
      console.log('pointerdown');
      window.addEventListener('pointermove', this, { capture: true });
      window.addEventListener('lostpointercapture', this, { capture: true });
      this.setPointerCapture(event.pointerId);
    } else if (event.type === 'lostpointercapture') {
      window.removeEventListener('pointermove', this, { capture: true });
      window.removeEventListener('lostpointercapture', this, { capture: true });
    }

    this.onPointerEvent(event);
  }

  onPointerEvent(event: PointerEvent) {
    console.log('proxy', event.type, event.pageX, event.pageY);
  }
}
