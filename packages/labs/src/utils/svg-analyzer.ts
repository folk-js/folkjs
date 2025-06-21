/**
 * Optical effects utilities for accounting for visual perception in UI layouts
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

/**
 * Extract polygon points from SVG element or string
 */
function extractPolygonPoints(svgInput: string | SVGElement): string {
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
 * Calculate geometric centroid of polygon path using line segments
 * This is a helper function - use optical.center() for UI alignment
 */
function calculatePathCentroid(pointsString: string, options: { closed?: boolean } = {}): Point | null {
  const { closed = true } = options;
  const pairs = pointsString.split(' ');

  if (pairs.length < 2) {
    return null;
  }

  const vertices = pairs.map((pair) => {
    const [x, y] = pair.split(',').map(Number);
    return { x, y };
  });

  let totalLength = 0;
  let weightedX = 0;
  let weightedY = 0;

  const segmentCount = closed ? vertices.length : vertices.length - 1;

  for (let i = 0; i < segmentCount; i++) {
    const currentVertex = vertices[i];
    const nextVertex = vertices[(i + 1) % vertices.length];

    const dx = nextVertex.x - currentVertex.x;
    const dy = nextVertex.y - currentVertex.y;
    const segmentLength = Math.sqrt(dx * dx + dy * dy);

    if (segmentLength < 1e-10) {
      continue;
    }

    const segmentCentroidX = (currentVertex.x + nextVertex.x) / 2;
    const segmentCentroidY = (currentVertex.y + nextVertex.y) / 2;

    totalLength += segmentLength;
    weightedX += segmentCentroidX * segmentLength;
    weightedY += segmentCentroidY * segmentLength;
  }

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
function calculateBoundingBox(pointsString: string): BoundingBox {
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
 * Calculate optical center for UI alignment
 * Currently uses path centroid but will be enhanced with perceptual adjustments
 */
export function center(svgInput: string | SVGElement): Point | null {
  const points = extractPolygonPoints(svgInput);
  // TODO: Add perceptual adjustments for different shape types
  return calculatePathCentroid(points);
}

/**
 * Calculate optical size for consistent visual weight
 * Currently uses bounding box area but will account for shape complexity
 */
export function size(svgInput: string | SVGElement): number {
  const points = extractPolygonPoints(svgInput);
  const bbox = calculateBoundingBox(points);
  // TODO: Account for shape complexity, density, and visual mass
  return bbox.width * bbox.height;
}

/**
 * Calculate optical weight for visual hierarchy
 * Accounts for area, density, and shape complexity
 */
export function weight(svgInput: string | SVGElement): number {
  const points = extractPolygonPoints(svgInput);
  const bbox = calculateBoundingBox(points);
  const pairs = points.split(' ');

  // Basic weight calculation: area + complexity factor
  const area = bbox.width * bbox.height;
  const complexity = pairs.length / 12; // Normalized by max sides in UI

  // TODO: Add perceptual weight adjustments for different colors, strokes
  return area * (1 + complexity * 0.3);
}

/**
 * Get bounding box information for an SVG
 */
export function boundingBox(svgInput: string | SVGElement): BoundingBox {
  const points = extractPolygonPoints(svgInput);
  return calculateBoundingBox(points);
}

/**
 * Get bounding box center for an SVG
 */
export function boundingBoxCenter(svgInput: string | SVGElement): Point {
  const bbox = boundingBox(svgInput);
  return {
    x: (bbox.minX + bbox.maxX) / 2,
    y: (bbox.minY + bbox.maxY) / 2,
  };
}
