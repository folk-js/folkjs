/**
 * BraceLabel - A custom element that displays text with a square under/over brace label
 *
 * Position: bottom (default)         Position: top
 *
 *     some text                          label
 *    └────────┘                       ┌────────┐
 *      label                          some text
 *
 * Usage:
 * <brace-label label="variable name">some code or text</brace-label>
 * <brace-label label="variable name" position="top">some code or text</brace-label>
 */
export class BraceLabel extends HTMLElement {
  // Define observed attributes
  static get observedAttributes() {
    return ['label', 'position'];
  }

  private shadow: ShadowRoot;
  private labelText: HTMLElement | null = null;
  private static stylesheet: CSSStyleSheet;

  constructor() {
    super();

    this.shadow = this.attachShadow({ mode: 'open' });

    if (!BraceLabel.stylesheet) {
      BraceLabel.stylesheet = new CSSStyleSheet();
      BraceLabel.stylesheet.replaceSync(/* css */ `
        :host {
          display: inline-block;
          font-family: monospace;
          position: relative;
        }
        
        :host([position="bottom"]) {
          padding-bottom: 1.2em;
        }
        
        :host([position="top"]) {
          padding-top: 1.2em;
        }
        
        .label-container {
          position: absolute;
          left: 0;
          right: 0;
          text-align: center;
          font-size: 0.85em;
          color: #666;
          line-height: 1;
          display: flex;
          flex-direction: column;
          align-items: center;
        }
        
        :host([position="bottom"]) .label-container {
          bottom: 0;
          flex-direction: column;
        }
        
        :host([position="top"]) .label-container {
          top: 0;
          flex-direction: column-reverse;
        }
        
        .square-brace {
          display: block;
          position: relative;
          height: 0.4em;
          width: calc(100% - 0.5em);
          border-bottom: 1px solid #666;
        }
        
        :host([position="top"]) .square-brace {
          border-bottom: none;
          border-top: 1px solid #666;
        }
        
        .square-brace::before,
        .square-brace::after {
          content: '';
          position: absolute;
          width: 1px;
          height: 0.4em;
          background-color: #666;
        }
        
        :host([position="bottom"]) .square-brace::before,
        :host([position="bottom"]) .square-brace::after {
          bottom: 0;
        }
        
        :host([position="top"]) .square-brace::before,
        :host([position="top"]) .square-brace::after {
          top: 0;
        }
        
        .square-brace::before { left: 0; }
        .square-brace::after { right: 0; }
        
        .label-text {
          display: block;
          text-align: center;
          padding: 1px 0;
          font-size: 0.8em;
          white-space: nowrap;
          position: static;
        }
        
      `);
    }

    this.shadow.adoptedStyleSheets = [BraceLabel.stylesheet];

    this.shadow.innerHTML = `
      <slot></slot>
      <div class="label-container">
        <div class="square-brace"></div>
        <span class="label-text"></span>
      </div>
    `;

    // Cache element references
    this.labelText = this.shadow.querySelector('.label-text');
  }

  // Called when attributes change
  attributeChangedCallback(name: string, oldValue: string | null, newValue: string | null): void {
    if (oldValue === newValue) return;

    if (name === 'label' && this.labelText) {
      this.labelText.textContent = newValue || '';
    }
  }

  connectedCallback(): void {
    // Set default position if not specified
    if (!this.hasAttribute('position')) {
      this.setAttribute('position', 'bottom');
    }

    // Set initial label text
    if (this.labelText) {
      this.labelText.textContent = this.getAttribute('label') || '';
    }
  }
}

// Register the custom element if it hasn't been registered yet
if (!customElements.get('brace-label')) {
  customElements.define('brace-label', BraceLabel);
}
