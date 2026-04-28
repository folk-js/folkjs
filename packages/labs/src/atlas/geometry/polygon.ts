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
 * any mix of finite and ideal vertices, including all-ideal polygons whose
 * boundary is the line at infinity (the four-wedge collapse / "infinite plane"
 * seed).
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
 *
 * **All-ideal polygons** (every vertex is at infinity): the boundary is
 * interpreted as a sequence of arcs along S¹. CCW is determined by the
 * angular sweep of the unit-direction vectors — every consecutive pair must
 * sweep CCW around S¹ (cross ≥ 0), with at least one strictly positive
 * sweep. (A chord between two ideal vertices cannot be distinguished from
 * an arc here, so polygons that mix arcs and ideal-ideal chords aren't
 * supported by this predicate; our mutation primitives reject that case.)
 */
export function isPolygonCCW(verts: ReadonlyArray<Junction>): boolean {
  const n = verts.length;
  if (n < 3) return false;
  if (verts.every((v) => v.kind === 'ideal')) {
    let pos = 0;
    for (let i = 0; i < n; i++) {
      const a = verts[i];
      const b = verts[(i + 1) % n];
      if (sameIdealDirection(a, b)) continue;
      const x = cross(a.x, a.y, b.x, b.y);
      if (x < 0) return false;
      if (x > 0) pos++;
    }
    return pos > 0;
  }
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
    const x = signedTurn(a, b, c);
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
 * Convexity measure for the directed line `a → b` against vertex `c`:
 * positive means `c` is strictly left of the line, zero means collinear,
 * negative means strictly right. Applied to every consecutive triple of
 * a polygon's vertices, this tests "no right turn at b" — equivalent to
 * convexity for a CCW polygon.
 *
 * Each junction kind contributes either a position vector (finite) or an
 * ideal direction. Crucially, ideal directions are used *as directions*
 * directly, never converted into "very far finite points" — that hack
 * only works when the polygon is anchored near the origin. With faces
 * that can be positioned anywhere via `face.frame`, an ideal `c`
 * collinear with edge `a → b` (e.g. `(0, h) → (1, h)` extended to `+x∞`)
 * must register zero, which only happens if we use `c` as a direction.
 *
 * Cases:
 *  - `a, b` both finite: line direction is `b - a`. For finite `c`, use
 *    displacement `c - a`. For ideal `c`, use the direction `c` itself.
 *  - `a` finite, `b` ideal: line continues in direction `b` from `a`.
 *    For finite `c`, use `c - a`. For ideal `c`, use `c`.
 *  - `a` ideal, `b` finite: line through `b` continues in direction `-a`
 *    (we approached `b` *from* `a`). For finite `c`, use `c - b`. For
 *    ideal `c`, use `c`.
 *  - `a, b` both ideal: along the line at infinity; only meaningful when
 *    `c` is finite (testing whether `c` lies inside the half-plane bounded
 *    by the chord-at-infinity from direction `a` to direction `b`). For
 *    same-direction `(a, b)` callers must skip via `sameIdealDirection`.
 *    Otherwise: line direction is `b - a` (chord through R²∪S¹ from a
 *    direction `a` to a direction `b`). Treat `c - midpoint` as the test
 *    vector — but in practice this configuration only occurs with `c`
 *    ideal too, which we punt on (return 1 as a no-op convexity vote).
 */
function signedTurn(a: Junction, b: Junction, c: Junction): number {
  // Both a and b ideal: the boundary segment from a to b lies on the line
  // at infinity (S¹). The convexity contribution is determined by the
  // angular sweep a → b along S¹: positive if CCW (within 180°). c is
  // irrelevant here — its convexity is voted on by neighbouring triples.
  if (a.kind === 'ideal' && b.kind === 'ideal') {
    return cross(a.x, a.y, b.x, b.y);
  }
  // Edge direction (as a 2D vector) for the directed line a → b.
  let edx: number, edy: number;
  if (a.kind === 'finite' && b.kind === 'finite') {
    edx = b.x - a.x;
    edy = b.y - a.y;
  } else if (a.kind === 'finite' && b.kind === 'ideal') {
    edx = b.x;
    edy = b.y;
  } else {
    // a ideal, b finite: line through b continues in direction -a.
    edx = -a.x;
    edy = -a.y;
  }
  // Test vector from a point on the line to c.
  let tdx: number, tdy: number;
  if (c.kind === 'ideal') {
    // c at infinity in direction (c.x, c.y); use the direction directly.
    tdx = c.x;
    tdy = c.y;
  } else if (a.kind === 'finite') {
    tdx = c.x - a.x;
    tdy = c.y - a.y;
  } else {
    // a ideal, b finite, c finite: anchor the test vector at b.
    tdx = c.x - b.x;
    tdy = c.y - b.y;
  }
  return cross(edx, edy, tdx, tdy);
}
