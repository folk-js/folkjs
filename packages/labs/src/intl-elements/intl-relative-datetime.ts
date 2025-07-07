import { FolkElement } from '@folkjs/canvas';
import { css, property } from '@folkjs/dom/ReactiveElement';

declare global {
  interface HTMLElementTagNameMap {
    'intl-relative-datetime': IntlDateTime;
  }
}

type RelativeTimeFormatOptions = Intl.RelativeTimeFormatOptions;

type T = { [K in keyof RelativeTimeFormatOptions]: K };

// TODO: support ranges
export class IntlDateTime extends FolkElement {
  static override tagName = 'intl-relative-datetime';

  static override styles = css`
    slot {
      display: none;
    }
  `;

  // `lang` is a global attribute, should we navigate up the DOM tree to find it?
  @property({ reflect: true }) locale: Intl.UnicodeBCP47LocaleIdentifier | undefined;

  @property({ reflect: true }) numberingSystem: string | undefined;

  // Locale options
  @property({ reflect: true }) localeMatcher: RelativeTimeFormatOptions['localeMatcher'];

  @property({ reflect: true }) numeric: RelativeTimeFormatOptions['numeric'];

  // Name collision with the style property, so rename it to formatStyle
  @property({ reflect: true }) formatStyle: RelativeTimeFormatOptions['style'];

  #format: Intl.RelativeTimeFormat | undefined;
  #value: number = NaN;
  #unit: Intl.RelativeTimeFormatUnit | '' = '';
  #slot = document.createElement('slot');
  #span = document.createElement('span');

  get value() {
    return this.#value;
  }

  set value(value) {
    this.#value = value;
    this.#updateValue();
  }

  get unit() {
    return this.#unit;
  }

  set unit(value) {
    this.#unit = value;
    this.#updateValue();
  }

  get formattedValue() {
    return this.#span.textContent;
  }

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#span.part.add('value');

    this.#slot.addEventListener('slotchange', this.#onSlotChange);

    root.append(this.#slot, this.#span);

    return root;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    window.addEventListener('languagechange', this.#onLanguageChange);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    window.removeEventListener('languagechange', this.#onLanguageChange);
  }

  #onSlotChange = () => {
    const [value, unit] = (this.textContent?.trim() || '').split(' ');
    this.value = Number(value);
    this.#unit = (unit as Intl.RelativeTimeFormatUnit) || '';
  };

  #onLanguageChange = () => this.requestUpdate();

  override willUpdate(): void {
    // Any change to properties requires re-creating the formatter.

    // Default locale to navigator.language since it's the browsers language setting
    // Passing undefined seems to reflect the OS's language setting.
    this.#format = new Intl.RelativeTimeFormat(this.locale ? this.locale.split(',') : navigator.language, {
      localeMatcher: this.localeMatcher,
      style: this.formatStyle,
      numeric: this.numeric,
    });

    this.#updateValue();
  }

  #updateValue() {
    // check if date is valid
    if (Number.isNaN(this.#value) || this.#unit === '') {
      this.#span.textContent = '';
    } else if (this.#format) {
      this.#span.textContent = this.#format.format(this.#value, this.#unit);
    }
  }
}
