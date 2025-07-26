import '@folkjs/labs/standalone/folk-space-attribute';
import '@folkjs/labs/standalone/folk-shape-attribute';
import '@folkjs/labs/standalone/folk-sync-attribute';
import '@folkjs/labs/standalone/folk-arrow';
import '@folkjs/labs/standalone/folk-event-propagator';
import {deleteElementByClick} from '@folkjs/labs/interactions/delete';
import {dragToCreateShape} from '@folkjs/labs/interactions/create-element';
import {clickToCreateArrow, clickToCreateEventPropagator} from '@folkjs/labs/interactions/connection';
import { property, state, ReactiveElement, type PropertyValues, css } from '@folkjs/dom/ReactiveElement';

class FolkInstruments extends ReactiveElement {
  static override tagName = 'folk-instruments';

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
          background-color: hsl(0, 0%, 0%, 4.3%);
          cursor: pointer;
        }

        &:checked {
          z-index: 1;
          background-color: hsl(214, 84%, 56%);
        }
      }
    }

    ::slotted(*) {
      position: relative;
      z-index: 2
    }
  `

  @property({type: String, reflect: true}) container = ''

  @state() containerEl: HTMLElement | null = null;

  #fieldset = document.createElement('fieldset');
  #cancelInstrument: AbortController | null = null;

  get activeInstrument() {
    return this.renderRoot.querySelector<HTMLInputElement>('input:checked')!.value
  }
  
  set activeInstrument(instrument: string) {
    const input = this.renderRoot.querySelector<HTMLInputElement>(`input[type="radio"][value="${instrument}"]`)
  
    if (!input) return;
      
    input.checked = true;
    input.focus();
  
    this.#startInstrument(instrument)
  }

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#fieldset.part.add('fieldset');

    this.#fieldset.addEventListener('input', this.#onInput);

    root.appendChild(this.#fieldset);

    // TODO: use mutation observer to watch changes to slots
    this.querySelectorAll('[slot]').forEach((el, i) => {
      const label = document.createElement('label');
      const slot = document.createElement('slot');
      slot.name = el.slot;
      const input = document.createElement('input');
      input.type = 'radio';
      input.name = 'instrument'
      input.value = el.slot;
      if (i === 0) input.checked = true;
      label.append(slot, input);
      this.#fieldset.appendChild(label);
    });

    return root;
  }
  override connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener('keydown', this.#onKeydown)
  }

  override willUpdate(changedProperties: PropertyValues<FolkInstruments>): void {
    if (changedProperties.has('container')) {
      this.containerEl = document.querySelector(this.container);
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener('keydown', this.#onKeydown)
  }

  #onInput = (e: Event) => {
    const activeInstrument = (e.target as HTMLInputElement).value;

    this.#startInstrument(activeInstrument);
  }

  #onKeydown = (e: KeyboardEvent) => {
    if (e.key === 'Escape' && this.activeInstrument !== 'select') {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      this.activeInstrument = 'select';
    }

4    // TODO: think about how to be more specific here
    if (e.code.startsWith('Digit') && (document.activeElement === document.body || document.activeElement === this)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      e.stopPropagation();
      
      const instrument = this.renderRoot.querySelector<HTMLInputElement>(`label:nth-child(${e.key}) input[type="radio"]`);

      if (instrument) this.activeInstrument = instrument.value;
    }
  }

  async #startInstrument(activeInstrument: string) {
    if (this.containerEl === null) return;

    this.#cancelInstrument?.abort();

    this.#cancelInstrument = new AbortController();

    switch(activeInstrument) {
      // for right now, the select instrument isn't an instrument, it's really just normal browser mode
      case 'select': {
        return;
      }
      case 'pan': {
        break;
      }
      case 'draw': {
        break;
      }
      case 'erase': {
        const el = await deleteElementByClick(this.containerEl, this.#cancelInstrument.signal);

        if (el) this.#startInstrument('erase');
        
        break;
      }
      case 'rectangle': {
        const el = await dragToCreateShape(this.containerEl, this.#cancelInstrument.signal, () => document.createElement('div'));
        
        if (el) this.activeInstrument = 'select';
        break;
      }
      case 'text': {
        const el = await dragToCreateShape(this.containerEl, this.#cancelInstrument.signal, () => {
          const div = document.createElement('div');
          div.contentEditable = 'true';
          return div;
        });
        
        
        if (el) {
          setTimeout(() => el.focus());
          this.activeInstrument = 'select';
        }
        break;
      }
      case 'arrow': {
        const arrow = await clickToCreateArrow(this.containerEl, this.#cancelInstrument.signal);

        if (arrow) this.activeInstrument = 'select';
        break;
      }
      case 'event-propagator': {
        const ep = await clickToCreateEventPropagator(this.containerEl, this.#cancelInstrument.signal);

        if (ep) this.activeInstrument = 'select';
        break;
      }
    }
  }
}

FolkInstruments.define();