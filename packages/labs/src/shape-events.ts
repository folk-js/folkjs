import { IPointTransform, TransformStack } from '@folkjs/canvas';
import type { Rect2D } from '@folkjs/geometry/Rect2D';
import type { Shape2D, Shape2DReadonly } from '@folkjs/geometry/Shape2D';
import type { Point, Vector2Readonly } from '@folkjs/geometry/Vector2';

export type Shape2DObject = Shape2D & {
  top: number;
  right: number;
  bottom: number;
  left: number;
  topLeft: Point;
  topRight: Point;
  bottomRight: Point;
  bottomLeft: Point;
  center: Point;
  bounds: Rect2D;
  vertices: ReadonlyArray<Vector2Readonly> | undefined;
  transformStack: TransformStack;
};

// TODO: expose previous and current rects
export class TransformEvent extends Event {
  readonly #current: Shape2DReadonly;
  readonly #previous: Shape2DReadonly;

  constructor(current: Shape2DReadonly, previous: Shape2DReadonly) {
    super('transform', { cancelable: true, bubbles: true, composed: true });
    this.#current = current;
    this.#previous = previous;
  }

  get current() {
    return this.#current;
  }

  get previous() {
    return this.#previous;
  }

  #xPrevented = false;
  get xPrevented() {
    return this.defaultPrevented || this.#xPrevented;
  }
  preventX() {
    this.#xPrevented = true;
  }

  #yPrevented = false;
  get yPrevented() {
    return this.defaultPrevented || this.#yPrevented;
  }
  preventY() {
    this.#yPrevented = true;
  }

  #heightPrevented = false;
  get heightPrevented() {
    return this.defaultPrevented || this.#heightPrevented;
  }
  preventHeight() {
    this.#heightPrevented = true;
  }

  #widthPrevented = false;
  get widthPrevented() {
    return this.defaultPrevented || this.#widthPrevented;
  }
  preventWidth() {
    this.#widthPrevented = true;
  }

  #rotationPrevented = false;
  get rotationPrevented() {
    return this.defaultPrevented || this.#rotationPrevented;
  }
  preventRotate() {
    this.#rotationPrevented = true;
  }
}

export class ShapeConnectedEvent extends Event {
  #spaces: IPointTransform[] = [];

  get spaces() {
    return this.#spaces;
  }

  #shape;

  get shape() {
    return this.#shape;
  }

  constructor(shape: Shape2DObject) {
    super('shape-connected', { bubbles: true });

    this.#shape = shape;
  }

  // order top-most parent space to the bottom-most local space
  registerSpace(space: IPointTransform) {
    this.#spaces.push(space);
  }
}

export class ShapeDisconnectedEvent extends Event {
  #shape;

  get shape() {
    return this.#shape;
  }

  constructor(shape: Shape2DObject) {
    super('shape-disconnected', { bubbles: true });

    this.#shape = shape;
  }
}

declare global {
  interface ElementEventMap {
    'shape-connected': ShapeConnectedEvent;
    'shape-disconnected': ShapeDisconnectedEvent;
    transform2: TransformEvent;
  }
}
