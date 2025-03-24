import { FolkElement } from '@folkjs/lib';
import { css } from '@folkjs/lib/reactive-element';
import { AwaitableInstance, ink } from 'ink-mde';

declare global {
  interface HTMLElementTagNameMap {
    'folk-markdown': FolkMarkdown;
  }
}

export class FolkMarkdown extends FolkElement {
  static override tagName = 'folk-markdown';

  static override styles = css`
    :host > div {
      /* need to specific this for ink-mde */
      color: white;
      background-color: black;
      width: 75ch;
    }

    /* hide the footer */
    .ink-mde-details {
      display: none !important;
    }
  `;

  #div = document.createElement('div');
  #editor: AwaitableInstance | undefined;

  #initialValue = '';
  get value() {
    return this.#editor?.getDoc() || this.#initialValue;
  }
  set value(value) {
    if (this.#editor) {
      this.#editor.load(value);
    } else {
      this.#initialValue = value;
    }
  }

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.appendChild(this.#div);

    this.#editor = ink(this.#div, { doc: this.#initialValue });

    return root;
  }
}

FolkMarkdown.define();
