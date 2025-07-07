import { FolkElement } from '@folkjs/canvas';
import { css, property } from '@folkjs/dom/ReactiveElement';

declare global {
  interface HTMLElementTagNameMap {
    'intl-datetime': IntlDateTime;
  }
}

type DateTimeFormatOptions = Intl.DateTimeFormatOptions;

type T = { [K in keyof DateTimeFormatOptions]: K };

// TODO: support ranges
export class IntlDateTime extends FolkElement {
  static override tagName = 'intl-datetime';

  static override styles = css`
    slot {
      display: none;
    }
  `;

  // `lang` is a global attribute, should we navigate up the DOM tree to find it?
  @property({ reflect: true }) locale: Intl.UnicodeBCP47LocaleIdentifier | undefined;

  // Locale options
  @property({ reflect: true }) localeMatcher: DateTimeFormatOptions['localeMatcher'];

  @property({ reflect: true }) numberingSystem: DateTimeFormatOptions['numberingSystem'];

  @property({ reflect: true, type: String }) weekday: DateTimeFormatOptions['weekday'];
  @property({ reflect: true, type: String }) era: DateTimeFormatOptions['era'];
  @property({ reflect: true, type: String }) year: DateTimeFormatOptions['year'];
  @property({ reflect: true, type: String }) month: DateTimeFormatOptions['month'];
  @property({ reflect: true, type: String }) day: DateTimeFormatOptions['day'];
  @property({ reflect: true, type: String }) hour: DateTimeFormatOptions['hour'];
  @property({ reflect: true, type: String }) minute: DateTimeFormatOptions['minute'];
  @property({ reflect: true, type: String }) second: DateTimeFormatOptions['second'];
  @property({ reflect: true, type: String }) timeZoneName: DateTimeFormatOptions['timeZoneName'];
  @property({ reflect: true, type: String }) formatMatcher: DateTimeFormatOptions['formatMatcher'];
  @property({ reflect: true, type: String }) hour12: DateTimeFormatOptions['hour12'];
  @property({ reflect: true, type: String }) timeZone: DateTimeFormatOptions['timeZone'];
  @property({ reflect: true, type: String }) dateStyle: DateTimeFormatOptions['dateStyle'];
  @property({ reflect: true, type: String }) timeStyle: DateTimeFormatOptions['timeStyle'];
  @property({ reflect: true, type: String }) dayPeriod: DateTimeFormatOptions['dayPeriod'];
  @property({ reflect: true, type: Number }) fractionalSecondDigits: DateTimeFormatOptions['fractionalSecondDigits'];
  @property({ reflect: true, type: String }) calendar: DateTimeFormatOptions['calendar'];
  @property({ reflect: true, type: String }) hourCycle: DateTimeFormatOptions['hourCycle'];

  #format: Intl.DateTimeFormat | undefined;
  #value: Date = new Date();
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
    this.value = new Date(this.textContent?.trim() || '');
  };

  #onLanguageChange = () => this.requestUpdate();

  override willUpdate(): void {
    // Any change to properties requires re-creating the formatter.

    // Default locale to navigator.language since it's the browsers language setting
    // Passing undefined seems to reflect the OS's language setting.
    this.#format = new Intl.DateTimeFormat(this.locale ? this.locale.split(',') : navigator.language, {
      localeMatcher: this.localeMatcher,
      numberingSystem: this.numberingSystem,
      weekday: this.weekday,
      era: this.era,
      year: this.year,
      month: this.month,
      day: this.day,
      hour: this.hour,
      minute: this.minute,
      second: this.second,
      timeZoneName: this.timeZoneName,
      formatMatcher: this.formatMatcher,
      hour12: this.hour12,
      timeZone: this.timeZone,
      dateStyle: this.dateStyle,
      timeStyle: this.timeStyle,
      dayPeriod: this.dayPeriod,
      fractionalSecondDigits: this.fractionalSecondDigits,
      calendar: this.calendar,
      hourCycle: this.hourCycle,
    });

    this.#updateValue();
  }

  #updateValue() {
    // check if date is valid
    if (Number.isNaN(this.#value.valueOf())) {
      this.#span.textContent = '';
    } else if (this.#format) {
      this.#span.textContent = this.#format.format(this.#value);
    }
  }
}
