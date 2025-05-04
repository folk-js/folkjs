import { CustomAttribute, customAttributes } from '@folkjs/canvas';

Object.defineProperty(Element.prototype, 'lsp', {
  get() {
    return customAttributes.get(this, FolkLSPAttribute.attributeName) as FolkLSPAttribute | undefined;
  },
});

export class FolkLSPAttribute extends CustomAttribute {
  static override attributeName = 'folk-lsp';

  #language: string | null = null;

  constructor(ownerElement: Element, name: string, value: string) {
    super(ownerElement, name, value);
    this.#language = value;
  }

  override connectedCallback(): void {
    const el = this.ownerElement as HTMLElement;
  }

  override changedCallback(_oldLanguage: string, _newLanguage: string): void {}

  override disconnectedCallback(): void {
    const el = this.ownerElement as HTMLElement;
  }
}
