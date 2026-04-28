// ============================================================================
// Low-level 2D vector / point math
// ============================================================================
//
// Tiny helpers that don't deserve their own file but are used across the
// geometry module. Kept here so `junction.ts`, `line.ts`, and `polygon.ts`
// don't have to redefine them.

import type * as M from '@folkjs/geometry/Matrix2D';

/** 2D scalar cross product (ax*by - ay*bx). */
export function cross(ax: number, ay: number, bx: number, by: number): number {
  return ax * by - ay * bx;
}

/** Apply only the linear (2x2) part of an affine to a direction vector. */
export function applyLinearToDirection(
  m: M.Matrix2DReadonly,
  d: { x: number; y: number },
): { x: number; y: number } {
  return { x: m.a * d.x + m.c * d.y, y: m.b * d.x + m.d * d.y };
}
