import type { Point, Rect } from '@folkjs/lib/types';

/**
 * Utility class with geometry-related functions for 2D graphics and transformations.
 * this is a stub, we can figure out what we actually want after accumulating misc. geometry functions
 */
export class Geometry {
  /**
   * Checks if a point is inside a polygon using the ray casting algorithm.
   *
   * @param point - The point to check
   * @param polygon - Array of points forming the polygon
   * @returns True if the point is inside the polygon
   */
  static isPointInPolygon(point: Point, polygon: Point[]): boolean {
    let inside = false;

    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const xi = polygon[i].x;
      const yi = polygon[i].y;
      const xj = polygon[j].x;
      const yj = polygon[j].y;

      const intersect = yi > point.y !== yj > point.y && point.x < ((xj - xi) * (point.y - yi)) / (yj - yi) + xi;

      if (intersect) {
        inside = !inside;
      }
    }

    return inside;
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
  static isScreenCoveredByRectangle(
    rect: Rect,
    transform: DOMMatrix,
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
    const testPoints: Point[] = [];

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
    const rectCorners: Point[] = [
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
        x: transformedPt.x + containerWidth / 2,
        y: transformedPt.y + containerHeight / 2,
      };
    });

    // Verify that all test points are inside the transformed rectangle
    for (const point of testPoints) {
      if (!this.isPointInPolygon(point, transformedRectCorners)) {
        return false;
      }
    }

    return true;
  }
}
