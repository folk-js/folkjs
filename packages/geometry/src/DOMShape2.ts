import { cos, sin } from './utilities.js';
import type { Vector2, Vector2Readonly } from './Vector2.js';
import * as V from './Vector2.js';

interface DOMShapeInit {
  x?: number;
  y?: number;
  height?: number;
  width?: number;
  rotation?: number;
}

/**
 * Represents a rectangle with position, size, and rotation,
 * capable of transforming points between local and parent coordinate spaces.
 *
 * **Coordinate System:**
 * - The origin `(0, 0)` is at the **top-left corner**.
 * - Positive `x` values extend **to the right**.
 * - Positive `y` values extend **downward**.
 * - Rotation is **clockwise**, in **radians**, around the rectangle's **center**.
 */
export class DOMShape implements DOMRect {
  #x;
  #y;
  #rotation;
  #width;
  #height;
  #boundedWidth: number | undefined;
  #boundedHeight: number | undefined;
  #center: Vector2 | undefined;
  #topLeft: Vector2 | undefined;
  #topRight: Vector2 | undefined;
  #bottomRight: Vector2 | undefined;
  #bottomLeft: Vector2 | undefined;

  /**
   * Constructs a new `DOMShape`.
   * @param init - Optional initial values.
   */
  constructor({ x = 0, y = 0, height = 0, width = 0, rotation = 0 }: DOMShapeInit = {}) {
    this.#x = x;
    this.#y = y;
    this.#width = width;
    this.#height = height;
    this.#rotation = rotation;
  }

  get x(): number {
    return this.#x;
  }
  set x(value) {
    this.#x = value;
    this.#invalidate();
  }

  get y(): number {
    return this.#y;
  }
  set y(value) {
    this.#y = value;
    this.#invalidate();
  }

  get height(): number {
    if (this.#boundedHeight === undefined) {
      this.#boundedHeight =
        Math.max(this.topLeft.y, this.topRight.y, this.bottomRight.y, this.bottomLeft.y) -
        Math.min(this.topLeft.y, this.topRight.y, this.bottomRight.y, this.bottomLeft.y);
    }
    return this.#boundedHeight;
  }

  get width(): number {
    if (this.#boundedWidth === undefined) {
      this.#boundedWidth =
        Math.max(this.topLeft.x, this.topRight.x, this.bottomRight.x, this.bottomLeft.x) -
        Math.min(this.topLeft.x, this.topRight.x, this.bottomRight.x, this.bottomLeft.x);
    }
    return this.#boundedWidth;
  }

  get top(): number {
    return this.y;
  }

  get right(): number {
    return this.x + this.width;
  }

  get bottom(): number {
    return this.y + this.height;
  }

  get left(): number {
    return this.x;
  }

  get rotatedWidth(): number {
    return this.#width;
  }
  set rotatedWidth(value) {
    this.#width = value;
    this.#invalidate();
  }

  get rotatedHeight(): number {
    return this.#height;
  }
  set rotatedHeight(value) {
    this.#height = value;
    this.#invalidate();
  }

