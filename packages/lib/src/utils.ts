// Adopted from: https://github.com/pshihn/bezier-points/blob/master/lib/index.ts

import type { Point } from './types';
import { Vector } from './Vector';

export const MAX_Z_INDEX = 2147483647;

// Distance squared from a point p to the line segment vw
function distanceToSegmentSq(p: Point, v: Point, w: Point): number {
  const l2 = Vector.distanceSquared(v, w);
  if (l2 === 0) {
    return Vector.distanceSquared(p, v);
  }
  let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
  t = Math.max(0, Math.min(1, t));
  return Vector.distanceSquared(p, Vector.lerp(v, w, t));
}

export function lerp(a: number, b: number, alpha: number): number {
  return a + (b - a) * alpha;
}

// Adapted from https://seant23.wordpress.com/2010/11/12/offset-bezier-curves/
function flatness(points: readonly Point[], offset: number): number {
  const p1 = points[offset + 0]!;
  const p2 = points[offset + 1]!;
  const p3 = points[offset + 2]!;
  const p4 = points[offset + 3]!;

  let ux = 3 * p2.x - 2 * p1.x - p4.x;
  ux *= ux;
  let uy = 3 * p2.y - 2 * p1.y - p4.y;
  uy *= uy;
  let vx = 3 * p3.x - 2 * p4.x - p1.x;
  vx *= vx;
  let vy = 3 * p3.y - 2 * p4.y - p1.y;
  vy *= vy;

  if (ux < vx) {
    ux = vx;
  }

  if (uy < vy) {
    uy = vy;
  }

  return ux + uy;
}

function getPointsOnBezierCurveWithSplitting(
  points: readonly Point[],
  offset: number,
  tolerance: number,
  newPoints?: Point[],
): Point[] {
  const outPoints = newPoints || [];
  if (flatness(points, offset) < tolerance) {
    const p0 = points[offset + 0]!;
    if (outPoints.length) {
      const d = Vector.distance(outPoints[outPoints.length - 1]!, p0);
      if (d > 1) {
        outPoints.push(p0);
      }
    } else {
      outPoints.push(p0);
    }
    outPoints.push(points[offset + 3]!);
  } else {
    // subdivide
    const t = 0.5;
    const p1 = points[offset + 0]!;
    const p2 = points[offset + 1]!;
    const p3 = points[offset + 2]!;
    const p4 = points[offset + 3]!;

    const q1 = Vector.lerp(p1, p2, t);
    const q2 = Vector.lerp(p2, p3, t);
    const q3 = Vector.lerp(p3, p4, t);
    const r1 = Vector.lerp(q1, q2, t);
    const r2 = Vector.lerp(q2, q3, t);
    const red = Vector.lerp(r1, r2, t);

    getPointsOnBezierCurveWithSplitting([p1, q1, r1, red], 0, tolerance, outPoints);
    getPointsOnBezierCurveWithSplitting([red, r2, q3, p4], 0, tolerance, outPoints);
  }
  return outPoints;
}

export function simplify(points: readonly Point[], distance: number): Point[] {
  return simplifyPoints(points, 0, points.length, distance);
}

// Ramer–Douglas–Peucker algorithm
// https://en.wikipedia.org/wiki/Ramer%E2%80%93Douglas%E2%80%93Peucker_algorithm
export function simplifyPoints(
  points: readonly Point[],
  start: number,
  end: number,
  epsilon: number,
  newPoints?: Point[],
): Point[] {
  const outPoints = newPoints || [];

  // find the most distance point from the endpoints
  const s = points[start]!;
  const e = points[end - 1]!;
  let maxDistSq = 0;
  let maxNdx = 1;
  for (let i = start + 1; i < end - 1; ++i) {
    const distSq = distanceToSegmentSq(points[i]!, s, e);
    if (distSq > maxDistSq) {
      maxDistSq = distSq;
      maxNdx = i;
    }
  }

  // if that point is too far, split
  if (Math.sqrt(maxDistSq) > epsilon) {
    simplifyPoints(points, start, maxNdx + 1, epsilon, outPoints);
    simplifyPoints(points, maxNdx, end, epsilon, outPoints);
  } else {
    if (!outPoints.length) {
      outPoints.push(s);
    }
    outPoints.push(e);
  }

  return outPoints;
}

export function pointsOnBezierCurves(points: readonly Point[], tolerance: number = 0.15, distance?: number): Point[] {
  const newPoints: Point[] = [];
  const numSegments = (points.length - 1) / 3;
  for (let i = 0; i < numSegments; i++) {
    const offset = i * 3;
    getPointsOnBezierCurveWithSplitting(points, offset, tolerance, newPoints);
  }
  if (distance && distance > 0) {
    return simplifyPoints(newPoints, 0, newPoints.length, distance);
  }
  return newPoints;
}

export function getSvgPathFromStroke(stroke: number[][]): string {
  if (stroke.length === 0) return '';

  for (const point of stroke) {
    point[0] = Math.round(point[0]! * 100) / 100;
    point[1] = Math.round(point[1]! * 100) / 100;
  }

  const d = stroke.reduce(
    (acc, [x0, y0], i, arr) => {
      const [x1, y1] = arr[(i + 1) % arr.length]!;
      acc.push(x0!, y0!, (x0! + x1!) / 2, (y0! + y1!) / 2);
      return acc;
    },
    ['M', ...stroke[0]!, 'Q'],
  );

  d.push('Z');
  return d.join(' ');
}

export function verticesToPolygon(vertices: Point[]): string {
  if (vertices.length === 0) return '';

  return `polygon(${vertices.map((vertex) => `${vertex.x}px ${vertex.y}px`).join(', ')})`;
}

const vertexRegex = /(?<x>-?([0-9]*[.])?[0-9]+),\s*(?<y>-?([0-9]*[.])?[0-9]+)/;

export function parseVertex(str: string): Point | null {
  const results = vertexRegex.exec(str);

  if (results === null) return null;

  return {
    x: Number(results.groups?.x),
    y: Number(results.groups?.y),
  };
}
