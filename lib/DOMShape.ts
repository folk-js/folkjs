import { Point } from './types';

interface DOMShapeInit {
  height?: number;
  width?: number;
  x?: number;
  y?: number;
  rotation?: number;
}

export class DOMShape implements DOMRect {
  #centerX: number;
  #centerY: number;
  #halfWidth: number;
  #halfHeight: number;
  #rotation: number; // Rotation angle in radians, clockwise

  #rotatedWidth: number | undefined;
  #rotatedHeight: number | undefined;
  #topLeft: Point | undefined;
  #topRight: Point | undefined;
  #bottomRight: Point | undefined;
  #bottomLeft: Point | undefined;

  constructor(init: DOMShapeInit = {}) {
    this.#halfWidth = (init.width ?? 0) / 2;
    this.#halfHeight = (init.height ?? 0) / 2;
    this.#centerX = (init.x ?? 0) + this.#halfWidth;
    this.#centerY = (init.y ?? 0) + this.#halfHeight;

    this.#rotation = init.rotation ?? 0;
  }

  /** Gets or sets the **x** coordinate of the bounding rect. */
  get x(): number {
    return this.#centerX - this.#halfWidth;
  }
  set x(value: number) {
    this.#centerX = value + this.#halfWidth;
    this.#reset();
  }

  /** Gets or sets the **y** coordinate of the bounding rect. */
  get y(): number {
    return this.#centerY - this.#halfHeight;
  }
  set y(value: number) {
    this.#centerY = value + this.#halfHeight;
    this.#reset();
  }

  /** Gets or sets the **width** of the bounding rectangle. */
  get width(): number {
    return this.#halfWidth * 2;
  }
  set width(value: number) {
    this.#halfWidth = value / 2;
    this.#centerX += this.#halfWidth;
    this.#reset();
  }

  /** Gets or sets the **height** of the bounding rectangle. */
  get height(): number {
    return this.#halfHeight * 2;
  }
  set height(value: number) {
    this.#halfHeight = value / 2;
    this.#centerY += this.#halfHeight;
    this.#reset();
  }

  /** The **left** coordinate of the bounding rectangle (same as `x`). */
  get left(): number {
    return this.x;
  }
  set left(value: number) {
    this.#halfWidth = (this.right - value) / 2;
    this.#centerX = value + this.#halfWidth;
    this.#reset();
  }

  /** The **top** coordinate of the bounding rectangle (same as `y`). */
  get top(): number {
    return this.y;
  }
  set top(value: number) {
    this.#halfHeight = (this.bottom - value) / 2;
    this.#centerY = value + this.#halfHeight;
    this.#reset();
  }

  /** The **right** coordinate of the rectangle (`x + width`). */
  get right(): number {
    return this.#centerX + this.#halfWidth;
  }
  set right(value: number) {
    this.#halfWidth = (value - this.left) / 2;
    this.#centerX = value - this.#halfWidth;
    this.#reset();
  }

  /** The **bottom** coordinate of the rectangle (`y + height`). */
  get bottom(): number {
    return this.#centerY + this.#halfHeight;
  }
  set bottom(value: number) {
    this.#halfHeight = (value - this.top) / 2;
    this.#centerY = value - this.#halfHeight;
    this.#reset();
  }

  /** Gets or sets the **rotation angle** in radians, **clockwise**. */
  get rotation(): number {
    return this.#rotation;
  }
  set rotation(value) {
    this.#rotation = value;
    this.#reset();
  }

