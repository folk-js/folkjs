import { FolkElement } from '@lib';
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
  static tagName = 'intl-number';

  static override styles = css`
    slot {
      display: none;
    }
  `;

  // Locale options
  @property({ reflect: true }) localeMatcher: NumberFormatOptions['localeMatcher'] = 'best fit';

  @property({ reflect: true }) numberingSystem: NumberFormatOptions['numberingSystem'];

  // Digit options
  @property({ reflect: true, type: Number }) minimumIntegerDigits: NumberFormatOptions['minimumIntegerDigits'];

  @property({ reflect: true, type: Number }) minimumFractionDigits: NumberFormatOptions['minimumFractionDigits'];

  @property({ reflect: true, type: Number }) maximumFractionDigits: NumberFormatOptions['maximumFractionDigits'];

  @property({ reflect: true, type: Number }) minimumSignificantDigits: NumberFormatOptions['minimumSignificantDigits'];

  @property({ reflect: true, type: Number }) maximumSignificantDigits: NumberFormatOptions['maximumSignificantDigits'];

  @property({ reflect: true }) roundingPriority: NumberFormatOptions['roundingPriority'] = 'auto';

  @property({ reflect: true, type: Number }) roundingIncrement: NumberFormatOptions['roundingIncrement'];

  @property({ reflect: true }) roundingMode: NumberFormatOptions['roundingMode'] = 'halfExpand';

  @property({ reflect: true }) trailingZeroDisplay: NumberFormatOptions['trailingZeroDisplay'];

  // Style options
  // There is a name collision with the style property, so call it display instead.
  @property({ reflect: true }) display: NumberFormatOptions['style'];

  @property({ reflect: true }) currency: NumberFormatOptions['currency'];

  @property({ reflect: true }) currencyDisplay: NumberFormatOptions['currencyDisplay'] = 'symbol';

  @property({ reflect: true }) currencySign: NumberFormatOptions['currencySign'] = 'standard';

  @property({ reflect: true }) unit: string | undefined;

  @property({ reflect: true }) unitDisplay: 'short' | 'long' = 'short';

  // Other options
  @property({ reflect: true }) notation: NumberFormatOptions['notation'] = 'standard';

  @property({ reflect: true }) compactDisplay: NumberFormatOptions['compactDisplay'] = 'short';

  @property({ reflect: true }) useGrouping: NumberFormatOptions['useGrouping'] = undefined;

  @property({ reflect: true }) signDisplay: NumberFormatOptions['signDisplay'] = 'auto';

  #format!: Intl.NumberFormat;
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

  protected override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#span.part.add('number');

    this.#slot.addEventListener('slotchange', () => {
      this.value = parseFloat(this.textContent?.trim() || '');
    });

    root.append(this.#slot, this.#span);

    return root;
  }

  override willUpdate(): void {
    // Any change to properties requires re-creating the formatter.
    this.#format = new Intl.NumberFormat(undefined, {
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

  #updateValue() {
    if ((this.#value = NaN)) {
      this.#span.textContent = '';
    } else {
      this.#span.textContent = this.#format.format(this.#value);
    }
  }
}
