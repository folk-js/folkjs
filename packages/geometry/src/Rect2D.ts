import type { Matrix2D } from './Matrix2D.ts';
import { isNumber, isObject, sign } from './utilities.ts';
import type { Vector2 } from './Vector2.ts';
import * as V from './Vector2.ts';

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type ReadonlyRect2D = Readonly<Rect2D>;

export function fromValues(x = 0, y = 0, width = 0, height = 0): Rect2D {
  return { x, y, width, height };
}

export function isRect2D(rect: unknown): rect is Rect2D {
  return isObject(rect) && isNumber(rect.x) && isNumber(rect.y) && isNumber(rect.width) && isNumber(rect.height);
}

export function clone({ x, y, width, height }: ReadonlyRect2D): Rect2D {
  return { x, y, width, height };
}

export function center(rect: ReadonlyRect2D) {
  return {
    x: rect.x + rect.width * 0.5,
    y: rect.y + rect.height * 0.5,
  };
}

export function area(rect: ReadonlyRect2D): number {
  return rect.width * rect.height;
}

export type Hit = Readonly<{
  /** The point of contact between the two objects. */
  pos: Vector2;
  /** The a vector representing the overlap between the two objects. */
  delta: Vector2;
  /** The surface normal at the point of contact. */
  normal: Vector2;
}>;

export function fromHit(pos = V.zero(), delta = V.zero(), normal = V.zero()) {
  return { pos, delta, normal };
}

export function hitDetection(rect1: ReadonlyRect2D, rect2: ReadonlyRect2D): Hit | null {
  const center1 = center(rect1);
  const center2 = center(rect2);

  const dx = center2.x - center1.x;
  const px = (rect1.width + rect2.width) / 2 - Math.abs(dx);
  if (px <= 0) return null;

  const dy = center2.y - center1.y;
  const py = (rect1.height + rect2.height) / 2 - Math.abs(dy);
  if (py <= 0) return null;

  const hit = fromHit();
  if (px < py) {
    const sx = sign(dx);
    hit.delta.x = px * sx;
    hit.normal.x = sx;
    hit.pos.x = center1.x + (rect1.width / 2) * sx;
    hit.pos.y = center2.y;
  } else {
    const sy = sign(dy);
    hit.delta.y = py * sy;
    hit.normal.y = sy;
    hit.pos.x = center2.x;
    hit.pos.y = center1.y + (rect1.height / 2) * sy;
  }
  return hit;
}

export function intersects(rect1: ReadonlyRect2D, rect2: ReadonlyRect2D): boolean {
  return (
    rect1.x <= rect2.x + rect2.width &&
    rect1.x + rect1.width >= rect2.x &&
    rect1.y <= rect2.y + rect2.height &&
    rect1.y + rect1.height >= rect2.y
  );
}

export function intersection(rect1: ReadonlyRect2D, rect2: ReadonlyRect2D) {
  const x = Math.max(rect1.x, rect2.x);
  const y = Math.max(rect1.y, rect2.y);
  const width = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);
  const height = Math.min(rect1.x + rect1.width, rect2.x + rect2.width);

  return fromValues(x, y, width, height);
}

export function proximal(rect1: ReadonlyRect2D, rect2: ReadonlyRect2D, proximity: number): boolean {
  return (
    rect1.x - (rect2.x + rect2.width) < proximity &&
    rect2.x - (rect1.x + rect1.width) < proximity &&
    rect1.y - (rect2.y + rect2.height) < proximity &&
    rect2.y - (rect1.x + rect1.width) < proximity
  );
}

export function translateSelf(rect: Rect2D, vector: Vector2): void {
  rect.x += vector.x;
  rect.y += vector.y;
}

export function expand(rect: ReadonlyRect2D, padding: number): Rect2D {
  return fromValues(rect.x - padding, rect.y - padding, rect.width + padding * 2, rect.height + padding * 2);
}

export function bounds(...rects: ReadonlyRect2D[]): Rect2D {
  let left = Infinity;
  let top = Infinity;
  let right = -Infinity;
  let bottom = -Infinity;

  for (const rect of rects) {
    if (rect.x < left) left = rect.x;
    if (rect.y < top) top = rect.y;

    const r = rect.x + rect.width;
    if (r > right) right = r;

    const b = rect.y + rect.height;
    if (b > bottom) bottom = b;
  }

  return fromValues(left, top, right - left, bottom - top);
}

export function isPointInsideRect(rect: ReadonlyRect2D, point: Vector2): boolean {
  return rect.x <= point.x && point.x <= rect.x + rect.width && rect.y <= point.y && point.y <= rect.y + rect.height;
}

