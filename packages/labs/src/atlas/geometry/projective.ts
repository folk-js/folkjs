// ============================================================================
// HomPoint / HomLine — homogeneous projective primitives
// ============================================================================
//
// `HomPoint` is the substrate's point type: a homogeneous projective point
// `(x, y, w)`. `w !== 0` means finite (canonical scale `w = 1`); `w === 0`
// means ideal (point at infinity in unit direction `(x, y)`).
//
// `HomLine` is the substrate's line type: a homogeneous projective line
// `(a, b, c)` such that any homogeneous point `p` is on the line iff
// `a*p.x + b*p.y + c*p.w === 0`.
//
// Both are *always normalized* in stored form:
//   - finite point: `w = 1`, `(x, y)` is the Cartesian position
//   - ideal point:  `w = 0`, `x² + y² = 1` (unit direction)
//   - finite line:  `a² + b² = 1`, `c` is signed perpendicular distance from origin
//   - line at infinity: `a = b = 0`, `c = ±1`
//
// All operations either preserve normalization or normalize on the way out.
// Both classes are immutable; every operation returns a new instance.
//
// **Oriented projective convention.** Equivalence is `(x, y, w) ~ (kx, ky, kw)`
// for `k > 0` only. Sign matters: orientation, left/right, and CCW
// semantics depend on it. Negating all three components is *not* the same
// projective object in oriented projective geometry.
//
// See `step-6.md` for the design rationale and the wider refactor plan.

import * as M from '@folkjs/geometry/Matrix2D';
import type { Point } from '@folkjs/geometry/Vector2';

const EPS = 1e-9;

// ----------------------------------------------------------------------------
// HomPoint
// ----------------------------------------------------------------------------

export class HomPoint {
  readonly x: number;
  readonly y: number;
  readonly w: number;

  /**
   * Direct constructor. Callers should normally use {@link finite},
   * {@link idealDir}, or {@link fromHomogeneous} — the direct constructor
   * is for already-normalized inputs (e.g. cross-product results that have
   * been canonicalised by their caller).
   */
  constructor(x: number, y: number, w: number) {
    this.x = x;
    this.y = y;
    this.w = w;
  }

  /** A finite point at Cartesian `(x, y)`. */
  static finite(x: number, y: number): HomPoint {
    return new HomPoint(x, y, 1);
  }

  /**
   * An ideal point in direction `(dx, dy)`. The direction is normalised
   * to unit length; passing a zero vector throws.
   */
  static idealDir(dx: number, dy: number): HomPoint {
    const len = Math.hypot(dx, dy);
    if (len < EPS) {
      throw new Error('HomPoint.idealDir: zero-length direction');
    }
    return new HomPoint(dx / len, dy / len, 0);
  }

  /**
   * Wrap a raw homogeneous triple (e.g. from a cross product) into a
   * canonical `HomPoint`. `w !== 0` is rescaled to `w = 1`; `w === 0` has
   * `(x, y)` normalised to unit length. Throws if `(x, y, w)` is the zero
   * vector (which has no projective meaning).
   */
  static fromHomogeneous(x: number, y: number, w: number): HomPoint {
    if (Math.abs(w) > EPS) {
      // Finite. Rescale to canonical w = 1. Dividing by w flips the sign
      // of (x, y, w) together when w < 0 — finite points have a unique
      // canonical w-positive representative, so dropping the orientation
      // flip at storage time is the right move (`crossPP` and other
      // operations carry their own orientation in their *result*; the
      // stored points themselves are the standard Cartesian positions).
      const k = 1 / w;
      return new HomPoint(x * k, y * k, 1);
    }
    const len = Math.hypot(x, y);
    if (len < EPS) {
      throw new Error('HomPoint.fromHomogeneous: zero vector has no projective meaning');
    }
    return new HomPoint(x / len, y / len, 0);
  }

  /** True iff this point is finite (`w !== 0`). */
  get isFinite(): boolean {
    return this.w !== 0;
  }

  /** True iff this point is at infinity (`w === 0`). */
  get isIdeal(): boolean {
    return this.w === 0;
  }

  /**
   * The point's kind as a string discriminator. Useful for diagnostic
   * output (`validateAtlas` error messages, debug printing) but
   * substrate operations branch on `isFinite`/`isIdeal` for clarity, or
   * (better) use uniform homogeneous expressions that don't dispatch
   * at all.
   */
  get kind(): 'finite' | 'ideal' {
    return this.w === 0 ? 'ideal' : 'finite';
  }

  /**
   * Cartesian `(x, y)` for finite points. Throws for ideal points
   * (which have no Cartesian position). Use {@link dir} for ideal points.
   */
  cart(): Point {
    if (this.w === 0) {
      throw new Error('HomPoint.cart: point is ideal (at infinity); use dir() instead');
    }
    // w is canonically 1 in stored form, but defensively divide.
    return { x: this.x / this.w, y: this.y / this.w };
  }

