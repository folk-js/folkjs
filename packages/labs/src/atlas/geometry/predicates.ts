// ============================================================================
// Predicates over HomPoint / HomLine
// ============================================================================
//
// Convex polygon predicates and directed-edge tests. All inputs are
// `HomPoint` (the substrate's only point type); finite vs ideal endpoints
// are handled uniformly by the underlying homogeneous expressions, with no
// kind-dispatch.

import { cross } from './point.ts';
import { HomPoint, signedTurn } from './projective.ts';

/**
 * Whether `p` lies left of (or on) the directed edge `a → b`.
 *
 * For finite or finite/ideal-mixed edges this is `signedTurn(a, b, p) >= 0`:
 * positive turn means `p` is on the left of the line through `a` and `b`,
 * oriented from `a` to `b`.
 *
 * **Ideal-ideal edges always return `true`.** Such an edge is either an
 * arc on S¹ (boundary of an unbounded face — trivially doesn't constrain
 * finite query points) or a chord (a real line through R² with antipodal
 * ideal endpoints, where the line itself is determined by an anchor that
 * `polygonContains` doesn't see). In the chord case, `Face.contains`
 * runs a separate per-chord half-plane test that uses the anchor; here
 * we defer to that. Returning `true` here is the conservative choice
 * that matches the old kind-dispatched implementation's semantics.
 */
export function leftOfDirectedEdge(a: HomPoint, b: HomPoint, p: HomPoint): boolean {
  if (a.isIdeal && b.isIdeal) return true;
  return signedTurn(a, b, p) >= 0;
}

/** Strict version of {@link leftOfDirectedEdge}: `> 0` only. Same ideal-ideal carve-out. */
export function leftOfDirectedEdgeStrict(
  a: HomPoint,
  b: HomPoint,
  p: HomPoint,
): boolean {
  if (a.isIdeal && b.isIdeal) return true;
  return signedTurn(a, b, p) > 0;
}

/**
 * Test whether `p` lies inside (or on the boundary of) the CCW convex
 * polygon defined by `verts` (k ≥ 2). Vertices may be finite or ideal.
 *
 * Implementation: n half-plane tests via {@link leftOfDirectedEdge}.
 * Correctness assumes the polygon is convex and CCW ({@link isPolygonCCW}).
 *
 * **Digon case (k=2)**: the two ideal vertices alone don't constrain
 * finite query points — the actual constraint is carried by chord
 * half-edges in the substrate's `Side.line` field, which `Face.contains`
 * tests separately. We return `true` here so chord-level tests can do
 * the work.
 */
export function polygonContains(
  verts: ReadonlyArray<HomPoint>,
  p: HomPoint,
): boolean {
  const n = verts.length;
  if (n < 2) return false;
  if (n === 2) return true;
  for (let i = 0; i < n; i++) {
    if (!leftOfDirectedEdge(verts[i], verts[(i + 1) % n], p)) return false;
  }
  return true;
}

/** Strict version of {@link polygonContains}: returns `true` only if `p` is strictly interior. */
export function polygonContainsStrict(
  verts: ReadonlyArray<HomPoint>,
  p: HomPoint,
): boolean {
  const n = verts.length;
  if (n < 2) return false;
  if (n === 2) return true;
  for (let i = 0; i < n; i++) {
    if (!leftOfDirectedEdgeStrict(verts[i], verts[(i + 1) % n], p)) return false;
  }
  return true;
}

/**
 * Whether two consecutive vertices share the same ideal direction (a
 * degenerate at-infinity edge with zero angular sweep). Strip-rectangle-
 * style faces use these as "endpoint cap" sides.
 */
export function sameIdealDirection(
  a: HomPoint,
  b: HomPoint,
  eps = 1e-9,
): boolean {
  return (
    a.isIdeal &&
    b.isIdeal &&
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps
  );
}

/**
 * Whether the convex polygon defined by `verts` (k ≥ 2) is wound CCW.
 * Handles any mix of finite and ideal vertices, including all-ideal
 * polygons whose boundary is the line at infinity (the empty-canvas seed).
 *
 * **Digon case (k=2)**: only valid if both vertices are ideal and
 * antipodal (the two limit directions of a real line through R²). Such a
 * digon is a "slab" face bounded by 2 parallel chord HEs — orientation is
 * encoded in the chord HE directions, not in the vertex sequence.
 *
 * **All-ideal polygons**: boundary lies on S¹; CCW is determined by the
 * angular sweep of the unit-direction vectors. Every consecutive pair must
 * sweep CCW around S¹ (cross of directions ≥ 0), with at least one strict
 * positive sweep. Note: we use `cross` of directions directly — not
 * `signedTurn`, which is structurally zero for all-ideal triples (three
 * w=0 rows give a zero determinant).
 *
 * **Mixed polygons**: standard "no right turn" convexity check via
 * {@link signedTurn}. Two structural exceptions don't contribute to the
 * turn accounting:
 *  1. Collinear chain vertices: `b` finite on segment `a→c` (zero-turn
 *     intermediate vertex on a long side; strip rectangles use these).
 *  2. Same-ideal-direction edges: `(a, b)` or `(b, c)` both ideal in the
 *     same direction (zero-length at-infinity edge; strip-rectangle ends).
 */
export function isPolygonCCW(verts: ReadonlyArray<HomPoint>): boolean {
  const n = verts.length;
  if (n < 2) return false;
  if (n === 2) {
    const a = verts[0];
    const b = verts[1];
    if (!a.isIdeal || !b.isIdeal) return false;
    const eps = 1e-9;
    // Antipodal check: a + b = 0 component-wise.
    return Math.abs(a.x + b.x) <= eps && Math.abs(a.y + b.y) <= eps;
  }
  if (verts.every((v) => v.isIdeal)) {
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
  // Relaxed left-of test admits a tiny negative slack so floating-point
  // round-off near collinear chain vertices isn't classified as a right
  // turn. Strip rectangles produce these naturally; the strict turn count
  // is unaffected.
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

/** Whether the polygon is wound CW (reversed CCW). */
export function isPolygonCW(verts: ReadonlyArray<HomPoint>): boolean {
  const reversed = [...verts].reverse();
  return isPolygonCCW(reversed);
}

/**
 * Parameter `t` such that `p = a + t * (b - a)` along the finite segment
 * from `a` to `b`, with collinearity tolerance. Returns `null` if `p`
 * isn't (sufficiently) collinear with the segment, or if `a == b`.
 *
 * Pure Cartesian helper; does not handle ideal endpoints. For
 * homogeneous-line parameterisation in the substrate's primitives, use
 * `HomLine`'s parameter operations instead.
 */
export function parameterOnSegment(
  a: { x: number; y: number },
  b: { x: number; y: number },
  p: { x: number; y: number },
  eps = 1e-9,
): number | null {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < eps * eps) return null;
  const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
  const px = a.x + t * dx;
  const py = a.y + t * dy;
  const perp2 = (p.x - px) * (p.x - px) + (p.y - py) * (p.y - py);
  if (perp2 > eps * eps * Math.max(1, len2)) return null;
  return t;
}
