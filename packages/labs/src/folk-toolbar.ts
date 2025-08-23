import { css, property, ReactiveElement, state, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { brushInkShape } from './interactions/brush';
import { clickToCreateArrow, clickToCreateEventPropagator } from './interactions/connection';
import { dragToCreateShape } from './interactions/create-element';
import { deleteElementByClick } from './interactions/delete';

export type Interaction = (container: HTMLElement, cancellationSignal: AbortSignal) => Promise<void>;

const delay = (ms = 0) => new Promise((r) => setTimeout(r, ms));

export class FolkInstrument extends ReactiveElement {
  static override tagName = 'folk-instrument';

  static #interactionMap = new Map<string, Interaction>([
    ['select', async () => {}],
    [
      'erase',
      async (container, cancellationSignal) => {
        await deleteElementByClick(container, cancellationSignal);
      },
    ],
    [
      'rectangle',
      async (container, cancellationSignal) => {
        await dragToCreateShape(container, cancellationSignal, () => document.createElement('div'));
      },
    ],
    [
      'draw',
      async (container, cancellationSignal) => {
        await brushInkShape(container, cancellationSignal);
      },
    ],
    [
      'text',
      async (container, cancellationSignal) => {
        const el = await dragToCreateShape(container, cancellationSignal, () => {
          const div = document.createElement('div');
          div.contentEditable = 'true';
          return div;
        });

        if (el) {
          await delay();
          el.focus();
        }
      },
    ],
    [
      'arrow',
      async (container, cancellationSignal) => {
        await clickToCreateArrow(container, cancellationSignal);
      },
    ],
    [
      'event-propagator',
      async (container, cancellationSignal) => {
        await clickToCreateEventPropagator(container, cancellationSignal);
      },
    ],
  ]);

  static setInteraction(type: string, interaction: Interaction) {
    this.#interactionMap.set(type, interaction);
  }

  static getInteraction(type: string): Interaction | undefined {
    return this.#interactionMap.get(type);
  }

  @property({ type: String }) type = '';

  #interaction: Interaction | undefined = undefined;

  get interaction() {
    return this.#interaction;
  }

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    root.appendChild(document.createElement('slot'));

    return root;
  }

  protected override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has('type'))
      this.#interaction = (this.constructor as typeof FolkInstrument).getInteraction(this.type);
  }
}

export class FolkToolbar extends ReactiveElement {
  static override tagName = 'folk-toolbar';

  static override shadowRootOptions: ShadowRootInit = {
    ...ReactiveElement.shadowRootOptions,
    slotAssignment: 'manual',
  };

  static override styles = css`
    :host {
      display: block;
    }

    fieldset {
      display: flex;
      position: relative;
      flex-wrap: nowrap;
      border: 1px;
      padding: 0;
      margin: 0;
      border-radius: 11px;
      background-color: white;
      box-shadow:
        0px 0px 2px hsl(0, 0%, 0%, 16%),
        0px 2px 3px hsl(0, 0%, 0%, 24%),
        0px 2px 6px hsl(0, 0%, 0%, 0.1),
        inset 0px 0px 0px 1px hsl(0, 0%, 100%);
      z-index: 0;

      label {
        white-space: nowrap;
        position: relative;
        padding: 1rem;

        &:hover {
          cursor: pointer;
        }

        &:has(input[type='radio']:checked) {
          color: white;
        }
      }

      input[type='radio'] {
        /* Add if not using autoprefixer */
        -webkit-appearance: none;
        appearance: none;
        /* For iOS < 15 to remove gradient background */
        background-color: transparent;
        /* Not removed via appearance */
        margin: 0;

        position: absolute;
        inset: 5px;
        z-index: 3;
        border-radius: 8px;

        &:hover {
          background-color: var(--folk-instrument-bg, hsl(0, 0%, 0%, 4.3%));
          cursor: pointer;
        }

        &:checked {
          z-index: 1;
          background-color: var(--folk-instrument-bg, hsl(214, 84%, 56%));
        }
      }
    }

    ::slotted(*) {
      position: relative;
      z-index: 2;
    }
  `;

  @property({ type: String, reflect: true }) activeInstrument = 'select';

  @property({ type: Boolean, reflect: true }) locked = false;

  @property({ type: String, reflect: true }) container = '';

  @state() containerEl: HTMLElement | null = null;

  #fieldset = document.createElement('fieldset');

  #cancelInstrument: AbortController | null = null;

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#fieldset.part.add('fieldset');

    this.#fieldset.addEventListener('input', this.#onInput);

    root.appendChild(this.#fieldset);

    // TODO: use mutation observer to watch changes to slots
    this.querySelectorAll<FolkInstrument>('folk-instrument[type]').forEach((el, i) => {
      const label = document.createElement('label');
      label.part.add('label');

      const slot = document.createElement('slot');
      slot.name = el.getAttribute('type')!;

      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'instrument';
      input.value = el.getAttribute('type')!;
      input.part.add('input');

      if (i === 0) input.checked = true;

      label.append(slot, input);

      this.#fieldset.appendChild(label);

      slot.assign(el);
    });

    return root;
  }
  override connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener('keydown', this.#onKeydown);
  }

  override willUpdate(changedProperties: PropertyValues<this>): void {
    if (changedProperties.has('container')) {
      this.containerEl = document.querySelector(this.container);
    }

    if (changedProperties.has('activeInstrument')) {
      const input = this.renderRoot.querySelector<HTMLInputElement>(
        `input[type="radio"][value="${this.activeInstrument}"]`,
      );

      if (input) {
        input.checked = true;
        input.focus();
        this.#startInstrument(this.activeInstrument);
      }
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener('keydown', this.#onKeydown);
  }

  #onInput = (e: Event) => {
    this.activeInstrument = (e.target as HTMLInputElement).value;
  };

  #onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.activeInstrument !== 'select') {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      this.activeInstrument = 'select';
    }

    4; // TODO: think about how to be more specific here
    if (e.code.startsWith('Digit') && (document.activeElement === document.body || document.activeElement === this)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();

      const instrument = this.renderRoot.querySelector<HTMLInputElement>(
        `label:nth-child(${e.key}) input[type="radio"]`,
      );

      if (instrument) this.activeInstrument = instrument.value;
    }
  };

  async #startInstrument(activeInstrument: string) {
    this.#cancelInstrument?.abort();
    this.#cancelInstrument = null;

    const folkInstrument = this.querySelector(`folk-instrument[type="${activeInstrument}"]`) as FolkInstrument | null;

    if (!folkInstrument?.interaction || this.containerEl === null) return;

    this.#cancelInstrument = new AbortController();

    await folkInstrument.interaction(this.containerEl, this.#cancelInstrument.signal);

    this.#cancelInstrument = null;

    if (this.locked) {
      // request an update for the same instrument
      this.requestUpdate('activeInstrument');
    } else {
      // Change detection should stop infinite loops from happening
      this.activeInstrument = 'select';
    }
  }
}