  /**
   * Unit direction `(x, y)` for ideal points. Throws for finite points
   * (which have a position, not a direction). Use {@link cart} for finite points.
   */
  dir(): Point {
    if (this.w !== 0) {
      throw new Error('HomPoint.dir: point is finite; use cart() instead');
    }
    return { x: this.x, y: this.y };
  }

  /**
   * Apply a 2D affine transform to this point. Translations affect
   * finite points and drop out for ideal points automatically (the
   * `w` component multiplies the translation column to zero). No
   * separate `applyLinearToDirection` path needed.
   */
  applyAffine(T: M.Matrix2DReadonly): HomPoint {
    return HomPoint.fromHomogeneous(
      T.a * this.x + T.c * this.y + T.e * this.w,
      T.b * this.x + T.d * this.y + T.f * this.w,
      this.w,
    );
  }

  /**
   * Equality up to oriented projective scale, within `eps`. Two points
   * are equal iff their cross product is near zero (collinear with the
   * origin in projective space) AND they have the same orientation
   * (no antipodal flip). For our always-normalized representation this
   * reduces to componentwise equality.
   */
  equals(other: HomPoint, eps = EPS): boolean {
    return (
      Math.abs(this.x - other.x) < eps &&
      Math.abs(this.y - other.y) < eps &&
      Math.abs(this.w - other.w) < eps
    );
  }

  /**
   * Whether this and `other` are antipodal ideal directions: both at
   * infinity (`w = 0`) and pointing in opposite unit directions.
   *
   * In oriented projective geometry, antipodal ideals are distinct
   * points but they're the two "limit directions" of a single real line
   * through R² — which is why chord sides need this test (and why a chord
   * can't be derived from its endpoints alone, since `crossPP` of an
   * antipodal pair returns the zero vector).
   *
   * Returns false if either point is finite, or if both ideal but not
   * antipodal within `eps`.
   */
  isAntipodalTo(other: HomPoint, eps = EPS): boolean {
    return (
      this.isIdeal &&
      other.isIdeal &&
      Math.abs(this.x + other.x) < eps &&
      Math.abs(this.y + other.y) < eps
    );
  }
}

// ----------------------------------------------------------------------------
// HomLine
// ----------------------------------------------------------------------------

export class HomLine {
  readonly a: number;
  readonly b: number;
  readonly c: number;

  /**
   * Direct constructor for already-normalized inputs. Callers should
   * normally use {@link through}, {@link withDirection}, {@link atInfinity},
   * or {@link fromHomogeneous}.
   */
  constructor(a: number, b: number, c: number) {
    this.a = a;
    this.b = b;
    this.c = c;
  }

  /**
   * The unique line through two distinct projective points. Computed as
   * the homogeneous cross product of the two points, then normalized.
   *
   * Special cases handled uniformly by the cross product:
   *  - two finite points: standard line through them
   *  - one finite, one ideal: ray-bearing line through the finite point in the ideal direction
   *  - two ideal antipodal directions: a finite line through R² with those limit directions; needs an explicit normalization choice (caller-disambiguated by passing a non-antipodal pair, or by using {@link withDirection} for the chord case)
   *  - two ideal non-antipodal: the line at infinity (normalised to `(0, 0, ±1)`)
   *
   * Throws when the two points coincide projectively (cross product is zero).
   */
  static through(p1: HomPoint, p2: HomPoint): HomLine {
    return HomLine.fromHomogeneous(
      p1.y * p2.w - p1.w * p2.y,
      p1.w * p2.x - p1.x * p2.w,
      p1.x * p2.y - p1.y * p2.x,
    );
  }

  /**
   * The line through a finite point `through` in direction `dir`. Useful
   * for the chord case (where two antipodal ideal endpoints don't pin
   * down which parallel line we mean — supply the line directly via a
   * point on it and the line's direction).
   */
  static withDirection(through: HomPoint, dir: Point): HomLine {
    if (through.isIdeal) {
      throw new Error('HomLine.withDirection: anchor point must be finite');
    }
    const len = Math.hypot(dir.x, dir.y);
    if (len < EPS) {
      throw new Error('HomLine.withDirection: zero-length direction');
    }
    // Choose the orientation so {@link tangent} (which equals `(-b, a)`)
    // points along `dir`, matching {@link through}'s convention where
    // `through(P, Q).tangent` points along `P - Q`. With tangent = `dir`
    // we need `b = -dir.x` and `a = dir.y`; the constant follows from
    // requiring the line to pass through the anchor.
    return HomLine.fromHomogeneous(
      dir.y / len,
      -dir.x / len,
      (dir.x * through.y - dir.y * through.x) / len,
    );
  }

