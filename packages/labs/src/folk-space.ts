import { css, FolkElement, IPointTransform, Matrix, Point, toDOMPrecision } from '@folkjs/lib';

const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

// Define the transform change callback type
export type TransformChangeCallback = (scale: number, position: Point) => void;

/**
 * FolkSpace is a zoomable and pannable container.
 *
 * It provides transformation methods for converting between page coordinates
 * and space coordinates, which is essential for proper interaction with
 * elements inside the space.
 */
export class FolkSpace extends FolkElement implements IPointTransform {
  [IPointTransform] = undefined;

  static override tagName = 'folk-space';

  static override styles = css`
    :host {
      display: block;
      position: relative;
      overflow: hidden;
      touch-action: none;
      overscroll-behavior: none;
      --grid-dot-color: 0, 0, 0;
    }

    .space-content {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      transform-origin: 0 0;
    }

    .grid {
      position: absolute;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      pointer-events: none;
      z-index: 0;
      --circle-width: 1px;
      --circle: circle at var(--circle-width) var(--circle-width);
      /* Map color transparency to scale for each level of the grid */
      --bg-color-1: rgba(var(--grid-dot-color), 1);
      --bg-color-2: rgba(var(--grid-dot-color), clamp(0, var(--scale), 1));
      --bg-color-3: rgba(var(--grid-dot-color), clamp(0, calc(var(--scale) - 0.1), 1));
      --bg-color-4: rgba(var(--grid-dot-color), clamp(0, calc(var(--scale) - 1), 1));
      --bg-color-5: rgba(var(--grid-dot-color), clamp(0, calc(0.5 * var(--scale) - 2), 1));

      /* Draw points for each level of grid as set of a background image. First background is on top.*/
      background-image:
        radial-gradient(var(--circle), var(--bg-color-1) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-2) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-3) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-4) var(--circle-width), transparent 0),
        radial-gradient(var(--circle), var(--bg-color-5) var(--circle-width), transparent 0);

      /* Each level of the grid should be a factor of --size. */
      --bg-size: calc(var(--size, 100px) / pow(2, 6) * var(--scale));

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
      background-position: var(--x) var(--y);
    }
  `;

  #contentElement: HTMLElement;
  #gridElement: HTMLElement | null = null;
  #x = 0;
  #y = 0;
  #scale = 1;
  #minScale = MIN_SCALE;
  #maxScale = MAX_SCALE;
  #onTransformChange: TransformChangeCallback | null = null;
  #isPanning = false; // Track if we're currently in a panning operation

  // Touch handling state
  #lastTouchDistance = 0;
  #lastTouchCenter: Point = { x: 0, y: 0 };
  #isTouching = false;

  constructor() {
    super();
    this.#contentElement = document.createElement('div');
    this.#contentElement.className = 'space-content';

    // Add a slot to ensure children are properly rendered
    const slot = document.createElement('slot');
    this.#contentElement.appendChild(slot);
  }

  get x(): number {
    return this.#x;
  }

  set x(value: number) {
    this.#x = value;
    this.#requestUpdate();
  }

  get y(): number {
    return this.#y;
  }

  set y(value: number) {
    this.#y = value;
    this.#requestUpdate();
  }

  get scale(): number {
    return this.#scale;
  }

  set scale(value: number) {
    this.#scale = value;
    this.#requestUpdate();
  }

  get minScale(): number {
    return this.#minScale;
  }

  set minScale(value: number) {
    this.#minScale = value;
    this.#requestUpdate();
  }

  get maxScale(): number {
    return this.#maxScale;
  }

  set maxScale(value: number) {
    this.#maxScale = value;
    this.#requestUpdate();
  }

