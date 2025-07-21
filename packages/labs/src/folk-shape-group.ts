import { TransformStack } from '@folkjs/canvas';
import * as S from '@folkjs/geometry/Shape2D';
import { type Point } from '@folkjs/geometry/Vector2';
import { FolkBaseSet } from './folk-base-set';
import { ShapeConnectedEvent, ShapeDisconnectedEvent, type Shape2DObject } from './shape-events';

export class FolkShapeGroup extends FolkBaseSet implements Shape2DObject {
  override tagName = 'folk-shape-group';

  #shape = S.fromValues();
  #transformStack = new TransformStack();

  get x(): number {
    return this.#shape.x;
  }

  set x(value: number) {
    this.#shape.x = value;
  }

  get y(): number {
    return this.#shape.y;
  }
  set y(value: number) {
    this.#shape.y = value;
  }

  get width(): number {
    return this.#shape.width;
  }
  set width(value: number) {
    this.#shape.width = value;
  }

  get height(): number {
    return this.#shape.height;
  }
  set height(value: number) {
    this.#shape.height = value;
  }

  get rotation(): number {
    return this.#shape.rotation;
  }
  set rotation(value: number) {
    this.#shape.rotation = value;
  }

  get top() {
    return this.y;
  }

  set top(value) {
    this.y = value;
  }

  get right() {
    return this.x + this.width;
  }

  set right(value) {
    this.width = value - this.x;
  }

  get bottom() {
    return this.y + this.height;
  }

  set bottom(value) {
    this.height = value - this.y;
  }

  get left() {
    return this.x;
  }

  set left(value) {
    this.x = value;
  }

  get vertices() {
    return this.#shape.vertices;
  }

  get topLeft(): Point {
    return S.topLeftCorner(this.#shape);
  }

  set topLeft(point: Point) {
    S.setTopLeftCorner(this.#shape, point);
  }

  get topRight(): Point {
    return S.topRightCorner(this.#shape);
  }
  set topRight(point: Point) {
    S.setTopRightCorner(this.#shape, point);
  }

  get bottomRight(): Point {
    return S.bottomRightCorner(this.#shape);
  }
  set bottomRight(point: Point) {
    S.setBottomRightCorner(this.#shape, point);
  }

  get bottomLeft(): Point {
    return S.bottomLeftCorner(this.#shape);
  }
  set bottomLeft(point: Point) {
    S.setBottomLeftCorner(this.#shape, point);
  }

  get center(): Point {
    return S.center(this.#shape);
  }

  get bounds() {
    return S.boundingBox(this.#shape);
  }

  get transformStack() {
    return this.#transformStack;
  }

  override connectedCallback(): void {
    super.connectedCallback();

    const event = new ShapeConnectedEvent(this);
    this.dispatchEvent(event);
    this.#transformStack = new TransformStack(event.spaces);
  }

  override disconnectedCallback(): void {
    super.disconnectedCallback();

    this.dispatchEvent(new ShapeDisconnectedEvent(this));
    this.#transformStack = new TransformStack();
  }
}