  get center(): Point {
    return { x: this.#centerX, y: this.#centerY };
  }
  set center(value: Point) {
    this.#centerX = value.x;
    this.#centerY = value.y;
    this.#reset();
  }

  // https://math.stackexchange.com/questions/4001034/calculate-the-dimensions-of-a-rotated-rectangle-inside-a-bounding-box
  get rotatedWidth(): number {
    if (this.#rotatedWidth === undefined) {
      const cos = Math.cos(this.#rotation);
      const sin = Math.sin(this.#rotation);
      const num = this.width * cos - this.height * sin;
      const denom = cos ** 2 - sin ** 2;

      this.#rotatedWidth = denom === 0 || num === 0 ? (Math.sqrt(2) * this.width) / 2 : num / denom;
    }

    return this.#rotatedWidth;
  }

  get rotatedHeight(): number {
    if (this.#rotatedHeight === undefined) {
      const cos = Math.cos(this.#rotation);
      const sin = Math.sin(this.#rotation);
      const num = this.width * sin - this.height * cos;
      const denom = sin ** 2 - cos ** 2;

      this.#rotatedHeight = denom === 0 || num === 0 ? (Math.sqrt(2) * this.width) / 2 : num / denom;
    }

    return this.#rotatedHeight;
  }

  /**
   * Gets the **top-left** corner of the transformed rectangle.
   */
  get topLeft(): Point {
    if (this.#topLeft === undefined) {
      this.#topLeft = {
        x: this.x + Math.sin(this.#rotation) * this.rotatedHeight,
        y: this.y,
      };
    }
    return this.#topLeft;
  }
  set topLeft(value) {
    const invertedPoint = this.#invertRotatedPoint(value.x, value.y);
    this.top = invertedPoint.y;
    this.left = invertedPoint.x;
  }

  /**
   * Gets the **top-right** corner of the transformed rectangle.
   */
  get topRight(): Point {
    if (this.#topRight === undefined) {
      this.#topRight = this.#rotatePoint(this.right, this.top);
    }
    return this.#topRight;
  }
  set topRight(value) {
    const invertedPoint = this.#invertRotatedPoint(value.x, value.y);
    this.top = invertedPoint.y;
    this.right = invertedPoint.x;
  }

  /**
   * Gets the **bottom-right** corner of the transformed rectangle.
   */
  get bottomRight(): Point {
    if (this.#bottomRight === undefined) {
      this.#bottomRight = this.#rotatePoint(this.right, this.bottom);
    }
    return this.#bottomRight;
  }
  set bottomRight(value) {
    const invertedPoint = this.#invertRotatedPoint(value.x, value.y);
    this.bottom = invertedPoint.y;
    this.right = invertedPoint.x;
  }

  /**
   * Gets the **bottom-left** corner of the transformed rectangle.
   */
  get bottomLeft(): Point {
    if (this.#bottomLeft === undefined) {
      this.#bottomLeft = this.#rotatePoint(this.left, this.bottom);
    }
    return this.#bottomLeft;
  }
  set bottomLeft(value) {
    const invertedPoint = this.#invertRotatedPoint(value.x, value.y);
    this.bottom = invertedPoint.y;
    this.left = invertedPoint.x;
  }

  /**
   * Gets the vertices of the transformed shape.
   */
  vertices(): Point[] {
    return [this.topLeft, this.topRight, this.bottomRight, this.bottomLeft];
  }

  scale(sx: number, sy: number = sx, originX = this.#centerX, originY = this.#centerY) {
    this.#halfWidth *= sx;
    this.#halfHeight *= sy;
    this.#centerX = (this.#centerX - originX) * sx + originX;
    this.#centerY = (this.#centerY - originY) * sy + originY;
    this.#reset();
  }

  /** Rotate the center of the shape around another point. */
  rotate(rotation: number, originX: number, originY: number) {
    this.center = this.#rotatePoint(this.#centerX, this.#centerY, rotation, originX, originY);
  }

  /**
   * Converts the rectangle's properties to a JSON serializable object.
   * @returns An object containing the rectangle's `x`, `y`, `width`, `height`, and `rotation`.
   */
  toJSON() {
    return {
      x: this.x,
      y: this.y,
      width: this.width,
      height: this.height,
      rotation: this.rotation,
    };
  }

  #reset() {
    this.#rotatedHeight = undefined;
    this.#rotatedWidth = undefined;
    this.#topLeft = undefined;
    this.#topRight = undefined;
    this.#bottomRight = undefined;
    this.#bottomLeft = undefined;
  }

  #rotatePoint(
    x: number,
    y: number,
    rotation = this.#rotation,
    originX = this.#centerX,
    originY = this.#centerY,
  ): Point {
    if (rotation === 0) return { x, y };

    const s = Math.sin(rotation);
    const c = Math.cos(rotation);

    x -= originX;
    y -= originY;

    return {
      x: x * c - y * s + originX,
      y: x * s + y * c + originY,
    };
  }

  #invertRotatedPoint(
    x: number,
    y: number,
    rotation = this.#rotation,
    originX = this.#centerX,
    originY = this.#centerY,
  ): Point {
    return this.#rotatePoint(x, y, -rotation, originX, originY);
  }
}

export class DOMShapeReadonly extends DOMShape {
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

  override get topLeft(): Point {
    return super.topLeft;
  }

  override get topRight(): Point {
    return super.topRight;
  }

  override get bottomRight(): Point {
    return super.bottomRight;
  }

  override get bottomLeft(): Point {
    return super.bottomLeft;
  }

  override get center(): Point {
    return super.center;
  }

  override set x(_value) {
    // no-op
  }

  override set y(_value) {
    // no-op
  }

  override set width(_value) {
    // no-op
  }

  override set height(_value) {
    // no-op
  }

  override set rotation(_value) {
    // no-op
  }

  override set left(_value) {
    // no-op
  }

  override set top(_value) {
    // no-op
  }

  override set right(_value) {
    // no-op
  }

  override set bottom(_value) {
    // no-op
  }

  override set topLeft(_value) {
    // no-op
  }

  override set topRight(_value) {
    // no-op
  }

  override set bottomRight(_value) {
    // no-op
  }

  override set bottomLeft(_value) {
    // no-op
  }

  override set center(_value) {
    // no-op
  }
}
