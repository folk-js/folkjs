import { FolkBaseHyperedge } from '@folkjs/labs/folk-base-hyperedge';
import type { Point } from '@folkjs/lib';
import { Gizmos, Vector } from '@folkjs/lib';
import { verticesToPolygon } from '@folkjs/lib/utils';
import { css, type PropertyValues } from '@lit/reactive-element';

declare global {
  interface HTMLElementTagNameMap {
    'folk-hyperedge': FolkHyperedge;
  }
}

export class FolkHyperedge extends FolkBaseHyperedge {
  static override tagName = 'folk-hyperedge';

  static override styles = [
    FolkBaseHyperedge.styles,
    css`
      #hullA,
      #hullB {
        position: absolute;
        top: 0;
        left: 0;
        height: 100%;
        width: 100%;
      }
      #hullA {
        background-color: var(--folk-hull-bg, rgba(0, 110, 255, 0.2));
      }
      #hullB {
        background-color: var(--folk-hull-bg, rgba(0, 255, 110, 0.2));
      }
    `,
  ];

  #hullA: Point[] = [];
  #hullB: Point[] = [];

  get hullA(): ReadonlyArray<Point> {
    return this.#hullA;
  }

  get hullB(): ReadonlyArray<Point> {
    return this.#hullB;
  }

  #hullAEl = document.createElement('div');
  #hullBEl = document.createElement('div');
  #connectionEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  #pathEl = document.createElementNS('http://www.w3.org/2000/svg', 'path');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#hullAEl.id = 'hullA';
    this.#hullBEl.id = 'hullB';

    this.#connectionEl.style.position = 'absolute';
    this.#connectionEl.style.top = '0';
    this.#connectionEl.style.left = '0';
    this.#connectionEl.style.width = '100%';
    this.#connectionEl.style.height = '100%';
    this.#connectionEl.style.pointerEvents = 'none';

    this.#pathEl.setAttribute('fill', 'rgba(128, 0, 128, 0.3)');
    this.#pathEl.setAttribute('stroke', 'purple');
    this.#pathEl.setAttribute('stroke-width', '1');

