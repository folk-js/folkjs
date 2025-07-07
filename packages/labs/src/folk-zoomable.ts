import { IPointTransform, toDOMPrecision, type Point } from '@folkjs/canvas';
import { CustomAttribute, customAttributes } from '@folkjs/dom/CustomAttribute';
import { css } from '@folkjs/dom/tags';
import * as BVH from '@folkjs/geometry/BoundingVolumeHierarchy';
import * as M from '@folkjs/geometry/Matrix2D';
import * as S from '@folkjs/geometry/Shape2D';
import { FolkShapeAttribute, ShapeConnectedEvent, ShapeDisconnectedEvent } from './folk-shape-attribute';

declare global {
  interface Element {
    zoom: FolkSpaceAttribute | undefined;
  }
}

const MIN_SCALE = 0.05;
const MAX_SCALE = 10;

export class SpaceTransformEvent extends Event {
  #space;

  get space() {
    return this.#space;
  }

  constructor(space: FolkSpaceAttribute) {
    super('space-transform', { bubbles: true });

    this.#space = space;
  }
}

declare global {
  interface ElementEventMap {
    'space-transform': SpaceTransformEvent;
  }
}

export class FolkSpaceAttribute extends CustomAttribute implements IPointTransform {
  static override attributeName = 'folk-zoomable';

  static override define() {
    if (!customAttributes.isDefined(this.attributeName)) {
      Object.defineProperty(Element.prototype, 'zoom', {
        get() {
          return customAttributes.get(this, FolkSpaceAttribute.attributeName) as FolkSpaceAttribute | undefined;
        },
      });
    }

    super.define();
  }