  /** The unique line at infinity, oriented `(0, 0, 1)`. */
  static atInfinity(): HomLine {
    return new HomLine(0, 0, 1);
  }

  /**
   * Wrap a raw homogeneous line triple (e.g. from a cross product) into
   * a canonical `HomLine`. Finite lines are normalized so `a² + b² = 1`;
   * the line at infinity is normalized to `(0, 0, sign(c))`.
   *
   * Throws if `(a, b, c)` is the zero triple (no projective meaning).
   */
  static fromHomogeneous(a: number, b: number, c: number): HomLine {
    const d = Math.sqrt(a * a + b * b);
    if (d < EPS) {
      // Line at infinity (or near-degenerate). Normalize c to ±1.
      if (Math.abs(c) < EPS) {
        throw new Error('HomLine.fromHomogeneous: zero triple has no projective meaning');
      }
      return new HomLine(0, 0, c > 0 ? 1 : -1);
    }
    return new HomLine(a / d, b / d, c / d);
  }

  /** True iff this is the line at infinity (`a² + b² ≈ 0`). */
  get isAtInfinity(): boolean {
    return this.a === 0 && this.b === 0;
  }

  /**
   * Evaluate the line equation at a homogeneous point: `a*x + b*y + c*w`.
   * Sign tells which side of the (oriented) line the point is on:
   *  - `> 0`: left of the line's natural direction
   *  - `< 0`: right
   *  - `= 0` (within `eps`): on the line
   *
   * Uniform across finite/ideal points — no kind-dispatch.
   */
  evalAt(p: HomPoint): number {
    return this.a * p.x + this.b * p.y + this.c * p.w;
  }

  /**
   * The intersection of two lines, as a homogeneous point. Computed as
   * the cross product of the two line triples, normalized. For parallel
   * lines (or two copies of the same line) this returns the ideal point
   * at the lines' shared direction.
   *
   * Throws when both inputs are the line at infinity (they share *all*
   * ideal directions; the intersection is undefined).
   */
  intersect(other: HomLine): HomPoint {
    return HomPoint.fromHomogeneous(
      this.b * other.c - this.c * other.b,
      this.c * other.a - this.a * other.c,
      this.a * other.b - this.b * other.a,
    );
  }

  /**
   * Apply a 2D affine transform to this line. Lines transform under the
   * inverse-transpose of the point transform: if points map by `T`, lines
   * map by `(T⁻¹)ᵀ`. The result is normalized.
   */
  applyAffine(T: M.Matrix2DReadonly): HomLine {
    // For 2D affine T = [[a, c, e], [b, d, f], [0, 0, 1]]:
    //   inv(T) = [[d, -c, c*f - d*e], [-b, a, b*e - a*f], [0, 0, 1]] / det,
    //   inv(T)ᵀ = [[d, -b, 0], [-c, a, 0], [c*f - d*e, b*e - a*f, 1]] / det
    // (rows of the original matrix become columns of the inverse-transpose,
    //  scaled by 1/det, with the shift column landing in the bottom row.)
    const det = T.a * T.d - T.b * T.c;
    if (Math.abs(det) < EPS) {
      throw new Error('HomLine.applyAffine: transform is degenerate (det = 0)');
    }
    const newA = (T.d * this.a - T.b * this.b) / det;
    const newB = (-T.c * this.a + T.a * this.b) / det;
    const newC = ((T.c * T.f - T.d * T.e) * this.a + (T.b * T.e - T.a * T.f) * this.b) / det + this.c;
    return HomLine.fromHomogeneous(newA, newB, newC);
  }

  /**
   * Signed perpendicular distance from origin to the line. For a
   * normalised finite line this is just `-c` (the line equation
   * evaluated at the origin `(0, 0, 1)` is `c`). The line at infinity
   * has no meaningful perpendicular distance — returns `Infinity`.
   */
  get perpFromOrigin(): number {
    if (this.isAtInfinity) return Infinity;
    return -this.c;
  }

  /**
   * Unit tangent vector along the line, oriented so that walking in this
   * direction has the line's "positive normal" `(a, b)` on the left
   * (90° CCW rotation: `tangent = (-b, a)`).
   *
   * Throws for the line at infinity (which has no Cartesian tangent).
   *
   * Concretely: `HomLine.through(P, Q).tangent` for two distinct points
   * `P`, `Q` points in the direction `Q → P`'s 90°-CCW-of-perpendicular,
   * which for finite endpoints reduces to the unit vector `(P - Q) / |P - Q|`.
   */
  get tangent(): Point {
    if (this.isAtInfinity) {
      throw new Error('HomLine.tangent: line at infinity has no Cartesian tangent');
    }
    return { x: -this.b, y: this.a };
  }

