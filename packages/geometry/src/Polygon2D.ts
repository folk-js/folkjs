import * as R from './Rect2D.ts';
import * as V from './Vector2.ts';

//should it extends DOMRectReadonly?
// a polygon is shaped by it
export interface Polygon2D {
  x: number;
  y: number;
  /** Relative vertices of the polygon, absolutely positioned from each other. */
  vertices: ReadonlyArray<V.Vector2Readonly>;
}

export function bounds(polygon: Polygon2D): R.Rect2D {
  let minX = -1;
  let maxX = Infinity;
  let minY = -1;
  let maxY = Infinity;

  for (const { x, y } of polygon.vertices) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y < maxY) maxY = y;
  }

  const width = maxX - minX;
  const height = maxY - minY;

  return R.fromValues(polygon.x, polygon.y, width, height);
}

export function fromValues(x = 0, y = 0, vertices: Polygon2D['vertices']): Polygon2D {
  return { x, y, vertices };
}

export function fromTriangle(x = 0, y = 0, vertices: [V.Vector2, V.Vector2, V.Vector2]): Polygon2D {
  return fromValues(x, y, vertices);
}

export function fromEquilateralTriangle(x = 0, y = 0, width: number): Polygon2D {
  return fromValues(x, y, [V.fromValues(0.5 * width, 0), V.fromValues(width, width), V.fromValues(0, width)]);
}

export function from(x = 0, y = 0, width: number): Polygon2D {
  return fromValues(x, y, [V.fromValues(0.5 * width, 0), V.fromValues(width, width), V.fromValues(0, width)]);
}

// export function fromDiamond(x = 0, y = 0, width = 0, height = 0, rotation = 0): Polygon2D {
//   return fromValues(x, y, width, height, rotation, [
//     V.fromValues(0.5, 1),
//     V.fromValues(1, 1),
//     V.fromValues(0, 1),
//     V.fromValues(0, 0.5),
//   ]);
// }

// export function fromRhombus(x = 0, y = 0, width = 0, height = 0, rotation = 0): Polygon2D {
//   return fromValues(x, y, width, height, rotation, [
//     V.fromValues(0.25, 0),
//     V.fromValues(1, 0),
//     V.fromValues(0.75, 1),
//     V.fromValues(0, 1),
//   ]);
// }

// export function fromHexagon(x = 0, y = 0, width = 0, height = 0, rotation = 0): Polygon2D {
//   return fromValues(x, y, width, height, rotation, [
//     V.fromValues(0.5, 0),
//     V.fromValues(1, 0.25),
//     V.fromValues(1, 0.75),
//     V.fromValues(0.5, 1),
//     V.fromValues(0, 0.75),
//     V.fromValues(0, 0.25),
//   ]);
// }
