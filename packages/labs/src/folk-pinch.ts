import { FolkElement, Matrix, Vector } from '@folkjs/lib';
import PointerTracker, { Pointer } from '@folkjs/lib/pointer-tracker';
import { css, PropertyValues } from '@lit/reactive-element';
import { property } from '@lit/reactive-element/decorators.js';

declare global {
  interface HTMLElementTagNameMap {
    'folk-pinch': FolkPinch;
  }
}

export class FolkPinch extends FolkElement {
  static tagName = 'folk-pinch';

  static styles = css`
    :host {
      display: block;
      overflow: hidden;
      touch-action: none;
    }

    :host([grid]) {
      --circle-width: 1px;
      --circle: circle at var(--circle-width) var(--circle-width);
      /* Map color transparency to --folk-scale for each level of the grid */
      --bg-color-1: rgba(0, 0, 0, 1);
      --bg-color-2: rgba(0, 0, 0, clamp(0, var(--folk-scale), 1));
      --bg-color-3: rgba(0, 0, 0, clamp(0, calc(var(--folk-scale) - 0.1), 1));
      --bg-color-4: rgba(0, 0, 0, clamp(0, calc(var(--folk-scale) - 1), 1));
      --bg-color-5: rgba(0, 0, 0, clamp(0, calc(0.5 * var(--folk-scale) - 2), 1));

      /* Draw points for each level of grid as set of a background image. First background is on top.*/
      background-image:
        radial-gradient(var(--circle), var(--bg-color-1) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-2) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-3) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-4) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-5) var(--circle-width), transparent 0);

      /* Each level of the grid should be a factor of --size. */
      --bg-size: calc(var(--size, 100px) / pow(2, 6) * var(--folk-scale));

      /* Divide each part of grid into 4 sections. */
      --bg-size-1: calc(var(--bg-size) * pow(var(--sections, 4), 5));
      --bg-size-2: calc(var(--bg-size) * pow(var(--sections, 4), 4));
      --bg-size-3: calc(var(--bg-size) * pow(var(--sections, 4), 3));
      --bg-size-4: calc(var(--bg-size) * pow(var(--sections, 4), 2));
      --bg-size-5: calc(var(--bg-size) * var(--sections, 4));

      background-size:
        var(--bg-size-1) var(--bg-size-1),
        var(--bg-size-2) var(--bg-size-2),
        var(--bg-size-3) var(--bg-size-3),
        var(--bg-size-4) var(--bg-size-4),
        var(--bg-size-5) var(--bg-size-5);

      /* Pan each background position to each point in the underlay. */
      background-position: var(--folk-x) var(--folk-y);
    }

    div {
      position: absolute;
      inset: 0;
      scale: var(--folk-scale);
      translate: var(--folk-x) var(--folk-y);
      transform-origin: 0 0;
    }
  `;

  @property({ type: Number, reflect: true }) x: number = 0;

  @property({ type: Number, reflect: true }) y: number = 0;

  @property({ type: Number, reflect: true }) scale: number = 1;

  @property({ type: Number, reflect: true }) minScale: number = 0.05;

  @property({ type: Number, reflect: true }) maxScale: number = 8;

  #container = document.createElement('div');

  // clean up?
  #pointerTracker = new PointerTracker(this, {
    start: (_, event) => {
      // We only want to track 2 pointers at most
      if (this.#pointerTracker.currentPointers.length === 2) return false;

      // is this needed, when it happens it prevents the blur of other elements
      // event.preventDefault();
      return true;
    },
    move: (previousPointers) => {
      this.#onPointerMove(previousPointers, this.#pointerTracker.currentPointers);
    },
  });

  override createRenderRoot(): HTMLElement | DocumentFragment {
    const root = super.createRenderRoot();

    this.#container.appendChild(document.createElement('slot'));

    root.append(this.#container);

    this.addEventListener('wheel', this.#onWheel);

    return root;
  }

  override willUpdate(): void {
    if (this.scale < this.minScale) {
      this.scale = this.minScale;
    } else if (this.scale > this.maxScale) {
      this.scale = this.maxScale;
    }
  }

  override update(changedProperties: PropertyValues<this>): void {
    super.update(changedProperties);

    if (changedProperties.has('x')) {
      this.style.setProperty('--folk-x', `${this.x}px`);
    }

    if (changedProperties.has('y')) {
      this.style.setProperty('--folk-y', `${this.y}px`);
    }

    if (changedProperties.has('scale')) {
      this.style.setProperty('--folk-scale', this.scale.toString());
    }

    // emit transform event
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.#pointerTracker.stop();
  }

  #onWheel = (event: WheelEvent) => {
    event.preventDefault();

    const currentRect = this.#container.getBoundingClientRect();

    let { deltaY } = event;

    const { ctrlKey, deltaMode } = event;

    if (deltaMode === 1) {
      // 1 is "lines", 0 is "pixels"
      // Firefox uses "lines" for some types of mouse
      deltaY *= 15;
    }

    // ctrlKey is true when pinch-zooming on a trackpad.
    const divisor = ctrlKey ? 100 : 300;
    const scaleDiff = 1 - deltaY / divisor;

    this.#applyChange(0, 0, scaleDiff, event.clientX - currentRect.left, event.clientY - currentRect.top);
  };

  #onPointerMove = (previousPointers: Pointer[], currentPointers: Pointer[]) => {
    // Combine next points with previous points
    const currentRect = this.#container.getBoundingClientRect();

    const previousPoints = previousPointers.slice(0, 2).map((pointer) => ({ x: pointer.clientX, y: pointer.clientY }));

    const currentPoints = currentPointers.slice(0, 2).map((pointer) => ({ x: pointer.clientX, y: pointer.clientY }));

    // For calculating panning movement
    const prevMidpoint = Vector.center(previousPoints);
    const newMidpoint = Vector.center(currentPoints);

    // Midpoint within the element
    const originX = prevMidpoint.x - currentRect.left;
    const originY = prevMidpoint.y - currentRect.top;

    // Calculate the desired change in scale
    const prevDistance = previousPoints.length === 1 ? 0 : Vector.distance(previousPoints[0], previousPoints[1]);
    const newDistance = currentPoints.length === 1 ? 0 : Vector.distance(currentPoints[0], currentPoints[1]);
    const scaleDiff = prevDistance ? newDistance / prevDistance : 1;

    this.#applyChange(newMidpoint.x - prevMidpoint.x, newMidpoint.y - prevMidpoint.y, scaleDiff, originX, originY);
  };

  #applyChange(panX = 0, panY = 0, scaleDiff = 1, originX = 0, originY = 0) {
    const matrix = new Matrix()
      .translate(panX, panY) // Translate according to panning.
      .translate(originX, originY) // Scale about the origin.
      .translate(this.x, this.y) // Apply current translate
      .scale(scaleDiff, scaleDiff)
      .translate(-originX, -originY)
      .scale(this.scale, this.scale); // Apply current scale.

    // TODO: logic to clamp the scale needs to get polished, it's a little jittery
    if (matrix.a < this.minScale || matrix.a > this.maxScale) return;

    this.scale = matrix.a;
    this.x = matrix.e;
    this.y = matrix.f;
  }
}
