/**
 * SVG Analysis utilities for extracting geometric information
 */

export interface Point {
  x: number;
  y: number;
}

export interface BoundingBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  width: number;
  height: number;
}

export interface PolygonAnalysis {
  pathCentroid: Point | null; // Path-based centroid (works with self-intersections)
  boundingBox: BoundingBox;
  boundingBoxCenter: Point;
  points: string;
}

/**
 * Extract polygon points from SVG element or string
 */
export function extractPolygonPoints(svgInput: string | SVGElement): string {
  let polygonElement: Element | null;

  if (typeof svgInput === 'string') {
    const parser = new DOMParser();
    const doc = parser.parseFromString(svgInput, 'image/svg+xml');
    polygonElement = doc.querySelector('polygon');
  } else {
    polygonElement = svgInput.querySelector('polygon');
  }

  if (!polygonElement) {
    throw new Error('No polygon element found in SVG');
  }

  const points = polygonElement.getAttribute('points');
  if (!points) {
    throw new Error('Polygon element has no points attribute');
  }

  return points;
}

/**
 * Calculate center of gravity (centroid) of polygon path/stroke using line segments
 * This works for self-intersecting polygons, open paths, and complex shapes
 */
export function calculateCentroid(pointsString: string, options: { closed?: boolean } = {}): Point | null {
  const { closed = true } = options;
  const pairs = pointsString.split(' ');

  if (pairs.length < 2) {
    return null; // Need at least 2 points to form a path
  }

  const vertices = pairs.map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });

  let totalLength = 0;
  let weightedX = 0;
  let weightedY = 0;

  // Calculate centroid based on line segments (the actual path)
  const segmentCount = closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const currentVertex = vertices[i];
    const nextVertex = vertices[(i + 1) % vertices.length];

    // Calculate length of this segment
    const dx = nextVertex.x - currentVertex.x;
    const dy = nextVertex.y - currentVertex.y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);

    // Skip zero-length segments
    if (segmentLength < 1e-10) {
      continue;
    }

    // Calculate centroid of this segment (midpoint)
    const segmentCentroidX = (currentVertex.x + nextVertex.x) / 2;
    const segmentCentroidY = (currentVertex.y + nextVertex.y) / 2;

    // Weight by segment length
    totalLength += segmentLength;
    weightedX += segmentCentroidX * segmentLength;
    weightedY += segmentCentroidY * segmentLength;
  }

  // Handle the case where total length is 0 (all segments are degenerate)
  if (totalLength < 1e-10) {
    return null;
  }

  return {
    x: weightedX / totalLength,
    y: weightedY / totalLength,
  };
}

/**
 * Calculate bounding box of polygon points
 */
export function calculateBoundingBox(pointsString: string): BoundingBox {
  const pairs = pointsString.split(' ');
  let minX = Infinity,
    maxX = -Infinity,
    minY = Infinity,
    maxY = -Infinity;

  pairs.forEach((pair) => {
    const [x, y] = pair.split(',').map(Number);
    minX = Math.min(minX, x);
    maxX = Math.max(maxX, x);
    minY = Math.min(minY, y);
    maxY = Math.max(maxY, y);
  });

  return { minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY };
}

/**
 * Analyze an SVG polygon and return comprehensive geometric information
 */
export function analyzePolygon(svgInput: string | SVGElement): PolygonAnalysis {
  const points = extractPolygonPoints(svgInput);
  const pathCentroid = calculateCentroid(points);
  const boundingBox = calculateBoundingBox(points);
  const boundingBoxCenter = {
    x: (boundingBox.minX + boundingBox.maxX) / 2,
    y: (boundingBox.minY + boundingBox.maxY) / 2,
  };

  return {
    pathCentroid,
    boundingBox,
    boundingBoxCenter,
    points,
  };
}
