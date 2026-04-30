// ============================================================================
// Low-level 2D vector math
// ============================================================================
//
// Tiny helpers used across the geometry module. The substrate's main
// point/line abstractions live in `projective.ts` (`HomPoint`, `HomLine`);
// `cross` is needed there and in `predicates.ts` for arc-orientation
// (S¹ direction-cross), which operates on Cartesian (dx, dy) directly.

/** 2D scalar cross product (ax*by - ay*bx). */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}