  static styles = css`
    :host([folk-zoomable]) {
      display: block;
      position: relative;
      overflow: visible;
      touch-action: none;
      --folk-x: 0px;
      --folk-y: 0px;
      --folk-scale: 1;
    }

    :host([folk-zoomable*='grid: true']) {
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

  #shadow!: ShadowRoot;
  #slot = document.createElement('slot');
  #container = document.createElement('div');
  #matrix = M.fromValues();
  #shapes: FolkShapeAttribute[] = [];
  #bvh: BVH.BVHNode<S.Shape2D> | null = null;

  get bvh(): BVH.BVHNodeReadonly<S.Shape2D> {
    if (this.#bvh === null) {
      this.#bvh = BVH.fromShapes(this.#shapes);
    }

    return this.#bvh;
  }

  get x() {
    return this.#matrix.e;
  }
  set x(value) {
    this.#matrix.e = value;
    this.#requestUpdate();
  }

  get y() {
    return this.#matrix.f;
  }
  set y(value) {
    this.#matrix.f = value;
    this.#requestUpdate();
  }

  get scale() {
    return this.#matrix.a;
  }
  set scale(value) {
    this.#matrix.a = value;
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

  /**
   * Converts a point from parent coordinates to local space coordinates.
   *
   * @param point The point in parent coordinates
   * @returns The point in local space coordinates
   */
  mapPointFromParent(point: Point): Point {
    // Create an inverse of the current transformation matrix
    const inverseMatrix = M.invert(this.#matrix);

    // Apply the inverse transformation to convert from parent to space coordinates
    return M.applyToPoint(inverseMatrix, point);
  }

  /**
   * Converts a vector from parent coordinates to local space coordinates.
   * Vectors are affected by scale and rotation, but not by translation.
   *
   * @param vector The vector in parent coordinates
   * @returns The vector in local space coordinates
   */
  mapVectorFromParent(vector: Point): Point {
    // For vectors, we only need to apply scale (and rotation if present)
    // Create a matrix with just the scale component
    const scaleMatrix = M.fromValues(this.scale, 0, 0, this.scale, 0, 0);

    // Apply the inverse transformation to the vector
    return M.applyToPoint(M.invertSelf(scaleMatrix), vector);
  }

  /**
   * Converts a point from local space coordinates to parent coordinates.
   *
   * @param point The point in local space coordinates
   * @returns The point in parent coordinates
   */
  mapPointToParent(point: Point): Point {
    // Apply the space's transformation matrix directly
    return M.applyToPoint(this.#matrix, point);
  }

  /**
   * Converts a point from local space coordinates to parent coordinates.
   *
   * @param vector The point in local space coordinates
   * @returns The point in parent coordinates
   */
  mapVectorToParent(point: Point): Point {
    // For vectors, we only need to apply scale (and rotation if present)
    // Create a matrix with just the scale component
    const scaleMatrix = M.fromValues(this.scale, 0, 0, this.scale, 0, 0);

    // Apply the transformation to the vector
    return M.applyToPoint(scaleMatrix, point);
  }

  override connectedCallback(): void {
    // If we apply the CSS transforms to the ownerElement then we miss out on wheel events the originate from the original bounding box of ownerElement
    // Unless there is a good way around that (which I haven't figured out) then this attribute can only be added on elements without an existing shadowDOM.
    // This make sense for some stuff like leaf elements (<input>). Hopefully it's not to restrictive of a constraint.

    // If this attribute is removed then reapplied then it will error out. Is there a way to handle that?
    try {
      this.#shadow = this.ownerElement.attachShadow({ mode: 'open' });
    } catch (error) {
      console.warn("folk-zoomable attribute can't work with an element that already has a shadow root.");
      return;
    }

    this.#shadow.adoptedStyleSheets.push((this.constructor as typeof FolkSpaceAttribute).styles);

    this.#container.appendChild(this.#slot);

    this.#shadow.append(this.#container);

    this.ownerElement.addEventListener('shape-connected', this.#onShapeConnected);
    this.ownerElement.addEventListener('shape-disconnected', this.#onShapeDisconnected);
    (this.ownerElement as HTMLElement).addEventListener('wheel', this.#onWheel, { passive: false });
  }

  override changedCallback(_oldValue: string, newValue: string): void {
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

  override disconnectedCallback(): void {
    const styles = (this.constructor as typeof FolkSpaceAttribute).styles;
    this.#shadow.adoptedStyleSheets.splice(
      this.#shadow.adoptedStyleSheets.findIndex((s) => s === styles),
      1,
    );
    this.ownerElement.removeEventListener('shape-connected', this.#onShapeConnected);
    this.ownerElement.removeEventListener('shape-disconnected', this.#onShapeDisconnected);
    (this.ownerElement as HTMLElement).removeEventListener('wheel', this.#onWheel);
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

    this.ownerElement.dispatchEvent(new SpaceTransformEvent(this));
  }

  // We are using event delegation to capture wheel events that don't happen in the transformed rect of the zoomable element.
  #onWheel = (event: WheelEvent) => {
    event.preventDefault();

    const { left, top } = this.#container.getBoundingClientRect();

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
    this.#shapes.push(event.shape);
    this.#bvh = null;
    event.shape.ownerElement.addEventListener('transform', this.#onShapeTransform);
    event.registerSpace(this);
  };

  #onShapeDisconnected = (event: ShapeDisconnectedEvent) => {
    event.shape.ownerElement.removeEventListener('transform', this.#onShapeTransform);
    this.#shapes.splice(
      this.#shapes.findIndex((s) => s === event.shape),
      1,
    );
    this.#bvh = null;
  };

  #onShapeTransform = () => {
    this.#bvh = null;
  };

  applyChange(panX = 0, panY = 0, scaleDiff = 1, originX = 0, originY = 0) {
    const { x, y, scale } = this;

    M.identitySelf(this.#matrix);
    M.translateSelf(this.#matrix, panX, panY); // Translate according to panning.
    M.translateSelf(this.#matrix, originX, originY); // Scale about the origin.
    M.translateSelf(this.#matrix, x, y);
    M.scaleSelf(this.#matrix, scaleDiff, scaleDiff);
    M.translateSelf(this.#matrix, -originX, -originY);
    M.scaleSelf(this.#matrix, scale, scale);

    this.#requestUpdate();
  }
}
