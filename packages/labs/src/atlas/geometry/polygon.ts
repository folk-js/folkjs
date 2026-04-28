// ============================================================================
// Convex polygon predicates over junctions
// ============================================================================
//
// Operations on convex k-gons whose vertices are junctions (finite or ideal).
// CCW winding is the canonical orientation; `isPolygonCCW` is the validity
// check. Containment is implemented as n half-plane tests via `line.ts`.

import type { Point } from '@folkjs/geometry/Vector2';
import { cross } from './point.ts';
import { sameIdealDirection, type Junction } from './junction.ts';
import { leftOfDirectedEdge, leftOfDirectedEdgeStrict } from './line.ts';

/**
 * Test whether `p` lies inside (or on the boundary of) the CCW convex polygon
 * defined by `verts` (k ≥ 3). Junctions may be finite or ideal.
 *
 * Implementation: n half-plane tests. Correctness assumes the polygon is
 * convex and CCW (both invariants enforced elsewhere — see {@link isPolygonCCW}).
 */
export function polygonContains(verts: ReadonlyArray<Junction>, p: Point): boolean {
  const n = verts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    if (!leftOfDirectedEdge(verts[i], verts[(i + 1) % n], p)) return false;
  }
  return true;
}

/** Strict version: returns `true` only if `p` is strictly interior. */
export function polygonContainsStrict(
  verts: ReadonlyArray<Junction>,
  p: Point,
): boolean {
  const n = verts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    if (!leftOfDirectedEdgeStrict(verts[i], verts[(i + 1) % n], p)) return false;
  }
  return true;
}

/**
 * Whether the convex polygon defined by `verts` (k ≥ 3) is wound CCW. Handles
 * any mix of finite and ideal vertices except an all-ideal cycle (not produced
 * by our operations and not supported).
 *
 * Convexity contract: every consecutive triple `(a, b, c)` must satisfy
 * `c` lies left-of-or-on directed edge `a → b` (no right turns). At least
 * one turn must be strictly positive (so the polygon isn't entirely degenerate).
 *
 * Two structural exceptions are allowed and *don't* contribute to the turn
 * accounting — both arise naturally in our operations and represent valid
 * convex shapes:
 *
 *  1. **Collinear chain vertices**: `b` is finite and lies on the segment
 *     `a → c` (zero-turn intermediate vertex on a long side). Strip
 *     rectangles use these to twin a single long side to a chain of
 *     neighbouring sub-faces.
 *  2. **Same-ideal-direction edges**: `(a, b)` or `(b, c)` are both ideal
 *     in the same direction (a degenerate at-infinity edge with zero
 *     length). Strip rectangles' two short ends terminate this way.
 */
export function isPolygonCCW(verts: ReadonlyArray<Junction>): boolean {
  const n = verts.length;
  if (n < 3) return false;
  if (verts.every((v) => v.kind === 'ideal')) {
    throw new Error('isPolygonCCW: all-ideal polygon not supported');
  }
  const R = 1e12;
  const asFinite = (v: Junction): Point =>
    v.kind === 'finite' ? { x: v.x, y: v.y } : { x: v.x * R, y: v.y * R };

  // The relaxed left-of test admits a tiny negative slack so that
  // "collinear due to floating-point round-off" isn't classified as a
  // right turn. Without this, strip rectangles (whose top/bottom edges
  // are long parallel segments derived from chord vectors and a perp
  // offset) sometimes register a few ULPs of negative cross at their
  // collinear chain vertices. The strict turn count is unaffected — it
  // still requires `> 0`.
  const COLLINEAR_EPS = 1e-9;

  let positiveCount = 0;
  for (let i = 0; i < n; i++) {
    const a = verts[i];
    const b = verts[(i + 1) % n];
    const c = verts[(i + 2) % n];
    if (sameIdealDirection(a, b) || sameIdealDirection(b, c)) continue;
    const cFin = asFinite(c);
    const x = signedTurn(a, b, cFin);
    if (x < -COLLINEAR_EPS) return false;
    if (x > 0) positiveCount++;
  }
  return positiveCount > 0;
}

/**
 * Whether the polygon defined by `verts` is wound CW. Inner loops ("holes")
 * are CW by convention; the outer loop is CCW. This is just `isPolygonCCW`
 * applied to the reversed vertex order.
 */
export function isPolygonCW(verts: ReadonlyArray<Junction>): boolean {
  const reversed = [...verts].reverse();
  return isPolygonCCW(reversed);
}

/**
 * Signed cross of edge `a → b` with the vector `a → p`. Used by
 * {@link isPolygonCCW} to admit an ULP-level epsilon on the relaxed
 * (non-strict) check while still calling {@link leftOfDirectedEdgeStrict}
 * for the strict turn count via the sign.
 */
function signedTurn(a: Junction, b: Junction, p: Point): number {
  if (a.kind === 'finite' && b.kind === 'finite') {
    return cross(b.x - a.x, b.y - a.y, p.x - a.x, p.y - a.y);
  }
  if (a.kind === 'finite' && b.kind === 'ideal') {
    return cross(b.x, b.y, p.x - a.x, p.y - a.y);
  }
  if (a.kind === 'ideal' && b.kind === 'finite') {
    return cross(a.x, a.y, b.x - p.x, b.y - p.y);
  }
  return 1; // both ideal — sameIdealDirection guard upstream handles this case
}
