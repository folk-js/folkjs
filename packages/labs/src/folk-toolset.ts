import { Vector } from '@folkjs/lib';
import { FolkEventPropagator } from './folk-event-propagator';
import { FolkShape } from './folk-shape';

export class FolkInteractionHandler extends HTMLElement {
  static tagName = '';

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }

  readonly events: string[] = [];

  handleEvent(event: Event): void {}

  static toolbar: FolkToolset | null = null;

  protected button: HTMLButtonElement;

  constructor() {
    super();
    this.attachShadow({ mode: 'open' });

    const style = document.createElement('style');
    style.textContent = `
      button {
        padding: 8px 16px;
        border: 2px solid transparent;
        cursor: pointer;
      }
      :host(.active) button {
        background-color: #00aaff;
        outline: none;
      }
    `;

    this.button = document.createElement('button');
    this.shadowRoot!.appendChild(style);
    this.shadowRoot!.appendChild(this.button);
    this.button.addEventListener('click', () => this.activate());
  }

  activate() {
    FolkToolset.setActiveTool(this);
  }
}

export class FolkPropagatorTool extends FolkInteractionHandler {
  static override tagName = 'folk-propagator-tool';

  override readonly events = ['pointerdown', 'pointermove', 'pointerup'];

  #currentPropagator: FolkEventPropagator | null = null;
  #startPoint: { x: number; y: number } | null = null;

  constructor() {
    super();
    this.button.textContent = 'Create Propagator';
  }

