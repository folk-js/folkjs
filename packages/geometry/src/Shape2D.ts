import { isRect2D, type Rect2D } from './Rect2D.ts';
import { isNumber } from './utilities.ts';
import type { Vector2Readonly } from './Vector2.ts';
import * as V from './Vector2.ts';

export type Shape2D = Rect2D & {
  /** Clockwise rotation of the shape, in radians. */
  rotation: number;
  /** Relative vertices of the shape, in the range [0, 1] */
  vertices: ReadonlyArray<V.Vector2Readonly> | undefined;
};

export type Shape2DReadonly = Readonly<Shape2D>;

export type Shape2DCorners = Readonly<{
  topLeft: Vector2Readonly;
  topRight: Vector2Readonly;
  bottomRight: Vector2Readonly;
  bottomLeft: Vector2Readonly;
}>;

export function isShape2D(shape: Shape2D) {
  return isRect2D(shape) && isNumber(shape.rotation);
}

export function fromValues(x = 0, y = 0, width = 0, height = 0, rotation = 0, vertices?: Shape2D['vertices']): Shape2D {
  return { x, y, width, height, rotation, vertices };
}

export function fromTriangle(x = 0, y = 0, width = 0, height = 0, rotation = 0): Shape2D {
  return fromValues(x, y, width, height, rotation, [V.fromValues(0.5, 1), V.fromValues(1, 1), V.fromValues(0, 1)]);
}

export function fromDiamond(x = 0, y = 0, width = 0, height = 0, rotation = 0): Shape2D {
  return fromValues(x, y, width, height, rotation, [
    V.fromValues(0.5, 1),
    V.fromValues(1, 1),
    V.fromValues(0, 1),
    V.fromValues(0, 0.5),
  ]);
}

export function fromRhombus(x = 0, y = 0, width = 0, height = 0, rotation = 0): Shape2D {
  return fromValues(x, y, width, height, rotation, [
    V.fromValues(0.25, 0),
    V.fromValues(1, 0),
    V.fromValues(0.75, 1),
    V.fromValues(0, 1),
  ]);
}

export function fromHexagon(x = 0, y = 0, width = 0, height = 0, rotation = 0): Shape2D {
  return fromValues(x, y, width, height, rotation, [
    V.fromValues(0.5, 0),
    V.fromValues(1, 0.25),
    V.fromValues(1, 0.75),
    V.fromValues(0.5, 1),
    V.fromValues(0, 0.75),
    V.fromValues(0, 0.25),
  ]);
}

export function fromCircle(x = 0, y = 0, radius: number): Shape2D {
  return fromValues(x, y, radius, radius, 0, []);
}

export function fromEclipse(x = 0, y = 0, width = 0, height = 0, rotation = 0): Shape2D {
  return fromValues(x, y, width, height, rotation, []);
}

export function clone({ x, y, width, height, rotation, vertices }: Shape2D): Shape2D {
  return { x, y, width, height, rotation, vertices };
}

export function copy(s1: Shape2DReadonly, s2: Shape2D): Shape2D {
  s2.x = s1.x;
  s2.y = s1.y;
  s2.width = s1.width;
  s2.height = s1.height;
  s2.rotation = s1.rotation;
  s2.vertices = s1.vertices;

  return s2;
}

export function center(shape: Shape2DReadonly): Vector2Readonly {
  return {
    x: shape.x + shape.width * 0.5,
    y: shape.y + shape.height * 0.5,
  };
}

export function topLeftCorner(shape: Shape2DReadonly, c = center(shape)) {
  return V.rotateAround({ x: shape.x, y: shape.y }, c, shape.rotation);
}

export function topRightCorner(shape: Shape2DReadonly, c = center(shape)) {
  return V.rotateAround({ x: shape.x + shape.width, y: shape.y }, c, shape.rotation);
}

export function bottomRightCorner(shape: Shape2DReadonly, c = center(shape)) {
  return V.rotateAround({ x: shape.x + shape.width, y: shape.y + shape.height }, c, shape.rotation);
}

export function bottomLeftCorner(shape: Shape2DReadonly, c = center(shape)) {
  return V.rotateAround({ x: shape.x, y: shape.y + shape.height }, c, shape.rotation);
}

export function corners(shape: Shape2DReadonly, c = center(shape)): Shape2DCorners {
  return {
    topLeft: topLeftCorner(shape, c),
    topRight: topRightCorner(shape, c),
    bottomRight: bottomRightCorner(shape, c),
    bottomLeft: bottomLeftCorner(shape, c),
  };
}

