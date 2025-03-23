import { css, CustomAttribute, customAttributes, Matrix, toDOMPrecision } from '@folkjs/lib';
import { FolkShapeAttribute, ShapeConnectedEvent, ShapeDisconnectedEvent } from './folk-shape-attribute';

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

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

export class FolkZoomable extends CustomAttribute {
  static attributeName = 'folk-zoomable';

  static styles = css`
    @layer folk {
      [folk-zoomable] {
        display: block;
        overflow: visible;
        touch-action: none;
        --folk-x: 0px;
        --folk-y: 0px;
        --folk-scale: 1;
        scale: var(--folk-scale);
        translate: var(--folk-x) var(--folk-y);
        transform-origin: 0 0;

        :first-child {
          margin-top: 0;
        }
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
    }
  `;

  static {
    // TODO: detect how to inject styles into shadowroot
    document.adoptedStyleSheets.push(this.styles);
  }

  #matrix = new Matrix();

  get x() {
    return this.#matrix.e;
  }
  set x(value) {
    this.#requestUpdate();
  }

  get y() {
    return this.#matrix.f;
  }
  set y(value) {
    this.#requestUpdate();
  }

  get scale() {
    return this.#matrix.a;
  }
  set scale(value) {
    this.#requestUpdate();
  }

  #minScale = MIN_SCALE;
  get minScale() {
    return this.#minScale;
  }
  set minScale(value) {
    this.#minScale = value;
    this.#requestUpdate();
  }

  #maxScale = MAX_SCALE;
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

  #shapes = new Set<FolkShapeAttribute>();

  connectedCallback(): void {
    this.ownerElement.addEventListener('shape-connected', this.#onShapeConnected);
    this.ownerElement.addEventListener('shape-disconnected', this.#onShapeDisconnected);
    window.addEventListener('wheel', this.#onWheel, { passive: false });
  }

  changedCallback(_oldValue: string, newValue: string): void {
    if (newValue.length === 0) {
      this.x = 0;
      this.y = 0;
      this.scale = 1;
      this.minScale = MIN_SCALE;
      this.maxScale = MAX_SCALE;
      return;
    }

    for (const property of newValue.split(';')) {
      const [name, value] = property.split(':').map((str) => str.trim());
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
    this.ownerElement.removeEventListener('shape-connected', this.#onShapeConnected);
    this.ownerElement.removeEventListener('shape-disconnected', this.#onShapeDisconnected);
    window.removeEventListener('wheel', this.#onWheel);
    // this.#pointerTracker.stop();
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
    el.style.setProperty('--folk-x', `${toDOMPrecision(this.x)}px`);
    el.style.setProperty('--folk-y', `${toDOMPrecision(this.y)}px`);
    el.style.setProperty(
      '--folk-scale',
      `clamp(${toDOMPrecision(this.#minScale)}, ${toDOMPrecision(this.scale)}, ${toDOMPrecision(this.#maxScale)})`,
    );

    this.value =
      `x: ${toDOMPrecision(this.x)}; y: ${toDOMPrecision(this.y)}; scale: ${toDOMPrecision(this.scale)};` +
      (this.#minScale === MIN_SCALE ? '' : ` minScale: ${toDOMPrecision(this.#minScale)};`) +
      (this.#maxScale === MAX_SCALE ? '' : `maxScale: ${toDOMPrecision(this.#maxScale)};`) +
      (this.#grid ? ' grid: true;' : '');
  }

  // We are using event delegation to capture wheel events that don't happen in the transformed rect of the zoomable element.
  #onWheel = (event: WheelEvent) => {
    const {} = event;
    // Check that this wheel event is happening inside of the zoomable element, accounting for the transformed rect.
    // TODO: add another check for children that are scrollable.
    if (!isZoomableElementBeingScrolled(event, this.ownerElement as HTMLElement)) {
      console.log('out of bounds ');
      return;
    }

    event.preventDefault();
    console.log('wheel prevented');

    const { left, top } = this.ownerElement.getBoundingClientRect();

    let { clientX, clientY, deltaX, deltaY } = event;

    if (event.deltaMode === 1) {
      // 1 is "lines", 0 is "pixels"
      // Firefox uses "lines" for some types of mouse
      deltaX *= 15;
      deltaY *= 15;
    }

    // ctrlKey is true when pinch-zooming on a trackpad.
    if (event.ctrlKey) {
      this.applyChange(0, 0, 1 - deltaY / 100, clientX - left, clientY - top);
    } else {
      this.applyChange(-1 * deltaX, -1 * deltaY, 1, clientX - left, clientY - top);
    }
  };

  #onShapeConnected = (event: ShapeConnectedEvent) => {
    this.#shapes.add(event.shape);
    event.registerSpace(this);
  };

  #onShapeDisconnected = (event: ShapeDisconnectedEvent) => {
    this.#shapes.delete(event.shape);
  };

  applyChange(panX = 0, panY = 0, scaleDiff = 1, originX = 0, originY = 0) {
    const { x, y, scale } = this;

    this.#matrix
      .identity()
      .translate(panX, panY) // Translate according to panning.
      .translate(originX, originY) // Scale about the origin.
      .translate(x, y)
      .scale(scaleDiff, scaleDiff)
      .translate(-originX, -originY)
      .scale(scale, scale);

    this.#requestUpdate();
  }
}

function isZoomableElementBeingScrolled(wheelEvent: WheelEvent, zoomableElement: HTMLElement): boolean {
  let el = wheelEvent.target as Element | null;

  while (el) {
    if (
      el === zoomableElement &&
      zoomableElement.offsetLeft < wheelEvent.clientX &&
      wheelEvent.clientX < zoomableElement.offsetLeft + zoomableElement.offsetWidth &&
      zoomableElement.offsetTop < wheelEvent.clientY &&
      wheelEvent.clientY < zoomableElement.offsetTop + zoomableElement.offsetHeight
    )
      return true;

    if (el.scrollHeight > el.clientHeight) return false;

    el = el.parentElement;
  }

  return false;
}