  get center(): Vector2Readonly {
    if (this.#center === undefined) {
      this.#center = {
        x: this.#x + this.#width / 2,
        y: this.#y + this.#height / 2,
      };
    }
    return this.#center;
  }

  /** Gets or sets the **rotation angle** in radians, **clockwise**. */
  get rotation(): number {
    return this.#rotation;
  }
  set rotation(value: number) {
    this.#rotation = value;
  }

  get topLeft(): Vector2Readonly {
    if (this.#topLeft === undefined) {
      this.#topLeft = V.rotateAround({ x: this.#x, y: this.#y }, this.center, this.#rotation);
    }
    return this.#topLeft;
  }
  set topLeft(value) {
    this.#updateTopLeftAndBottomCorners(value, this.bottomRight);
  }

  get topRight(): Vector2Readonly {
    if (this.#topRight === undefined) {
      this.#topRight = V.rotateAround({ x: this.#x + this.#width, y: this.#y }, this.center, this.#rotation);
    }
    return this.#topRight!;
  }
  set topRight(value) {
    this.#updateTopRightAndBottomLeftCorners(value, this.bottomLeft);
  }

  get bottomRight(): Vector2Readonly {
    if (this.#bottomRight === undefined) {
      this.#bottomRight = V.rotateAround(
        { x: this.#x + this.#width, y: this.#y + this.#height },
        this.center,
        this.#rotation,
      );
    }
    return this.#bottomRight!;
  }
  set bottomRight(value) {
    this.#updateTopLeftAndBottomCorners(this.topLeft, value);
  }

  get bottomLeft(): Vector2Readonly {
    this.#bottomLeft = V.rotateAround({ x: this.#x, y: this.#y + this.#height }, this.center, this.#rotation);
    return this.#bottomLeft!;
  }
  set bottomLeft(value) {
    this.#updateTopRightAndBottomLeftCorners(this.topRight, value);
  }

  #updateTopLeftAndBottomCorners(topLeft: Vector2Readonly, bottomRight: Vector2Readonly) {
    const newCenter = {
      x: (topLeft.x + bottomRight.x) / 2,
      y: (topLeft.y + bottomRight.y) / 2,
    };

    const newTopLeft = V.rotateAround(topLeft, newCenter, -this.#rotation);
    const newBottomRight = V.rotateAround(bottomRight, newCenter, -this.#rotation);

    this.#x = newTopLeft.x;
    this.#y = newTopLeft.y;
    this.#width = newBottomRight.x - newTopLeft.x;
    this.#height = newBottomRight.y - newTopLeft.y;
    this.#invalidate();
  }

  #updateTopRightAndBottomLeftCorners(topRight: Vector2Readonly, bottomLeft: Vector2Readonly) {
    const newCenter = {
      x: (bottomLeft.x + topRight.x) / 2,
      y: (bottomLeft.y + topRight.y) / 2,
    };

    const newTopRight = V.rotateAround(topRight, newCenter, -this.#rotation);
    const newBottomLeft = V.rotateAround(bottomLeft, newCenter, -this.#rotation);

    this.#x = newBottomLeft.x;
    this.#y = newTopRight.y;
    this.#width = newTopRight.x - newBottomLeft.x;
    this.#height = newBottomLeft.y - newTopRight.y;
    this.#invalidate();
  }

  #invalidate() {
    this.#center =
      this.#topLeft =
      this.#topRight =
      this.#bottomRight =
      this.#bottomLeft =
      this.#boundedHeight =
      this.#boundedWidth =
        undefined;
  }

  toJSON(): DOMShapeInit {
    return {
      x: this.#x,
      y: this.#y,
      width: this.#width,
      height: this.#height,
      rotation: this.#rotation,
    };
  }
}

/**
 * A **read-only** version of `DOMShape` that prevents modification of position,
 * size, and rotation properties.
 */
export class DOMShapeReadonly extends DOMShape {
  constructor(init: DOMShapeInit = {}) {
    super(init);
  }

  // Explicit overrides for all getters from parent class
  override get x(): number {
    return super.x;
  }

  override get y(): number {
    return super.y;
  }

  override get width(): number {
    return super.width;
  }

  override get height(): number {
    return super.height;
  }

  override get rotation(): number {
    return super.rotation;
  }

  override get left(): number {
    return super.left;
  }

  override get top(): number {
    return super.top;
  }

  override get right(): number {
    return super.right;
  }

  override get bottom(): number {
    return super.bottom;
  }

  // override get transformMatrix(): Matrix2D {
  //   return super.transformMatrix;
  // }

  // override get inverseMatrix(): Matrix2D {
  //   return super.inverseMatrix;
  // }

  override get topLeft(): Vector2 {
    return super.topLeft;
  }

  override get topRight(): Vector2 {
    return super.topRight;
  }

  override get bottomRight(): Vector2 {
    return super.bottomRight;
  }

  override get bottomLeft(): Vector2 {
    return super.bottomLeft;
  }

  override get center(): Vector2 {
    return super.center;
  }

  // Add no-op setters
  override set x(value: number) {
    // no-op
  }

  override set y(value: number) {
    // no-op
  }

  override set width(value: number) {
    // no-op
  }

  override set height(value: number) {
    // no-op
  }

  override set rotation(value: number) {
    // no-op
  }
}