    this.#connectionEl.appendChild(this.#pathEl);
    root.append(this.#hullAEl, this.#hullBEl, this.#connectionEl);

    return root;
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (this.sourcesMap.size !== this.sourceElements.size || this.targetsMap.size !== this.targetElements.size) {
      this.style.clipPath = '';
      this.style.display = 'none';
      return;
    }

    this.style.display = '';

    this.#hullA = makeHull(this.sourceRects);
    this.#hullB = makeHull(this.targetRects);

    const centroidA = calculateCentroid(this.#hullA);
    const centroidB = calculateCentroid(this.#hullB);

    // Find intersection points with hulls
    const intersectionA = findHullIntersection(this.#hullA, centroidA, centroidB);
    const intersectionB = findHullIntersection(this.#hullB, centroidA, centroidB);

    if (!intersectionA || !intersectionB) {
      this.style.clipPath = '';
      return;
    }

    const midpoint = Vector.center([intersectionA, intersectionB]);

    // Calculate centers and midpoint
    const centerA = calculateCentroid(this.#hullA);
    const centerB = calculateCentroid(this.#hullB);
    const connectionVector = Vector.sub(centerB, centerA);
    const midpointOfCentroids = Vector.center([centerA, centerB]);

    // Find and draw furthest visible points
    let [pointA1, pointA2] = findFurthestVisiblePoints(this.#hullA, midpoint, connectionVector);
    let [pointB1, pointB2] = findFurthestVisiblePoints(this.#hullB, midpoint, connectionVector);

    if (!pointA1 || !pointA2 || !pointB1 || !pointB2) {
      this.style.clipPath = '';
      return;
    }

    // Determine correct ordering for hull A
    const toA1 = Vector.sub(pointA1, midpointOfCentroids);
    const toA2 = Vector.sub(pointA2, midpointOfCentroids);
    const toCenterA = Vector.sub(centerA, midpointOfCentroids);
    const angleA1 = Math.atan2(toA1.y, toA1.x);
    const angleA2 = Math.atan2(toA2.y, toA2.x);
    const zeroAngleA = Math.atan2(toCenterA.y, toCenterA.x);
    const relativeA1 = ((angleA1 - zeroAngleA + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const relativeA2 = ((angleA2 - zeroAngleA + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const [leftA, rightA] = relativeA1 > 0 ? [pointA1, pointA2] : [pointA2, pointA1];

    // Determine correct ordering for hull B
    const toB1 = Vector.sub(pointB1, midpointOfCentroids);
    const toB2 = Vector.sub(pointB2, midpointOfCentroids);
    const toCenterB = Vector.sub(centerB, midpointOfCentroids);
    const angleB1 = Math.atan2(toB1.y, toB1.x);
    const angleB2 = Math.atan2(toB2.y, toB2.x);
    const zeroAngleB = Math.atan2(toCenterB.y, toCenterB.x);
    const relativeB1 = ((angleB1 - zeroAngleB + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const relativeB2 = ((angleB2 - zeroAngleB + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
    const [leftB, rightB] = relativeB1 > 0 ? [pointB1, pointB2] : [pointB2, pointB1];

    // Get hull points between furthest points, passing the other hull's center
    const hullAPoints = getHullPointsBetween(this.#hullA, leftA, rightA, centerB);
    const hullBPoints = getHullPointsBetween(this.#hullB, leftB, rightB, centerA);

    // Construct the path data
    const pathData = `
      M ${leftA.x} ${leftA.y}
      ${hullAPoints.map((p) => `L ${p.x} ${p.y}`).join(' ')}
      L ${rightA.x} ${rightA.y}
      Q ${midpoint.x} ${midpoint.y},
        ${leftB.x} ${leftB.y}
      ${hullBPoints
        .reverse()
        .map((p) => `L ${p.x} ${p.y}`)
        .join(' ')}
      L ${rightB.x} ${rightB.y}
      Q ${midpoint.x} ${midpoint.y},
        ${leftA.x} ${leftA.y}
      Z
    `
      .replace(/\s+/g, ' ')
      .trim();

    // Update the path element
    this.#pathEl.setAttribute('d', pathData);

    // ----- GIZMOS  DEBUGGING -----
    Gizmos.clear();

    // Draw centroids and connection
    Gizmos.point(centerA, { color: 'blue' });
    Gizmos.point(centerB, { color: 'green' });
    Gizmos.line(centerA, centerB, { color: 'red' });
    Gizmos.point(midpoint, { color: 'black' });

    // Draw selected path points
    hullAPoints.forEach((p) => Gizmos.point(p, { color: 'yellow' }));
    hullBPoints.forEach((p) => Gizmos.point(p, { color: 'yellow' }));

    // Draw selected far points
    if (leftA) Gizmos.text('LA', leftA, { color: 'purple' });
    if (rightA) Gizmos.text('RA', rightA, { color: 'purple' });
    if (leftB) Gizmos.text('LB', leftB, { color: 'purple' });
    if (rightB) Gizmos.text('RB', rightB, { color: 'purple' });

    this.#hullAEl.style.clipPath = verticesToPolygon(this.#hullA);
    this.#hullBEl.style.clipPath = verticesToPolygon(this.#hullB);
  }
}

function calculateCentroid(points: Point[]): Point {
  if (points.length === 0) return { x: 0, y: 0 };

  const sum = points.reduce(
    (acc, point) => ({
      x: acc.x + point.x,
      y: acc.y + point.y,
    }),
    { x: 0, y: 0 },
  );

  return {
    x: sum.x / points.length,
    y: sum.y / points.length,
  };
}

/* This code has been modified from the original source, see the original source below. */
/*
 * Convex hull algorithm - Library (TypeScript)
 *
 * Copyright (c) 2021 Project Nayuki
 * https://www.nayuki.io/page/convex-hull-algorithm
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with this program (see COPYING.txt and COPYING.LESSER.txt).
 * If not, see <http://www.gnu.org/licenses/>.
 */

function comparePoints(a: Point, b: Point): number {
  if (a.x < b.x) return -1;
  if (a.x > b.x) return 1;
  if (a.y < b.y) return -1;
  if (a.y > b.y) return 1;
  return 0;
}

export function makeHull(rects: DOMRectReadOnly[]): Point[] {
  const points: Point[] = rects
    .flatMap((rect) => [
      { x: rect.left, y: rect.top },
      { x: rect.right, y: rect.top },
      { x: rect.left, y: rect.bottom },
      { x: rect.right, y: rect.bottom },
    ])
    .sort(comparePoints);

  if (points.length <= 1) return points;

  // Andrew's monotone chain algorithm. Positive y coordinates correspond to "up"
  // as per the mathematical convention, instead of "down" as per the computer
  // graphics convention. This doesn't affect the correctness of the result.

  const upperHull: Array<Point> = [];
  for (let i = 0; i < points.length; i++) {
    const p: Point = points[i];
    while (upperHull.length >= 2) {
      const q: Point = upperHull[upperHull.length - 1];
      const r: Point = upperHull[upperHull.length - 2];
      if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x)) upperHull.pop();
      else break;
    }
    upperHull.push(p);
  }
  upperHull.pop();

  const lowerHull: Array<Point> = [];
  for (let i = points.length - 1; i >= 0; i--) {
    const p: Point = points[i];
    while (lowerHull.length >= 2) {
      const q: Point = lowerHull[lowerHull.length - 1];
      const r: Point = lowerHull[lowerHull.length - 2];
      if ((q.x - r.x) * (p.y - r.y) >= (q.y - r.y) * (p.x - r.x)) lowerHull.pop();
      else break;
    }
    lowerHull.push(p);
  }
  lowerHull.pop();

  if (
    upperHull.length === 1 &&
    lowerHull.length === 1 &&
    upperHull[0].x === lowerHull[0].x &&
    upperHull[0].y === lowerHull[0].y
  )
    return upperHull;

  return upperHull.concat(lowerHull);
}

function findHullIntersection(hull: Point[], lineStart: Point, lineEnd: Point): Point | null {
  // Check each edge of the hull
  for (let i = 0; i < hull.length; i++) {
    const j = (i + 1) % hull.length;
    const intersection = lineIntersection(lineStart, lineEnd, hull[i], hull[j]);
    if (intersection) {
      return intersection;
    }
  }

  return null;
}

function lineIntersection(p1: Point, p2: Point, p3: Point, p4: Point): Point | null {
  const denominator = (p4.y - p3.y) * (p2.x - p1.x) - (p4.x - p3.x) * (p2.y - p1.y);

  if (denominator === 0) {
    return null; // Lines are parallel
  }

  const ua = ((p4.x - p3.x) * (p1.y - p3.y) - (p4.y - p3.y) * (p1.x - p3.x)) / denominator;
  const ub = ((p2.x - p1.x) * (p1.y - p3.y) - (p2.y - p1.y) * (p1.x - p3.x)) / denominator;

  // Check if intersection occurs within both line segments
  if (ua >= 0 && ua <= 1 && ub >= 0 && ub <= 1) {
    return {
      x: p1.x + ua * (p2.x - p1.x),
      y: p1.y + ua * (p2.y - p1.y),
    };
  }

  return null;
}

function findFurthestVisiblePoints(hull: Point[], from: Point, connectionVector: Point): [Point | null, Point | null] {
  if (hull.length === 0) return [null, null];

  // Find all visible points first
  const visiblePoints = hull.filter((point) => {
    // Check if point is visible (no intersections with hull edges)
    for (let i = 0; i < hull.length; i++) {
      const j = (i + 1) % hull.length;
      // Skip the edges that contain the point we're checking
      if (point === hull[i] || point === hull[j]) continue;

      // Check if the line from 'from' to point intersects with this edge
      const intersection = lineIntersection(from, point, hull[i], hull[j]);
      if (intersection) return false;
    }
    return true;
  });

  if (visiblePoints.length === 0) return [null, null];
  if (visiblePoints.length === 1) return [visiblePoints[0], visiblePoints[0]];

  // Use the normal vector to determine left/right
  const normal = { x: -connectionVector.y, y: connectionVector.x };

  // Separate points into left and right based on their dot product with the normal
  const leftPoints: Point[] = [];
  const rightPoints: Point[] = [];

  visiblePoints.forEach((point) => {
    const toPoint = Vector.sub(point, from);
    const dot = Vector.dot(toPoint, normal);
    if (dot > 0) {
      leftPoints.push(point);
    } else {
      rightPoints.push(point);
    }
  });

  // Find the furthest point on each side
  const getMaxPoint = (points: Point[]) => {
    if (points.length === 0) return null;
    return points.reduce((max, point) => (Vector.distance(point, from) > Vector.distance(max, from) ? point : max));
  };

  return [getMaxPoint(leftPoints), getMaxPoint(rightPoints)];
}

function getHullPointsBetween(hull: Point[], start: Point, end: Point, otherHullCenter: Point): Point[] {
  const startIndex = hull.findIndex((p) => p === start);
  const endIndex = hull.findIndex((p) => p === end);

  if (startIndex === -1 || endIndex === -1) return [];

  // If points are adjacent in the hull (including wrap-around), return empty array
  if (Math.abs(startIndex - endIndex) === 1 || Math.abs(startIndex - endIndex) === hull.length - 1) {
    return [];
  }

  // Get both possible paths
  const clockwise: Point[] = [];
  const counterclockwise: Point[] = [];

  // Collect clockwise points
  let idx = startIndex;
  while (idx !== endIndex) {
    idx = (idx + 1) % hull.length;
    if (idx === endIndex) break;
    clockwise.push(hull[idx]);
  }

  // Collect counterclockwise points
  idx = startIndex;
  while (idx !== endIndex) {
    idx = (idx - 1 + hull.length) % hull.length;
    if (idx === endIndex) break;
    counterclockwise.push(hull[idx]);
  }

  // Calculate which path is on the same side as the other hull's center
  const connectionVector = Vector.sub(end, start);
  const normal = Vector.normal(connectionVector);

  // Use the first point of each path to determine which side it's on
  const clockwisePoint = clockwise[0] || start;
  const targetPoint = otherHullCenter;

  // Project points onto the normal to determine which side they're on
  const clockwiseSide = Vector.dot(Vector.sub(clockwisePoint, start), normal);
  const targetSide = Vector.dot(Vector.sub(targetPoint, start), normal);

  // Get the points on the correct side and sort them by projection onto the line between far points
  const points = Math.sign(clockwiseSide) === Math.sign(targetSide) ? clockwise : counterclockwise;
  const farPointVector = Vector.sub(end, start);
  return points.sort((a, b) => {
    const projA = Vector.dot(Vector.sub(a, start), farPointVector);
    const projB = Vector.dot(Vector.sub(b, start), farPointVector);
    return projB - projA;
  });
}
