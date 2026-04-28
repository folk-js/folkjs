// ============================================================================
// Line predicates and parameterisation
// ============================================================================
//
// Operations defined by a directed edge (a pair of junctions, possibly ideal),
// or a finite segment between two points. No atlas concepts; pure geometry.

import type { Point } from '@folkjs/geometry/Vector2';
import { cross } from './point.ts';
import type { Junction } from './junction.ts';

/**
 * Whether `p` lies on the left of (or on) the directed edge `a → b`.
 * Junctions may be finite or ideal.
 *
 * - finite → finite: standard half-plane test.
 * - finite → ideal: edge is a ray from `a` in direction `(b.x, b.y)`.
 * - ideal → finite: edge "comes from infinity in direction a" toward `b`;
 *   the locally-effective travel direction is `-a`.
 * - ideal → ideal: edge lies at infinity, doesn't constrain finite query
 *   points; returns `true`.
 */
export function leftOfDirectedEdge(a: Junction, b: Junction, p: Point): boolean {
  if (a.kind === 'finite' && b.kind === 'finite') {
    return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) >= 0;
  }
  if (a.kind === 'finite' && b.kind === 'ideal') {
    return cross(b.x, b.y, p.x - a.x, p.y - a.y) >= 0;
  }
  if (a.kind === 'ideal' && b.kind === 'finite') {
    return cross(a.x, a.y, b.x - p.x, b.y - p.y) >= 0;
  }
  return true;
}

/** Strict version of {@link leftOfDirectedEdge}: `> 0` instead of `≥ 0`. */
export function leftOfDirectedEdgeStrict(a: Junction, b: Junction, p: Point): boolean {
  if (a.kind === 'finite' && b.kind === 'finite') {
    return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y) > 0;
  }
  if (a.kind === 'finite' && b.kind === 'ideal') {
    return cross(b.x, b.y, p.x - a.x, p.y - a.y) > 0;
  }
  if (a.kind === 'ideal' && b.kind === 'finite') {
    return cross(a.x, a.y, b.x - p.x, b.y - p.y) > 0;
  }
  return true;
}

/**
 * Parameter `t` such that `p = a + t * (b - a)`, or `null` if `p` is not
 * (sufficiently) collinear with the segment.
 */
export function parameterOnSegment(
  a: Point,
  b: Point,
  p: Point,
  eps = 1e-9,
): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < eps * eps) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  // Collinearity check: perpendicular component must be tiny.
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const perp2 = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
  if (perp2 > eps * eps * Math.max(1, len2)) return null;
  return t;
}
