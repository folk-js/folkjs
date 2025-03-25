import type { Matrix2D } from './Matrix2D.ts';
import { sign } from './utilities.ts';
import type { Vector2 } from './Vector2.ts';
import * as V from './Vector2.ts';

export interface Rect2D {
  x: number;
  y: number;
  width: number;
  height: number;
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

export function center(rect: Rect2D) {
  return {
    x: rect.x + rect.width * 0.5,
    y: rect.y + rect.height * 0.5,
  };
}

export function hitDetection(rect1: DOMRectReadOnly, rect2: DOMRectReadOnly): Hit | null {
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

export function intersecting(rect1: Rect2D, rect2: Rect2D) {
  return (
    rect1.x <= rect2.x + rect2.width &&
    rect1.x + rect1.width >= rect2.x &&
    rect1.y <= rect2.y + rect2.height &&
    rect1.y + rect1.height >= rect2.y
  );
}

export function bounds(rect1: Rect2D, rect2: Rect2D): Rect2D {
  const x = Math.min(rect1.x, rect2.x);
  const y = Math.min(rect1.y, rect2.y);

  return {
    x,
    y,
    width: Math.max(rect1.x + rect1.width, rect2.x + rect2.width) - x,
    height: Math.max(rect1.y + rect1.height, rect2.y + rect2.height) - y,
  };
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
  rect: Rect2D,
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

export function clone({ x, y, width, height }: Rect2D): Rect2D {
  return { x, y, width, height };
}
