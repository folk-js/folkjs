import { css, property, type PropertyValues } from '@folkjs/dom/ReactiveElement';
import { ValuePropagator } from '@folkjs/propagators';
import { FolkRope } from './folk-rope';

export class FolkValuePropagator extends FolkRope {
  static override tagName = 'folk-value-propagator';

  static override styles = [
    ...FolkRope.styles,
    css`
      .input-container {
        position: absolute;
        display: flex;
        flex-direction: column;
        translate: -50% -50%;
      }

      textarea {
        width: auto;
        min-width: 3ch;
        height: auto;
        resize: none;
        background: rgba(256, 256, 256, 0.8);
        border: 1px solid #ccc;
        padding: 4px;
        pointer-events: auto;
        overflow: hidden;
        field-sizing: content;
        box-sizing: content-box;
      }

      [part='expression'] {
        border-radius: 5px;
      }
    `,
  ];

  @property({ reflect: true }) expression?: string;

  #expressionTextarea = document.createElement('textarea');
  #propagator: ValuePropagator | null = null;
  #container = document.createElement('div');
  #hasError = false;

  override createRenderRoot() {
    console.log('🏗️ FolkValuePropagator createRenderRoot');
    const root = super.createRenderRoot();

    this.#container.className = 'input-container';
    this.#expressionTextarea.part.add('expression');

    this.#expressionTextarea.addEventListener('input', () => {
      this.expression = this.#expressionTextarea.value;
    });

    this.#expressionTextarea.addEventListener('focusout', () => {
      if (this.#hasError) {
        super.cut();
      }
    });

    this.#expressionTextarea.value = this.expression ?? '';

    this.#container.append(this.#expressionTextarea);

    root.append(this.#container);

    return root;
  }

  override willUpdate(changedProperties: PropertyValues<this>): void {
    super.willUpdate(changedProperties);
    console.log('🔄 FolkValuePropagator willUpdate', changedProperties);
    console.log('Current sourceElement:', this.sourceElement);
    console.log('Current targetElement:', this.targetElement);
  }

  override updated(changedProperties: PropertyValues<this>): void {
    console.log('🔄 FolkValuePropagator updated', changedProperties);
    console.log('Updated sourceElement:', this.sourceElement);
    console.log('Updated targetElement:', this.targetElement);
    super.update(changedProperties);

    if (
      changedProperties.has('expression') ||
      changedProperties.has('sourceElement') ||
      changedProperties.has('targetElement')
    ) {
      this.#expressionTextarea.value = this.expression ?? '';
      this.#initializePropagator();
    }
  }

  override disconnectedCallback(): void {
    console.log('🔌 FolkValuePropagator disconnected');
    super.disconnectedCallback();
    this.#propagator?.dispose();
  }

  #initializePropagator() {
    console.log('🚀 Initializing propagator');
    console.log('Source element:', this.sourceElement);
    console.log('Target element:', this.targetElement);
    console.log('Expression:', this.expression);

    // Only create propagator if we have all required pieces
    if (!this.sourceElement || !this.targetElement || !this.expression) {
      console.log('⏸️ Not creating propagator - missing pieces:', {
        sourceElement: !!this.sourceElement,
        targetElement: !!this.targetElement,
        expression: !!this.expression,
      });
      return;
    }

    this.#propagator?.dispose();

    const options = {
      source: this.sourceElement,
      target: this.targetElement,
      handler: this.expression,
      onParseError: (error: Error) => {
        console.log('❌ Parse error in FolkValuePropagator:', error);
        this.#hasError = true;
      },
      onParseSuccess: (body: string) => {
        console.log('✅ Parse success in FolkValuePropagator:', body);
        if (this.#hasError) {
          super.mend();
        }
        this.#hasError = false;
      },
    };

    console.log('🔧 Creating ValuePropagator with options:', options);
    this.#propagator = new ValuePropagator(options);
  }

  override render() {
    super.render();

    const point = this.getPointAt(0.5);
    if (point) {
      this.#container.style.left = `${point.pos.x}px`;
      this.#container.style.top = `${point.pos.y}px`;
    }
  }

  override cut(atPercentage?: number): void {
    console.log('✂️ FolkValuePropagator cut');
    super.cut(atPercentage);

    this.#propagator?.dispose();
  }

  override mend(): void {
    console.log('🔧 FolkValuePropagator mend');
    super.mend();

    this.#initializePropagator();
  }
}