function updateTopLeftAndBottomRightCorners(shape: Shape2D, topLeft: Vector2Readonly, bottomRight: Vector2Readonly) {
  const newCenter = {
    x: (topLeft.x + bottomRight.x) * 0.5,
    y: (topLeft.y + bottomRight.y) * 0.5,
  };

  // Undo shape rotation
  const newTopLeft = V.rotateAround(topLeft, newCenter, -shape.rotation);
  const newBottomRight = V.rotateAround(bottomRight, newCenter, -shape.rotation);

  shape.x = newTopLeft.x;
  shape.y = newTopLeft.y;
  shape.width = newBottomRight.x - newTopLeft.x;
  shape.height = newBottomRight.y - newTopLeft.y;
}

function updateTopRightAndBottomLeftCorners(shape: Shape2D, topRight: Vector2Readonly, bottomLeft: Vector2Readonly) {
  const newCenter = {
    x: (bottomLeft.x + topRight.x) * 0.5,
    y: (bottomLeft.y + topRight.y) * 0.5,
  };

  // Undo shape rotations
  const newTopRight = V.rotateAround(topRight, newCenter, -shape.rotation);
  const newBottomLeft = V.rotateAround(bottomLeft, newCenter, -shape.rotation);

  shape.x = newBottomLeft.x;
  shape.y = newTopRight.y;
  shape.width = newTopRight.x - newBottomLeft.x;
  shape.height = newBottomLeft.y - newTopRight.y;
}

export function setTopLeftCorner(shape: Shape2D, topLeft: Vector2Readonly) {
  return updateTopLeftAndBottomRightCorners(shape, topLeft, bottomRightCorner(shape));
}

export function setTopRightCorner(shape: Shape2D, topRight: Vector2Readonly) {
  updateTopRightAndBottomLeftCorners(shape, topRight, bottomLeftCorner(shape));
}

export function setBottomRightCorner(shape: Shape2D, bottomRight: Vector2Readonly) {
  return updateTopLeftAndBottomRightCorners(shape, topLeftCorner(shape), bottomRight);
}

export function setBottomLeftCorner(shape: Shape2D, bottomLeft: Vector2Readonly) {
  updateTopRightAndBottomLeftCorners(shape, topRightCorner(shape), bottomLeft);
}

export function rotateAround(shape: Shape2D, angle: number, origin: Vector2Readonly) {
  const { topLeft, bottomRight } = corners(shape);
  const newTopLeft = V.rotateAround(topLeft, origin, angle);
  const newBottomRight = V.rotateAround(bottomRight, origin, angle);
  shape.rotation = angle;
  updateTopLeftAndBottomRightCorners(shape, newTopLeft, newBottomRight);
}

export function bounds(shape: Shape2DReadonly, c?: Shape2DCorners): Rect2D {
  if (shape.rotation === 0) {
    return {
      x: shape.x,
      y: shape.y,
      width: shape.width,
      height: shape.height,
    };
  }

  const { topLeft, topRight, bottomRight, bottomLeft } = c ?? corners(shape);

  const x = Math.min(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x);
  const y = Math.min(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y);

  return {
    x,
    y,
    width: Math.max(topLeft.x, topRight.x, bottomRight.x, bottomLeft.x) - x,
    height: Math.max(topLeft.y, topRight.y, bottomRight.y, bottomLeft.y) - y,
  };
}

export function absoluteVertices(shape: Shape2DReadonly, c = center(shape)): ReadonlyArray<V.Vector2Readonly> {
  if (shape.vertices === undefined) {
    const { topLeft, topRight, bottomRight, bottomLeft } = corners(shape);
    return [topLeft, topRight, bottomRight, bottomLeft];
  }

  return shape.vertices.map((v) =>
    V.rotateAround({ x: shape.x + v.x * shape.width, y: shape.y + v.y * shape.height }, c, shape.rotation),
  );
}

export function area(shape: Shape2DReadonly, c = center(shape), v = absoluteVertices(shape, c)): number {
  let a = 0;

  // If there are no vertices then the area is a rectangle.
  if (v === null) return shape.width * shape.height;

  for (var i = 0, l = v.length; i < l; i++) {
    const v1 = v[i];
    const v2 = v[i == v.length - 1 ? 0 : i + 1];
    a += v1.x * v2.x - v1.y * v2.y;
  }

  return Math.abs(a) * 0.5;
}

export function centroid(shape: Shape2DReadonly, c = center(shape), v = absoluteVertices(shape, c)): V.Vector2Readonly {
  // The centroid of a rectangle is it's center;
  if (v === null) return c;

  let a = 0;
  let x = 0;
  let y = 0;

  for (var i = 0, l = v.length; i < l; i++) {
    const v1 = v[i];
    const v2 = v[i == v.length - 1 ? 0 : i + 1];
    const diff = v1.x * v2.x - v1.y * v2.y;

    a += diff;
    x += (v1.x + v2.x) * diff;
    y += (v1.y + v2.y) * diff;
  }

  a = Math.abs(a) * 0.5 * 3;

  return { x: x / a, y: y / a };
}