  get position(): Point {
    return { x: this.#x, y: this.#y };
  }

  get matrix(): Matrix {
    return new Matrix().translate(this.#x, this.#y).scale(this.#scale, this.#scale);
  }

  /**
   * Converts a point from parent coordinates to local space coordinates.
   *
   * @param point The point in parent coordinates
   * @returns The point in local space coordinates
   */
  mapPointFromParent(point: Point): Point {
    // Create an inverse of the current transformation matrix
    const inverseMatrix = this.matrix.clone().invert();

    // Apply the inverse transformation to convert from parent to space coordinates
    return inverseMatrix.applyToPoint(point);
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
    const scaleMatrix = new Matrix(this.#scale, 0, 0, this.#scale, 0, 0);

    // Apply the inverse transformation to the vector
    return scaleMatrix.clone().invert().applyToPoint(vector);
  }

  /**
   * Converts a point from local space coordinates to parent coordinates.
   *
   * @param point The point in local space coordinates
   * @returns The point in parent coordinates
   */
  mapPointToParent(point: Point): Point {
    // Apply the space's transformation matrix directly
    return this.matrix.applyToPoint(point);
  }

  /**
   * Converts a vector from local space coordinates to parent coordinates.
   *
   * @param vector The vector in local space coordinates
   * @returns The vector in parent coordinates
   */
  mapVectorToParent(vector: Point): Point {
    // For vectors, we only need to apply scale (and rotation if present)
    // Create a matrix with just the scale component
    const scaleMatrix = new Matrix(this.#scale, 0, 0, this.#scale, 0, 0);

    // Apply the transformation to the vector
    return scaleMatrix.applyToPoint(vector);
  }

  get onTransformChange(): TransformChangeCallback | null {
    return this.#onTransformChange;
  }

  set onTransformChange(callback: TransformChangeCallback | null) {
    this.#onTransformChange = callback;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    const shadowRoot = this.shadowRoot;
    if (!shadowRoot) {
      console.error('Shadow root not found');
      return;
    }

    // Add content element to the shadow root
    shadowRoot.appendChild(this.#contentElement);

    // Create grid if needed
    this.#updateGrid();

    // Set up event listeners directly on the element instead of window
    this.addEventListener('wheel', this.#onWheel, { passive: false });
    this.addEventListener('mouseup', this.#onMouseUp);
    window.addEventListener('blur', this.#onBlur);

    // Add touch event listeners
    this.addEventListener('touchstart', this.#onTouchStart, { passive: false });
    this.addEventListener('touchmove', this.#onTouchMove, { passive: false });
    this.addEventListener('touchend', this.#onTouchEnd, { passive: false });
    this.addEventListener('touchcancel', this.#onTouchEnd, { passive: false });
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();
    this.removeEventListener('wheel', this.#onWheel);
    this.removeEventListener('mouseup', this.#onMouseUp);
    window.removeEventListener('blur', this.#onBlur);

    this.removeEventListener('touchstart', this.#onTouchStart);
    this.removeEventListener('touchmove', this.#onTouchMove);
    this.removeEventListener('touchend', this.#onTouchEnd);
    this.removeEventListener('touchcancel', this.#onTouchEnd);
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
    if (this.#contentElement) {
      this.#contentElement.style.transform = this.matrix.toCssString();
    }

    if (this.#gridElement) {
      this.#gridElement.style.setProperty('--scale', `${toDOMPrecision(this.scale)}`);
      this.#gridElement.style.setProperty('--x', `${toDOMPrecision(this.x)}px`);
      this.#gridElement.style.setProperty('--y', `${toDOMPrecision(this.y)}px`);
    }

    // Call the transform change callback if it exists
    if (this.#onTransformChange) {
      this.#onTransformChange(this.scale, this.position);
    }
  }

  #onWheel = (event: WheelEvent) => {
    // Stop event from bubbling to parent spaces
    event.stopPropagation();

    // If we're already panning, continue regardless of what element we're over
    if (this.#isPanning) {
      event.preventDefault();
      this.#handleWheelEvent(event);
      return;
    }

    // If we're not panning yet, check if we should start panning
    if (this.#shouldStartPanning(event)) {
      this.#isPanning = true;
      event.preventDefault();
      this.#handleWheelEvent(event);
    }
  };

  #handleWheelEvent(event: WheelEvent) {
    const rect = this.getBoundingClientRect();
    const { clientX, clientY } = event;
    let { deltaX, deltaY } = event;

    if (event.deltaMode === 1) {
      // 1 is "lines", 0 is "pixels"
      // Firefox uses "lines" for some types of mouse
      deltaX *= 15;
      deltaY *= 15;
    }

    // ctrlKey is true when pinch-zooming on a trackpad.
    if (event.ctrlKey) {
      this.applyChange(0, 0, 1 - deltaY / 100, clientX - rect.left, clientY - rect.top);
    } else {
      this.applyChange(-1 * deltaX, -1 * deltaY, 1, clientX - rect.left, clientY - rect.top);
    }
  }

  #onMouseUp = () => {
    // Reset panning state when mouse is released
    this.#isPanning = false;
  };

  #onBlur = () => {
    // Reset panning state when window loses focus
    this.#isPanning = false;
  };

  /**
   * Check if we should start panning based on the initial wheel event
   */
  #shouldStartPanning(wheelEvent: WheelEvent): boolean {
    let el = wheelEvent.target as Element | null;

    while (el) {
      if (el === this) {
        const rect = this.getBoundingClientRect();
        if (
          rect.left < wheelEvent.clientX &&
          wheelEvent.clientX < rect.right &&
          rect.top < wheelEvent.clientY &&
          wheelEvent.clientY < rect.bottom
        ) {
          return true;
        }
      }

      if (el.scrollHeight > el.clientHeight) return false;

      el = el.parentElement;
    }

    return false;
  }

  /**
   * Handle touch start event
   */
  #onTouchStart = (event: TouchEvent) => {
    // Stop event from bubbling to parent spaces
    event.stopPropagation();

    // Prevent default to avoid browser's native handling
    event.preventDefault();

    if (event.touches.length === 2) {
      this.#isTouching = true;

      // Calculate initial distance between two fingers
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      this.#lastTouchDistance = this.#getDistance(touch1.clientX, touch1.clientY, touch2.clientX, touch2.clientY);

      // Calculate center point between the two touches
      this.#lastTouchCenter = this.#getTouchCenter(touch1, touch2);
    }
  };

  /**
   * Handle touch move event
   */
  #onTouchMove = (event: TouchEvent) => {
    // Stop event from bubbling to parent spaces
    event.stopPropagation();

    // Prevent default to avoid browser's native handling
    event.preventDefault();

    if (!this.#isTouching || event.touches.length !== 2) return;

    const touch1 = event.touches[0];
    const touch2 = event.touches[1];

    // Calculate new distance between fingers
    const currentDistance = this.#getDistance(touch1.clientX, touch1.clientY, touch2.clientX, touch2.clientY);

    // Calculate new center point
    const currentCenter = this.#getTouchCenter(touch1, touch2);

    // Calculate scale change
    const scaleFactor = currentDistance / this.#lastTouchDistance;

    // Calculate pan change
    const deltaX = currentCenter.x - this.#lastTouchCenter.x;
    const deltaY = currentCenter.y - this.#lastTouchCenter.y;

    // Get the rect for coordinate conversion
    const rect = this.getBoundingClientRect();

    // Apply the transformation
    this.applyChange(deltaX, deltaY, scaleFactor, currentCenter.x - rect.left, currentCenter.y - rect.top);

    // Update last values for next move
    this.#lastTouchDistance = currentDistance;
    this.#lastTouchCenter = currentCenter;
  };

  /**
   * Handle touch end event
   */
  #onTouchEnd = (event: TouchEvent) => {
    if (event.touches.length < 2) {
      this.#isTouching = false;
    }
  };

  /**
   * Calculate distance between two points
   */
  #getDistance(x1: number, y1: number, x2: number, y2: number): number {
    const dx = x2 - x1;
    const dy = y2 - y1;
    return Math.sqrt(dx * dx + dy * dy);
  }

  /**
   * Calculate center point between two touches
   */
  #getTouchCenter(touch1: Touch, touch2: Touch): Point {
    return {
      x: (touch1.clientX + touch2.clientX) / 2,
      y: (touch1.clientY + touch2.clientY) / 2,
    };
  }

  /**
   * Apply changes to the matrix based on pan and zoom operations
   */
  applyChange(panX = 0, panY = 0, scaleDiff = 1, originX = 0, originY = 0) {
    // Calculate the new scale first
    const newScale = this.scale * scaleDiff;

    // Check if the new scale is within bounds
    if (newScale < this.#minScale || newScale > this.#maxScale) return;

    // Calculate new position that keeps the point under the cursor in the same position
    const x = originX - (originX - this.x) * scaleDiff + panX;
    const y = originY - (originY - this.y) * scaleDiff + panY;

    // Apply the new values
    this.scale = newScale;
    this.x = x;
    this.y = y;
  }

  /**
   * Reset the space to its initial state
   */
  reset(): void {
    this.x = 0;
    this.y = 0;
    this.scale = 1;
  }

  /**
   * Update the grid element
   */
  #updateGrid(): void {
    if (!this.shadowRoot) return;

    if (!this.#gridElement) {
      this.#gridElement = document.createElement('div');
      this.#gridElement.className = 'grid';
      // Insert the grid before the content element instead of appending it after
      this.shadowRoot.insertBefore(this.#gridElement, this.#contentElement);
    }
    this.#gridElement.style.setProperty('--scale', `${toDOMPrecision(this.scale)}`);
    this.#gridElement.style.setProperty('--x', `${toDOMPrecision(this.x)}px`);
    this.#gridElement.style.setProperty('--y', `${toDOMPrecision(this.y)}px`);
  }
}

// Define the custom element
FolkSpace.define();
