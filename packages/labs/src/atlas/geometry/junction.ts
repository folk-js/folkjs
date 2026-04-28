// ============================================================================
// Junction — point in the oriented projective plane
// ============================================================================
//
// A junction is a kind + a pair of numbers, in some face's local frame.
//
//  - `kind: 'finite'` — `(x, y)` is a face-local position.
//  - `kind: 'ideal'`  — `(x, y)` is a unit direction in the face-local frame
//    representing "at infinity in this direction".
//
// In the substrate's combinatorial layer junctions are derived data (read off
// HalfEdge fields) rather than separately allocated objects; here we just
// define the value type plus the small helpers that operate on it without
// reaching into atlas/face/edge concepts.

import type { Point } from '@folkjs/geometry/Vector2';

/** A point in the oriented projective plane, expressed in some face frame. */
export interface Junction {
  kind: 'finite' | 'ideal';
  x: number;
  y: number;
}

/**
 * Whether two ideal junctions point in (numerically) the same direction.
 * Used to detect degenerate at-infinity edges where two consecutive vertices
 * share an ideal direction (e.g. the "ends" of a strip rectangle).
 */
export function sameIdealDirection(a: Junction, b: Junction, eps = 1e-9): boolean {
  return (
    a.kind === 'ideal' &&
    b.kind === 'ideal' &&
    Math.abs(a.x - b.x) < eps &&
    Math.abs(a.y - b.y) < eps
  );
}

/**
 * Express a junction `j` (in some face's frame) in a frame translated by
 * `+translation` (i.e., where `translation` is the new origin). For finite
 * junctions this subtracts the translation; for ideal directions it's a no-op.
 */
export function junctionInTranslatedFrame(j: Junction, translation: Point): Junction {
  if (j.kind === 'finite') {
    return { kind: 'finite', x: j.x - translation.x, y: j.y - translation.y };
  }
  return { kind: 'ideal', x: j.x, y: j.y };
}