  /**
   * Signed parameter of `p` along this line's tangent direction, with
   * `parameterOf(footOfPerpFromOrigin) === 0`. Increasing parameter
   * moves in the {@link tangent} direction.
   *
   * For a finite point `p` strictly on the line: a finite scalar.
   * For an ideal point `p`: `±Infinity` whose sign matches the
   * projection of `p`'s direction onto the line tangent — the natural
   * extension of "where on the line does this point sit" to points at
   * infinity. (Returns `NaN` if the ideal direction is perpendicular to
   * the line, which only happens for points NOT on the line.)
   *
   * Does not check that `p` actually lies on the line; callers that
   * care should test with {@link evalAt} first.
   *
   * Throws for the line at infinity (which has no parametric metric in
   * R²; arcs use angular sweep on S¹ instead).
   */
  parameterOf(p: HomPoint): number {
    if (this.isAtInfinity) {
      throw new Error('HomLine.parameterOf: line at infinity is not parameterizable in R²');
    }
    // For tangent (-b, a) and finite p (w=1):
    //   (p - footOfPerp) · tangent = a*p.y - b*p.x   (the perp component cancels)
    // For ideal p (w=0):
    //   the projection of p's direction on tangent is a*p.y - b*p.x;
    //   sign tells which infinity, magnitude is meaningless for "position on line."
    const proj = this.a * p.y - this.b * p.x;
    if (p.isFinite) return proj;
    if (proj > EPS) return Infinity;
    if (proj < -EPS) return -Infinity;
    return NaN;
  }

  /**
   * Point on the line at parameter `t`: foot-of-perpendicular-from-origin
   * shifted by `t` in the {@link tangent} direction.
   *
   * Inverse of {@link parameterOf} (for finite parameters returning
   * finite points). Throws for the line at infinity.
   */
  pointAtParameter(t: number): HomPoint {
    if (this.isAtInfinity) {
      throw new Error('HomLine.pointAtParameter: line at infinity is not parameterizable in R²');
    }
    // foot = -c * (a, b); tangent = (-b, a).
    const fx = -this.a * this.c;
    const fy = -this.b * this.c;
    return HomPoint.finite(fx - t * this.b, fy + t * this.a);
  }

  /**
   * Equality up to oriented projective scale, within `eps`. Same rule
   * as for points: with always-normalized representation, this reduces
   * to componentwise equality.
   */
  equals(other: HomLine, eps = EPS): boolean {
    return (
      Math.abs(this.a - other.a) < eps &&
      Math.abs(this.b - other.b) < eps &&
      Math.abs(this.c - other.c) < eps
    );
  }
}

// ----------------------------------------------------------------------------
// Free-function operations
// ----------------------------------------------------------------------------

/**
 * Signed turn at vertex `b` for the triple `(a, b, c)`: positive if `c`
 * is strictly left of directed edge `a → b`, zero if collinear, negative
 * if right. The single-expression replacement for the 9-case `signedTurn`
 * branch in `polygon.ts`.
 *
 * Computed as the determinant of the 3×3 matrix formed by stacking the
 * three homogeneous points as rows. Handles all combinations of
 * finite/ideal endpoints uniformly.
 */
export function signedTurn(a: HomPoint, b: HomPoint, c: HomPoint): number {
  return (
    a.x * (b.y * c.w - b.w * c.y) -
    a.y * (b.x * c.w - b.w * c.x) +
    a.w * (b.x * c.y - b.y * c.x)
  );
}

/**
 * Linear interpolation between two homogeneous points. The result is
 * normalized into canonical `HomPoint` form.
 *
 * Behaviour by case (emerging naturally from the homogeneous formulas):
 *  - both finite: standard Cartesian lerp.
 *  - finite (t=0 end) → ideal (t=1 end): walks linearly along the ray
 *    from the finite point toward infinity in the ideal direction; at
 *    `t = 1` the result is the ideal point itself.
 *  - both ideal: directional lerp in the ideal-direction plane,
 *    re-normalized to unit length. **Note:** this is a *linear* (chord)
 *    interpolation in direction-space, not an angular (arc) one.
 *    Callers needing angular interpolation along the line at infinity
 *    must compute that explicitly.
 *
 * Throws if the lerped triple is degenerate (e.g. `t = 0.5` between two
 * antipodal ideal directions yields the zero vector).
 */
export function lerpHom(p1: HomPoint, p2: HomPoint, t: number): HomPoint {
  const u = 1 - t;
  return HomPoint.fromHomogeneous(
    u * p1.x + t * p2.x,
    u * p1.y + t * p2.y,
    u * p1.w + t * p2.w,
  );
}
