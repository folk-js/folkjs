import { ReactiveElement, css } from '@folkjs/dom/ReactiveElement';

// Ported from https://kizu.dev/fit-to-width/#not-optimal

export class FolkTextFit extends ReactiveElement {
  static override styles = css`
    :host {
      display: block;
    }

    .text-fit {
      display: flex;
      container-type: inline-size;

      --_captured-length: initial;
      --support-sentinel: var(--_captured-length, 9999px);

      & > [aria-hidden] {
        visibility: hidden;
      }

      & > :not([aria-hidden]) {
        flex-grow: 1;
        container-type: inline-size;

        --_captured-length: 100cqi;
        --available-space: var(--_captured-length);

        & > * {
          --support-sentinel: inherit;
          --_captured-length: 100cqi;
          --ratio: tan(atan2(var(--available-space), var(--available-space) - var(--_captured-length)));
          --font-size: clamp(1em, 1em * var(--ratio), var(--max-font-size, infinity * 1px) - var(--support-sentinel));
          inline-size: var(--available-space);

          &:not(.text-fit) {
            display: block;
            font-size: var(--font-size);

            @container (inline-size > 0) {
              white-space: nowrap;
            }
          }

          &.text-fit {
            --_captured-length2: var(--font-size);
            font-variation-settings: 'opsz' tan(atan2(var(--_captured-length2), 1px));
          }
        }
      }
    }
  `;

  #slot = document.createElement('slot');
  #hiddenSpan = document.createElement('span');

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot() as ShadowRoot;

    CSS.registerProperty({
      name: '--_captured-length',
      syntax: '<length>',
      inherits: true,
      initialValue: '0px',
    });

    CSS.registerProperty({
      name: '--_captured-length2',
      syntax: '<length>',
      inherits: true,
      initialValue: '0px',
    });

    this.#slot.addEventListener('slotchange', (e) => {
      this.#hiddenSpan.textContent = this.textContent;
    });

    const span1 = document.createElement('span');
    span1.classList.add('text-fit');

    const span2 = document.createElement('span');
    const span3 = document.createElement('span');

    span2.appendChild(span3);
    span3.appendChild(this.#slot);

    this.#hiddenSpan.ariaHidden = 'true';

    span1.append(span2, this.#hiddenSpan);

    root.appendChild(span1);

    return root;
  }
}
