import { approximatelyEqual, clampRotation, cos, lerpValue, sin, TAU, toDOMPrecision } from './utilities.js';
import type { Vector2, Vector2Readonly } from './Vector2.js';

/** A homogeneous matrix for 2D transformations. */
export interface Matrix2D {
  /** Scale X */
  a: number;
  /** Skew Y */
  b: number;
  /** Skew X */
  c: number;
  /** Scale Y */
  d: number;
  /** Translate X */
  e: number;
  /** Translate Y */
  f: number;
}

export type Matrix2DReadonly = Readonly<Matrix2D>;

export interface DecomposedMatrix2D {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
}

// Factories utilities

/** Creates a new 2D [identity matrix](https://en.wikipedia.org/wiki/Identity_matrix). */
export function fromIdentity(): Matrix2D {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
  };
}

/** Creates a new 2D matrix from a given translation. */
export function fromTranslate(x: number, y: number): Matrix2D {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: x,
    f: y,
  };
}

/** Creates a new 2D matrix from a given scaling. */
export function fromScale(x: number, y: number = x): Matrix2D {
  return {
    a: x,
    b: 0,
    c: 0,
    d: y,
    e: 0,
    f: 0,
  };
}

/** Creates a new 2D matrix from a given angle in radians. */
export function fromRotate(angle: number): Matrix2D {
  const s = sin(angle);
  const c = cos(angle);
  return {
    a: c,
    b: s,
    c: -s,
    d: c,
    e: 0,
    f: 0,
  };
}

/** Create a new 2D matrix from a bunch of values. */
export function fromValues(a: number, b: number, c: number, d: number, e: number, f: number): Matrix2D {
  return {
    a,
    b,
    c,
    d,
    e,
    f,
  };
}

/** Clone a 2D matrix. */
export function fromMatrix2D(m: Matrix2DReadonly): Matrix2D {
  return {
    a: m.a,
    b: m.b,
    c: m.c,
    d: m.d,
    e: m.e,
    f: m.f,
  };
}

// Mutable operations

/**
 * Multiply 2D matrix `m1 · m2` in-place.
 * @param m1 The first operand.
 * @param m2 The second operand.
 * @returns The 2D matrix `m1` after the operation.
 */
export function multiplySelf(m1: Matrix2D, m2: Matrix2D): Matrix2D {
  const { a, b, c, d, e, f } = m1;
  m1.a = a * m2.a + c * m2.b;
  m1.b = b * m2.a + d * m2.b;
  m1.c = a * m2.c + c * m2.d;
  m1.d = b * m2.c + d * m2.d;
  m1.e = a * m2.e + c * m2.f + e;
  m1.f = b * m2.e + d * m2.f + f;
  return m1;
}

/**
 * Set a matrix to the [identity matrix](https://en.wikipedia.org/wiki/Identity_matrix).
 * @param m
 * @returns The matrix `m` after the operation.
 */
export function identitySelf(m: Matrix2D): Matrix2D {
  m.a = 1.0;
  m.b = 0.0;
  m.c = 0.0;
  m.d = 1.0;
  m.e = 0.0;
  m.f = 0.0;
  return m;
}

/**
 * Translate a 2D matrix in-place.
 * @param m
 * @param x Value to translate the 2D matrix in the x-axis.
 * @param y Value to translate the 2D matrix in the y-axis.
 * @returns The matrix `m` after the operation.
 */
export function translateSelf(m: Matrix2D, x: number, y: number): Matrix2D {
  m.e = m.a * x + m.c * y + m.e;
  m.f = m.b * x + m.d * y + m.f;
  return m;
}

/**
 * Scale a 2D matrix in-place.
 * @param m
 * @param x Scale in the x-axis.
 * @param y Scale in the y-axis.
 * @param origin Optional origin to scale the matrix around.
 * @returns The matrix `m` after the operation.
 */
export function scaleSelf(m: Matrix2D, x: number, y = x, origin?: Vector2Readonly): Matrix2D {
  if (origin !== undefined) {
    translateSelf(m, origin.x, origin.y);
  }

  m.a *= x;
  m.b *= x;
  m.c *= y;
  m.d *= y;

  if (origin !== undefined) {
    translateSelf(m, -origin.x, -origin.y);
  }
  return m;
}

/**
 * Rotate a 2D matrix in-place.
 * @param m
 * @param angle Angle of rotation in radians.
 * @param origin Optional origin to rotate the matrix around.
 * @returns The matrix `m` after the operation.
 */
