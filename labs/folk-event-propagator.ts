import { css, PropertyValues } from '@lit/reactive-element';
import { property } from '@lit/reactive-element/decorators.js';
import { Propagator } from '@propagators';
import { FolkRope } from './folk-rope.ts';

export class FolkEventPropagator extends FolkRope {
  static override tagName = 'folk-event-propagator';

  static styles = [
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

      [part='trigger'] {
        border-radius: 5px 5px 0 0;
        border-bottom: none;
        width: fit-content;
      }

      [part='expression'] {
        border-radius: 0 5px 5px 5px;
      }
    `,
  ];

  @property({ type: String, reflect: true }) trigger?: string;
  @property({ type: String, reflect: true }) expression?: string;

  #triggerTextarea = document.createElement('textarea');
  #expressionTextarea = document.createElement('textarea');
  #propagator: Propagator | null = null;
  #container = document.createElement('div');
  #hasError = false;

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#container.className = 'input-container';
    this.#triggerTextarea.part.add('trigger');
    this.#expressionTextarea.part.add('expression');

    this.#triggerTextarea.addEventListener('change', () => {
      this.trigger = this.#triggerTextarea.value;
    });

    this.#expressionTextarea.addEventListener('input', () => {
      this.expression = this.#expressionTextarea.value;
    });

    this.#expressionTextarea.addEventListener('focusout', () => {
      if (this.#hasError) {
        super.cut();
      }
    });

    this.#triggerTextarea.value = this.trigger ?? '';
    this.#expressionTextarea.value = this.expression ?? '';

    this.#container.append(this.#triggerTextarea, this.#expressionTextarea);

    root.append(this.#container);

    return root;
  }

  override updated(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('trigger')) {
      this.#triggerTextarea.value = this.trigger ?? '';
    }
    if (changedProperties.has('expression')) {
      this.#expressionTextarea.value = this.expression ?? '';
    }

    if (changedProperties.has('trigger') || changedProperties.has('expression')) {
      this.#initializePropagator();
    }
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#propagator?.dispose();
  }

  #initializePropagator() {
    this.#propagator?.dispose();
    this.#propagator = new Propagator({
      source: this.sourceElement,
      target: this.targetElement,
      event: this.trigger,
      handler: this.expression,
      onParseError: () => {
        this.#hasError = true;
      },
      onParseSuccess: () => {
        if (this.#hasError) {
          super.mend();
        }
        this.#hasError = false;
      },
    });
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
    super.cut(atPercentage);

    this.#propagator?.dispose();
  }

  override mend(): void {
    super.mend();

    this.#initializePropagator();
  }
}