/**
 * Given a point, find the nearest point on the perimeter of the rectangle.
 * @param point
 * @param rect
 * @returns
 */
export function nearestPointOnRect(rect: ReadonlyRect2D, point: Vector2): Vector2 {
  const c = center(rect);
  let qx = point.x - c.x;
  let qy = point.y - c.y;
  const halfWidth = rect.width * 0.5;
  const halfHeight = rect.height * 0.5;

  if (qx > halfWidth) qx = halfWidth;
  else if (qx < -halfWidth) qx = -halfWidth;

  if (qy > halfHeight) qy = halfHeight;
  else if (qy < -halfHeight) qy = -halfHeight;

  return { x: qx + c.x, y: qy + c.y };
}

/**
 * Checks if a rectangle completely covers a screen/container area, even when transformed.
 *
 * @param rect - The rectangle in its own coordinate system
 * @param transform - The transformation matrix to apply to the rectangle (DOMMatrix)
 * @param containerWidth - The width of the container/screen
 * @param containerHeight - The height of the container/screen
 * @param sampleDensity - Optional parameter to control the number of test points (default: 5)
 * @returns True if the rectangle completely covers the screen
 */
export function isScreenCoveredByRectangle(
  rect: ReadonlyRect2D,
  transform: Matrix2D,
  containerWidth: number,
  containerHeight: number,
  sampleDensity: number = 5,
): boolean {
  // Calculate a reasonable number of points to check based on container size
  // and the provided sample density
  const numPointsToCheck = Math.max(
    sampleDensity,
    Math.min(sampleDensity * 4, Math.floor(Math.max(containerWidth, containerHeight) / 50)),
  );

  // Create test points along the screen edges and interior
  const testPoints: Vector2[] = [];

  // Add the four corners of the screen
  testPoints.push({ x: 0, y: 0 }); // Top-left
  testPoints.push({ x: containerWidth, y: 0 }); // Top-right
  testPoints.push({ x: containerWidth, y: containerHeight }); // Bottom-right
  testPoints.push({ x: 0, y: containerHeight }); // Bottom-left

  // Add points along the edges of the screen
  for (let i = 1; i < numPointsToCheck - 1; i++) {
    const t = i / (numPointsToCheck - 1);
    // Top edge
    testPoints.push({ x: t * containerWidth, y: 0 });
    // Right edge
    testPoints.push({ x: containerWidth, y: t * containerHeight });
    // Bottom edge
    testPoints.push({ x: (1 - t) * containerWidth, y: containerHeight });
    // Left edge
    testPoints.push({ x: 0, y: (1 - t) * containerHeight });
  }

  // Add some interior points for more accurate testing
  for (let i = 1; i < numPointsToCheck - 1; i++) {
    for (let j = 1; j < numPointsToCheck - 1; j++) {
      const x = (i / (numPointsToCheck - 1)) * containerWidth;
      const y = (j / (numPointsToCheck - 1)) * containerHeight;
      testPoints.push({ x, y });
    }
  }

  // Calculate the corners of the rectangle in its local coordinate system
  const rectCorners: Vector2[] = [
    { x: rect.x, y: rect.y }, // Top-left
    { x: rect.x + rect.width, y: rect.y }, // Top-right
    { x: rect.x + rect.width, y: rect.y + rect.height }, // Bottom-right
    { x: rect.x, y: rect.y + rect.height }, // Bottom-left
  ];

  // Transform the rectangle corners to screen space
  const transformedRectCorners = rectCorners.map((corner) => {
    const pt = new DOMPoint(corner.x, corner.y);
    const transformedPt = pt.matrixTransform(transform);
    return {
      x: transformedPt.x + containerWidth * 0.5,
      y: transformedPt.y + containerHeight * 0.5,
    };
  });

  // Verify that all test points are inside the transformed rectangle
  for (const point of testPoints) {
    if (!isPointInPolygon(point, transformedRectCorners)) {
      return false;
    }
  }

  return true;
}

/**
 * Checks if a point is inside a polygon using the ray casting algorithm.
 *
 * @param point - The point to check
 * @param polygon - Array of points forming the polygon
 * @returns True if the point is inside the polygon
 */
export function isPointInPolygon(point: Vector2, polygon: Vector2[]): boolean {
  let inside = false;

  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const xi = polygon[i]!.x;
    const yi = polygon[i]!.y;
    const xj = polygon[j]!.x;
    const yj = polygon[j]!.y;

    const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

    if (intersect) {
      inside = !inside;
    }
  }

  return inside;
}