export function rotateSelf(m: Matrix2D, angle: number, origin?: Vector2Readonly): Matrix2D {
  if (angle === 0) return m;

  if (origin !== undefined) {
    translateSelf(m, origin.x, origin.y);
  }

  const s = sin(angle);
  const cs = cos(angle);
  const { a, b, c, d } = m;

  m.a = a * cs + c * s;
  m.b = b * cs + d * s;
  m.c = a * -s + c * cs;
  m.d = b * -s + d * cs;

  if (origin !== undefined) {
    translateSelf(m, -origin.x, -origin.y);
  }

  return m;
}

/**
 * Invert the 2D matrix in-place.
 * @param m
 * @returns The matrix `m` after the operation.
 */
export function invertSelf(m: Matrix2D): Matrix2D {
  const det = determinant(m);
  const { a, b, c, d, e, f } = m;
  m.a = d / det;
  m.b = b / -det;
  m.c = c / -det;
  m.d = a / det;
  m.e = (d * e - c * f) / -det;
  m.f = (b * e - a * f) / det;
  return m;
}

// Immutable Operations

/**
 * Multiply two 2D matricies immutably.
 * @param m1 The first operand.
 * @param m2 The second operand.
 * @returns A new 2D matrix that is the product of the two operands.
 */
export function multiply(m1: Matrix2DReadonly, m2: Matrix2DReadonly): Matrix2D {
  return multiplySelf(fromMatrix2D(m1), m2);
}

/**
 * Rotate a 2D matrix immutably.
 * @param m
 * @param angle Angle of rotation in radians.
 * @param origin Optional origin to rotate the matrix around.
 * @returns A new 2D matrix with the rotation applied.
 */
export function rotate(m: Matrix2DReadonly, angle: number, origin?: Vector2Readonly): Matrix2D {
  return rotateSelf(fromMatrix2D(m), angle, origin);
}

/**
 * Scale a 2D matrix immutably.
 * @param m
 * @param x Scale in the x-axis.
 * @param y Scale in the y-axis.
 * @param origin Optional origin to scale the matrix around.
 * @returns A new 2D matrix with the scaling applied.
 */
export function scale(m: Matrix2DReadonly, x: number, y = x, origin?: Vector2Readonly): Matrix2D {
  return scaleSelf(fromMatrix2D(m), x, y, origin);
}

/**
 * Invert the 2D matrix immutably.
 * @param m
 * @returns A new 2D matrix that's inverted.
 */
export function invert(m: Matrix2DReadonly): Matrix2D {
  return invertSelf(fromMatrix2D(m));
}

/**
 * Multiply multiple 2D matrices together.
 * @param matrices List of 2D matrices to multiply.
 * @returns An new 2D matrix.
 */
export function compose(...matrices: Matrix2DReadonly[]): Matrix2D {
  const matrix = fromIdentity();
  for (const m of matrices) {
    multiply(matrix, m);
  }
  return matrix;
}

/**
 * Translate a 2D matrix immutably.
 * @param m
 * @param x Value to translate the 2D matrix in the x-axis.
 * @param y Value to translate the 2D matrix in the y-axis.
 * @returns A new 2D matrix.
 */
export function translate(m: Matrix2DReadonly, x: number, y: number): Matrix2D {
  return translateSelf(fromMatrix2D(m), x, y);
}

/**
 * Calutate the determinate of the 2D matrix.
 * @param m
 * @returns The determinant of the 2D matrix.
 */
export function determinant(m: Matrix2DReadonly) {
  return m.a * m.d - m.b * m.c;
}

/**
 * Convert a 2D matrix to a point.
 * @param m Matrix to convert to a point.
 * @returns A Vector2.
 */
export function toPoint(m: Matrix2DReadonly): Vector2 {
  return { x: m.e, y: m.f };
}

export function rotation(m: Matrix2DReadonly): number {
  let rotation;

  if (m.a !== 0 || m.c !== 0) {
    const hypotAc = (m.a * m.a + m.c * m.c) ** 0.5;
    rotation = Math.acos(m.a / hypotAc) * (m.c > 0 ? -1 : 1);
  } else if (m.b !== 0 || m.d !== 0) {
    const hypotBd = (m.b * m.b + m.d * m.d) ** 0.5;
    rotation = TAU + Math.acos(m.b / hypotBd) * (m.d > 0 ? -1 : 1);
  } else {
    rotation = 0;
  }

  return clampRotation(rotation);
}

/**
 * Decompose a 2D matrix into its translation, scaling, and rotation factors.
 * @param m
 * @returns The decomposed matrix.
 */
