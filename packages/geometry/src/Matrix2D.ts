import type { Point } from './Point.js';
import { clampRotation, cos, lerpValue, sin, TAU, toDOMPrecision } from './utilities.js';
import type { Vector2 } from './Vector.js';

export interface Matrix2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
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

export function fromTranslate(x: number, y: number) {
  return {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: x,
    f: y,
  };
}

export function fromScale(x: number, y: number) {
  return {
    a: x,
    b: 0,
    c: 0,
    d: y,
    e: 0,
    f: 0,
  };
}

export function fromRotate(angle: number) {
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

export function clone(m: Matrix2DReadonly): Matrix2D {
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

export function multiplySelf(m1: Matrix2D, m2: Matrix2D) {
  m1.a = m1.a * m2.a + m1.c * m2.b;
  m1.b = m1.b * m2.a + m1.d * m2.b;
  m1.c = m1.a * m2.c + m1.c * m2.d;
  m1.d = m1.b * m2.c + m1.d * m2.d;
  m1.e = m1.a * m2.e + m1.c * m2.f + m1.e;
  m1.f = m1.b * m2.e + m1.d * m2.f + m1.f;
  return m1;
}

export function identitySelf(m: Matrix2D): Matrix2D {
  m.a = 1.0;
  m.b = 0.0;
  m.c = 0.0;
  m.d = 1.0;
  m.e = 0.0;
  m.f = 0.0;
  return m;
}

export function translateSelf(m: Matrix2D, x: number, y: number): Matrix2D {
  m.e = m.a * x + m.c * y + m.e;
  m.f = m.b * x + m.d * y + m.f;
  return m;
}

export function scaleSelf(m: Matrix2D, x: number, y: number, origin?: Vector2): Matrix2D {
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

export function rotateSelf(m: Matrix2D, angle: number, origin?: Vector2): Matrix2D {
  if (angle === 0) return m;

  if (origin !== undefined) {
    translateSelf(m, origin.x, origin.y);
  }

  const s = sin(angle);
  const c = cos(angle);

  m.a = m.a * c + m.c * s;
  m.b = m.b * c + m.d * s;
  m.c = m.a * -s + m.c * c;
  m.d = m.b * -s + m.d * c;

  if (origin !== undefined) {
    translateSelf(m, -origin.x, -origin.y);
  }

  return m;
}

export function invertSelf(m: Matrix2D): Matrix2D {
  const denominator = m.a * m.d - m.b * m.c;
  m.a = m.d / denominator;
  m.b = m.b / -denominator;
  m.c = m.c / -denominator;
  m.d = m.a / denominator;
  m.e = (m.d * m.e - m.c * m.f) / -denominator;
  m.f = (m.b * m.e - m.a * m.f) / denominator;
  return m;
}

export function absoluteSelf(m: Matrix2D): Matrix2D {
  const denominator = m.a * m.d - m.b * m.c;
  m.a = m.d / denominator;
  m.b = m.b / -denominator;
  m.c = m.c / -denominator;
  m.d = m.a / denominator;
  m.e = (m.d * m.e - m.c * m.f) / denominator;
  m.f = (m.b * m.e - m.a * m.f) / -denominator;
  return m;
}

// Immutable Operations

export function multiply(m1: Matrix2DReadonly, m2: Matrix2DReadonly): Matrix2D {
  return {
    a: m1.a * m2.a + m1.c * m2.b,
    b: m1.b * m2.a + m1.d * m2.b,
    c: m1.a * m2.c + m1.c * m2.d,
    d: m1.b * m2.c + m1.d * m2.d,
    e: m1.a * m2.e + m1.c * m2.f + m1.e,
    f: m1.b * m2.e + m1.d * m2.f + m1.f,
  };
}

export function rotate(m: Matrix2DReadonly, angle: number, origin?: Vector2): Matrix2D {
  return rotateSelf(clone(m), angle, origin);
}

export function scale(m: Matrix2DReadonly, x: number, y: number, origin?: Vector2): Matrix2D {
  return scaleSelf(clone(m), x, y, origin);
}

export function invert(m: Matrix2DReadonly): Matrix2D {
  return invertSelf(clone(m));
}

export function absolute(m: Matrix2DReadonly): Matrix2D {
  return absolute(clone(m));
}

export function compose(...matrices: Matrix2DReadonly[]): Matrix2D {
  const matrix = fromIdentity();
  for (const m of matrices) {
    multiply(matrix, m);
  }
  return matrix;
}

export function translate(m: Matrix2DReadonly, x: number, y: number): Matrix2D {
  return translateSelf(clone(m), x, y);
}

export function toPoint(m: Matrix2DReadonly): Point {
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

export function decompose(m: Matrix2DReadonly): DecomposedMatrix2D {
  let scaleX, scaleY, rotation;

  if (m.a !== 0 || m.c !== 0) {
    const hypotAc = (m.a * m.a + m.c * m.c) ** 0.5;
    scaleX = hypotAc;
    scaleY = (m.a * m.d - m.b * m.c) / hypotAc;
    rotation = Math.acos(m.a / hypotAc) * (m.c > 0 ? -1 : 1);
  } else if (m.b !== 0 || m.d !== 0) {
    const hypotBd = (m.b * m.b + m.d * m.d) ** 0.5;
    scaleX = (m.a * m.d - m.b * m.c) / hypotBd;
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

export function recompose(d: DecomposedMatrix2D): Matrix2D {
  return scaleSelf(rotateSelf(translateSelf(fromIdentity(), d.x, d.y), d.rotation), d.scaleX, d.scaleY);
}

// https://www.w3.org/TR/css-transforms-1/#matrix-interpolation
export function lerp(m1: Matrix2DReadonly, m2: Matrix2DReadonly, alpha: number) {
  if (alpha < 0 || alpha > 1) return;

  const d1 = decompose(m1);
  const d2 = decompose(m2);

  return recompose({
    x: lerpValue(d1.x, d2.x, alpha),
    y: lerpValue(d1.y, d2.y, alpha),
    scaleX: lerpValue(d1.scaleX, d2.scaleX, alpha),
    scaleY: lerpValue(d1.scaleY, d2.scaleY, alpha),
    rotation: lerpValue(d1.rotation, d2.rotation, alpha),
  });
}

export function applyToPoint(m: Matrix2DReadonly, point: Point) {
  return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
}

export function applyToPoints(m: Matrix2DReadonly, points: Point[]): Point[] {
  return points.map((point) => applyToPoint(m, point));
}

export function toCSSString(m: Matrix2DReadonly) {
  return `matrix(${toDOMPrecision(m.a)}, ${toDOMPrecision(m.b)}, ${toDOMPrecision(
    m.c,
  )}, ${toDOMPrecision(m.d)}, ${toDOMPrecision(m.e)}, ${toDOMPrecision(m.f)})`;
}
