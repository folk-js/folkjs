import { FolkElement } from '@folkjs/lib';
import { css } from '@lit/reactive-element';
import { property } from '@lit/reactive-element/decorators.js';

declare global {
  interface HTMLElementTagNameMap {
    'intl-number': IntlNumber;
  }
}

type NumberFormatOptions = Intl.NumberFormatOptions;

// Ported from https://github.com/elematic/heximal/blob/main/packages/components/src/lib/num.ts
export class IntlNumber extends FolkElement {
  static override tagName = 'intl-number';

  static override styles = css`
    slot {
      display: none;
    }
  `;

  // `lang` is a global attribute, should be navigate up the DOM tree to find it?
  @property({ reflect: true }) locale: string | undefined;

  // Locale options
  @property({ reflect: true }) localeMatcher: NumberFormatOptions['localeMatcher'];

  @property({ reflect: true }) numberingSystem: NumberFormatOptions['numberingSystem'];

  // Digit options
  @property({ reflect: true, type: Number }) minimumIntegerDigits: NumberFormatOptions['minimumIntegerDigits'];

  @property({ reflect: true, type: Number }) minimumFractionDigits: NumberFormatOptions['minimumFractionDigits'];

  @property({ reflect: true, type: Number }) maximumFractionDigits: NumberFormatOptions['maximumFractionDigits'];

  @property({ reflect: true, type: Number }) minimumSignificantDigits: NumberFormatOptions['minimumSignificantDigits'];

  @property({ reflect: true, type: Number }) maximumSignificantDigits: NumberFormatOptions['maximumSignificantDigits'];

  @property({ reflect: true }) roundingPriority: NumberFormatOptions['roundingPriority'];

  @property({ reflect: true, type: Number }) roundingIncrement: NumberFormatOptions['roundingIncrement'];

  @property({ reflect: true }) roundingMode: NumberFormatOptions['roundingMode'];

  @property({ reflect: true }) trailingZeroDisplay: NumberFormatOptions['trailingZeroDisplay'];

  // Style options
  // There is a name collision with the style property, so call it display instead.
  @property({ reflect: true }) display: NumberFormatOptions['style'];

  @property({ reflect: true }) currency: NumberFormatOptions['currency'];

  @property({ reflect: true }) currencyDisplay: NumberFormatOptions['currencyDisplay'];

  @property({ reflect: true }) currencySign: NumberFormatOptions['currencySign'];

  @property({ reflect: true }) unit: NumberFormatOptions['unit'];

  @property({ reflect: true }) unitDisplay: NumberFormatOptions['unitDisplay'];

  // Other options
  @property({ reflect: true }) notation: NumberFormatOptions['notation'];

  @property({ reflect: true }) compactDisplay: NumberFormatOptions['compactDisplay'];

  @property({ reflect: true }) useGrouping: NumberFormatOptions['useGrouping'];

  @property({ reflect: true }) signDisplay: NumberFormatOptions['signDisplay'];

  #format: Intl.NumberFormat | undefined;
  #value: number = NaN;
  #slot = document.createElement('slot');
  #span = document.createElement('span');

  get value() {
    return this.#value;
  }

  set value(value) {
    this.#value = value;
    this.#updateValue();
  }

  get formattedValue() {
    return this.#span.textContent;
  }

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#span.part.add('number');

    this.#slot.addEventListener('slotchange', () => {
      this.value = parseFloat(this.textContent?.trim() || '');
    });

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

  #onLanguageChange = () => this.requestUpdate();

  override willUpdate(): void {
    // Any change to properties requires re-creating the formatter.

    // Default locale to navigator.language since it's the browsers language setting
    // Passing undefined seems to reflect the OS's language setting.
    this.#format = new Intl.NumberFormat(this.locale || navigator.language, {
      localeMatcher: this.localeMatcher,
      numberingSystem: this.numberingSystem,

      minimumIntegerDigits: this.minimumIntegerDigits,
      minimumFractionDigits: this.minimumFractionDigits,
      maximumFractionDigits: this.maximumFractionDigits,
      minimumSignificantDigits: this.minimumSignificantDigits,
      maximumSignificantDigits: this.maximumSignificantDigits,
      roundingPriority: this.roundingPriority,
      roundingIncrement: this.roundingIncrement,
      roundingMode: this.roundingMode,
      trailingZeroDisplay: this.trailingZeroDisplay,

      // If there are is no style attribute, try to infer it.
      style: this.display ?? (this.currency ? 'currency' : this.unit ? 'unit' : 'decimal'),
      currency: this.currency,
      currencyDisplay: this.currencyDisplay,
      currencySign: this.currencySign,
      unit: this.unit,
      unitDisplay: this.unitDisplay,

      notation: this.notation,
      compactDisplay: this.compactDisplay,
      useGrouping: this.useGrouping,
      signDisplay: this.signDisplay,
    });

    this.#updateValue();
  }

  #updateValue = () => {
    if (Number.isNaN(this.#value)) {
      this.#span.textContent = '';
    } else if (this.#format) {
      this.#span.textContent = this.#format.format(this.#value);
    }
  };
}