export function decompose(m: Matrix2DReadonly): DecomposedMatrix2D {
  let scaleX, scaleY, rotation;

  const det = determinant(m);
  if (m.a !== 0 || m.c !== 0) {
    const hypotAc = (m.a * m.a + m.c * m.c) ** 0.5;
    scaleX = hypotAc;
    scaleY = det / hypotAc;
    rotation = Math.acos(m.a / hypotAc) * (m.c > 0 ? -1 : 1);
  } else if (m.b !== 0 || m.d !== 0) {
    const hypotBd = (m.b * m.b + m.d * m.d) ** 0.5;
    scaleX = det / hypotBd;
    scaleY = hypotBd;
    rotation = TAU + Math.acos(m.b / hypotBd) * (m.d > 0 ? -1 : 1);
  } else {
    scaleX = 0;
    scaleY = 0;
    rotation = 0;
  }

  return {
    x: m.e,
    y: m.f,
    scaleX,
    scaleY,
    rotation: clampRotation(rotation),
  };
}

/**
 * Recompose a 2D matrix from its translation, scaling, and rotation factors.
 * @param d The decomposed matrix.
 * @returns The recomposed 2D matrix.
 */
export function recompose(d: DecomposedMatrix2D): Matrix2D {
  return scaleSelf(rotateSelf(fromTranslate(d.x, d.y), d.rotation), d.scaleX, d.scaleY);
}

/**
 * Linearally interpolate between two 2D matrices. See [CSS specifiction](https://www.w3.org/TR/css-transforms-1/#matrix-interpolation) for more information.
 * @param m1 Starting 2D matrix.
 * @param m2 Ending 2D matrix.
 * @param alpha Percent to interpolate, between 0 and 1.
 * @returns A new 2D matrix that has been interpolated.
 */
export function lerp(m1: Matrix2DReadonly, m2: Matrix2DReadonly, alpha: number): Matrix2D {
  if (alpha < 0) return fromMatrix2D(m1);

  if (alpha >= 1) return fromMatrix2D(m2);

  const d1 = decompose(m1);
  const d2 = decompose(m2);

  return lerpDecomposed(d1, d2, alpha);
}

/**
 * Linearally interpolate between two decomposed 2D matrices. See [CSS specifiction](https://www.w3.org/TR/css-transforms-1/#matrix-interpolation) for more information.
 * @param m1 Starting decomposed 2D matrix.
 * @param m2 Ending decomposed 2D matrix.
 * @param alpha Percent to interpolate, between 0 and 1.
 * @returns A new 2D matrix that has been interpolated.
 */
export function lerpDecomposed(d1: DecomposedMatrix2D, d2: DecomposedMatrix2D, alpha: number): Matrix2D {
  return recompose({
    x: lerpValue(d1.x, d2.x, alpha),
    y: lerpValue(d1.y, d2.y, alpha),
    scaleX: lerpValue(d1.scaleX, d2.scaleX, alpha),
    scaleY: lerpValue(d1.scaleY, d2.scaleY, alpha),
    rotation: lerpValue(d1.rotation, d2.rotation, alpha),
  });
}

export function applyToPoint(m: Matrix2DReadonly, point: Vector2Readonly): Vector2 {
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
}

export function applyToPoints(m: Matrix2DReadonly, points: Vector2Readonly[]): Vector2[] {
  return points.map((point) => applyToPoint(m, point));
}

export function exactlyEqual(m1: Matrix2DReadonly, m2: Matrix2DReadonly): boolean {
  return m1.a === m2.a && m1.b === m2.b && m1.c === m2.c && m1.d === m2.d && m1.e === m2.e && m1.f === m2.f;
}

export function equals(m1: Matrix2DReadonly, m2: Matrix2DReadonly): boolean {
  return (
    approximatelyEqual(m1.a, m2.a) &&
    approximatelyEqual(m1.b, m2.b) &&
    approximatelyEqual(m1.c, m2.c) &&
    approximatelyEqual(m1.d, m2.d) &&
    approximatelyEqual(m1.e, m2.e) &&
    approximatelyEqual(m1.f, m2.f)
  );
}

export function toCSSString(m: Matrix2DReadonly) {
  return `matrix(${toDOMPrecision(m.a)}, ${toDOMPrecision(m.b)}, ${toDOMPrecision(
    m.c,
  )}, ${toDOMPrecision(m.d)}, ${toDOMPrecision(m.e)}, ${toDOMPrecision(m.f)})`;
}
