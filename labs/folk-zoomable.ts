import { CustomAttribute, customAttributes, Matrix, toDOMPrecision, Vector } from '@lib';
import PointerTracker, { Pointer } from '@lib/pointer-tracker';
import { css } from '@lib/tags';

declare global {
  interface Element {
    zoom: FolkZoomable | undefined;
  }
}

Object.defineProperty(Element.prototype, 'zoom', {
  get() {
    return customAttributes.get(this, FolkZoomable.attributeName) as FolkZoomable | undefined;
  },
});

export class FolkZoomable extends CustomAttribute {
  static attributeName = 'folk-zoomable';

  static styles = css`
    [folk-zoomable] {
      display: block;
      overflow: hidden;
      touch-action: none;
      --folk-x: 0px;
      --folk-y: 0px;
      --folk-scale: 1;
      scale: var(--folk-scale);
      translate: var(--folk-x) var(--folk-y);
      transform-origin: 0 0;
    }

    [folk-zoomable*='grid: true'] {
      --circle-width: 1px;
      --circle: circle at var(--circle-width) var(--circle-width);
      /* Map color transparency to --folk-scale for each level of the grid */
      --bg-color-1: rgba(0, 0, 0, 1);
      --bg-color-2: rgba(0, 0, 0, clamp(0, var(--folk-scale), 1));
      --bg-color-3: rgba(0, 0, 0, clamp(0, calc(var(--folk-scale) - 0.1), 1));
      --bg-color-4: rgba(0, 0, 0, clamp(0, calc(var(--folk-scale) - 1), 1));
      --bg-color-5: rgba(0, 0, 0, clamp(0, calc(0.5 * var(--folk-scale) - 2), 1));

      /* Draw points for each level of grid as set of a background image. First background is on top.*/
      background-image: radial-gradient(var(--circle), var(--bg-color-1) var(--circle-width), transparent 0),
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
  `;

  static {
    // TODO: detect how to inject styles into shadowroot
    document.adoptedStyleSheets.push(this.styles);
  }

  #x = 0;
  get x() {
    return this.#x;
  }
  set x(value) {
    this.#x = value;
    this.#requestUpdate();
  }

  #y = 0;
  get y() {
    return this.#y;
  }
  set y(value) {
    this.#y = value;
    this.#requestUpdate();
  }

  #scale = 1;
  get scale() {
    return this.#scale;
  }
  set scale(value) {
    this.#scale = value;
    this.#requestUpdate();
  }

  #minScale = 0.05;
  get minScale() {
    return this.#minScale;
  }
  set minScale(value) {
    this.#minScale = value;
    this.#requestUpdate();
  }

  #maxScale = 8;
  get maxScale() {
    return this.#maxScale;
  }
  set maxScale(value) {
    this.#maxScale = value;
    this.#requestUpdate();
  }

  #grid = false;
  get grid() {
    return this.#grid;
  }
  set grid(value) {
    this.#grid = value;
    this.#requestUpdate();
  }

  #pointerTracker = new PointerTracker(this.ownerElement as HTMLElement, {
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

  connectedCallback(): void {
    (this.ownerElement as HTMLElement).addEventListener('wheel', this.#onWheel, { passive: false });
  }

  changedCallback(_oldValue: string, newValue: string): void {
    for (const property of newValue.split(';')) {
      const [name, value] = property.split(':').map((str) => str.trim());
      console.log(name, value);
      if (name === 'grid' && value === 'true') {
        this.grid = true;
      } else {
        const parsedValue = Number(value);
        if (
          !Number.isNaN(parsedValue) &&
          (name === 'x' || name === 'y' || name === 'scale' || name === 'minScale' || name === 'maxScale')
        ) {
          this[name] = parsedValue;
        }
      }
    }
  }

  disconnectedCallback(): void {
    (this.ownerElement as HTMLElement).removeEventListener('wheel', this.#onWheel);
    this.#pointerTracker.stop();
  }

  #updateRequested = false;

  async #requestUpdate() {
    if (this.#updateRequested) return;

    this.#updateRequested = true;
    await true;
    this.#updateRequested = false;
    this.#update();
  }

  #update() {
    const el = this.ownerElement as HTMLElement;
    el.style.setProperty('--folk-x', `${toDOMPrecision(this.#x)}px`);
    el.style.setProperty('--folk-y', `${toDOMPrecision(this.#y)}px`);
    el.style.setProperty(
      '--folk-scale',
      `clamp(${toDOMPrecision(this.#minScale)}, ${toDOMPrecision(this.#scale)}, ${toDOMPrecision(this.#maxScale)})`,
    );

    this.value = `x: ${toDOMPrecision(this.#x)}; y: ${toDOMPrecision(this.#y)}; scale: ${toDOMPrecision(this.scale)};${this.#minScale === 0.05 ? '' : ` minScale: ${toDOMPrecision(this.#minScale)};`}${this.#maxScale === 8 ? '' : `maxScale: ${toDOMPrecision(this.#maxScale)};`}${this.#grid ? ' grid: true;' : ''}`;
  }

  #onWheel = (event: WheelEvent) => {
    event.preventDefault();

    const currentRect = this.ownerElement.getBoundingClientRect();

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
    const currentRect = this.ownerElement.getBoundingClientRect();

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
