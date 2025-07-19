import { verticesToPolygon } from '@folkjs/canvas';
import { type PropertyValues, css } from '@folkjs/dom/ReactiveElement';
import type { Point } from '@folkjs/geometry/Vector2';
import { FolkBaseSet } from './folk-base-set';

declare global {
  interface HTMLElementTagNameMap {
    'folk-hull': FolkHull;
  }
}

export class FolkHull extends FolkBaseSet {
  static override tagName = 'folk-hull';

  static override styles = [
    FolkBaseSet.styles,
    css`
      #hull {
        position: absolute;
        top: 0;
        left: 0;
        background-color: var(--folk-hull-bg, #b4d8f644);
        height: 100%;
        width: 100%;
        pointer-events: none;
      }
    `,
  ];

  #hull: Point[] = [];

  get hull(): ReadonlyArray<Point> {
    return this.#hull;
  }

  #hullEl = document.createElement('div');

  override createRenderRoot() {
    const root = super.createRenderRoot();

    this.#hullEl.id = 'hull';

    root.prepend(this.#hullEl);

    return root;
  }

  override update(changedProperties: PropertyValues<this>) {
    super.update(changedProperties);

    if (this.sourcesMap.size !== this.sourceElements.size) {
      this.style.clipPath = '';
      this.style.display = 'none';
      return;
    }

    this.style.display = '';

    this.#hull = makeHull(this.sourceRects);
    this.#hullEl.style.clipPath = verticesToPolygon(this.#hull);
  }
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