  override handleEvent(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    const target = event.target as HTMLElement;

    switch (event.type) {
      case 'pointerdown':
        if (!target || target instanceof FolkEventPropagator || target instanceof FolkInteractionHandler) return;
        event.stopImmediatePropagation();
        event.preventDefault();

        this.#startPoint = { x: event.clientX, y: event.clientY };

        if (!target.id) {
          target.id = `folk-source-${Date.now()}`;
        }

        this.#currentPropagator = new FolkEventPropagator();
        this.#currentPropagator.source = `#${target.id}`;

        document.body.appendChild(this.#currentPropagator);
        break;

      case 'pointermove':
        if (!this.#currentPropagator) return;
        event.stopImmediatePropagation();

        // Update the target position to follow the mouse
        const rect = document.body.getBoundingClientRect();
        const targetPoint = `${event.clientX - rect.left}, ${event.clientY - rect.top}`;
        this.#currentPropagator.target = targetPoint;
        this.#currentPropagator.stretch();
        break;

      case 'pointerup':
        if (!this.#currentPropagator) return;
        event.stopImmediatePropagation();

        const finalTarget = document.elementFromPoint(event.clientX, event.clientY) as HTMLElement;

        const distance = Vector.distance(this.#startPoint || { x: 0, y: 0 }, { x: event.clientX, y: event.clientY });

        if (
          !finalTarget ||
          finalTarget instanceof FolkEventPropagator ||
          finalTarget instanceof FolkInteractionHandler ||
          distance <= 1
        ) {
          this.#currentPropagator.remove();
        } else {
          if (!finalTarget.id) {
            finalTarget.id = `folk-target-${Date.now()}`;
          }

          this.#currentPropagator.target = `#${finalTarget.id}`;
        }

        this.#currentPropagator.trigger = 'transform';
        this.#currentPropagator.expression = 'x: from.y';
        this.#currentPropagator = null;
        break;
    }
  }
}

export class FolkShapeTool extends FolkInteractionHandler {
  static override tagName = 'folk-shape-tool';
  override readonly events = ['pointerdown', 'pointermove', 'pointerup'];

  #currentShape: FolkShape | null = null;
  #startPoint: { x: number; y: number } | null = null;

  constructor() {
    super();

    this.button.textContent = 'Create Shape';
  }

  override handleEvent(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    const target = event.target as HTMLElement;

    switch (event.type) {
      case 'pointerdown':
        if (!target || target instanceof FolkShape || target instanceof FolkInteractionHandler) return;
        event.stopImmediatePropagation();

        const rect = target.getBoundingClientRect();
        this.#startPoint = {
          x: event.clientX - rect.left,
          y: event.clientY - rect.top,
        };

        this.#currentShape = new FolkShape();
        this.#currentShape.x = this.#startPoint.x;
        this.#currentShape.y = this.#startPoint.y;
        this.#currentShape.width = 0;
        this.#currentShape.height = 0;

        target.appendChild(this.#currentShape);
        target.setPointerCapture(event.pointerId);
        break;

      case 'pointermove':
        if (!this.#currentShape || !this.#startPoint) return;
        event.stopImmediatePropagation();

        const rect2 = target.getBoundingClientRect();
        const currentX = event.clientX - rect2.left;
        const currentY = event.clientY - rect2.top;

        // Calculate width and height based on drag direction
        const width = currentX - this.#startPoint.x;
        const height = currentY - this.#startPoint.y;

        // Update shape position and size based on drag direction
        if (width < 0) {
          this.#currentShape.x = currentX;
          this.#currentShape.width = Math.abs(width);
        } else {
          this.#currentShape.width = width;
        }

        if (height < 0) {
          this.#currentShape.y = currentY;
          this.#currentShape.height = Math.abs(height);
        } else {
          this.#currentShape.height = height;
        }
        break;

      case 'pointerup':
        if (!this.#currentShape) return;
        event.stopImmediatePropagation();

        // If the shape is too small (meaning almost no drag occurred)
        // create a default sized shape instead
        if (this.#currentShape.width <= 1 || this.#currentShape.height <= 1) {
          const defaultSize = 100;
          this.#currentShape.width = defaultSize;
          this.#currentShape.height = defaultSize;
          // Center the shape on the click point
          this.#currentShape.x = this.#startPoint!.x - defaultSize / 2;
          this.#currentShape.y = this.#startPoint!.y - defaultSize / 2;
        }

        this.#currentShape.focus();
        target.releasePointerCapture(event.pointerId);
        this.#currentShape = null;
        this.#startPoint = null;
        break;
    }
  }
}

export class FolkDeleteTool extends FolkInteractionHandler {
  static override tagName = 'folk-delete-tool';
  override readonly events = ['pointerdown'];

  constructor() {
    super();
    this.button.textContent = 'Delete';
  }

  override handleEvent(event: Event): void {
    if (!(event instanceof PointerEvent)) return;
    const target = event.target as HTMLElement;
    if (!target || !(target instanceof FolkShape)) return;
    event.stopImmediatePropagation();
    target.remove();
  }
}

export class FolkToolset extends HTMLElement {
  static tagName = 'folk-toolset';

  static #instance: FolkToolset | null = null;

  #currentHandler: ((event: Event) => void) | null = null;
  #activeTool: FolkInteractionHandler | null = null;

  static setActiveTool(tool: FolkInteractionHandler) {
    if (this.#instance) {
      this.#instance.#activateTool(tool);
    }
  }

  constructor() {
    super();

    FolkToolset.#instance = this;
  }

  #activateTool(tool: FolkInteractionHandler) {
    // Remove active class from previous tool
    if (this.#activeTool) {
      this.#activeTool.classList.remove('active');
    }

    // Deactivate current handler
    if (this.#currentHandler) {
      tool.events.forEach((event) => {
        this.removeEventListener(event, this.#currentHandler!, true);
      });
    }

    // If clicking same tool, just deactivate
    if (this.#activeTool === tool) {
      this.#currentHandler = null;
      this.#activeTool = null;
      return;
    }

    // Activate new handler
    this.#currentHandler = tool.handleEvent.bind(tool);
    tool.events.forEach((event) => {
      this.addEventListener(event, this.#currentHandler!, true);
    });

    // Add active class to new tool
    tool.classList.add('active');
    this.#activeTool = tool;
  }

  static define() {
    if (customElements.get(this.tagName)) return;
    customElements.define(this.tagName, this);
  }
}
