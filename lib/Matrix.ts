import type { Point } from './types';

export const round = (value: number, decimal = 0) => Math.round(value * decimal) / decimal;

export const toDOMPrecision = (value: number) => round(value, 1e4);

const PI2 = Math.PI * 2;
const TAU = Math.PI / 2;

export interface MatrixInit {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

export interface IMatrix extends MatrixInit {
  equals(m: MatrixInit): boolean;
  identity(): Matrix;
  multiply(m: MatrixInit): Matrix;
  rotate(r: number, cx?: number, cy?: number): Matrix;
  translate(x: number, y: number): Matrix;
  scale(x: number, y: number): Matrix;
  invert(): Matrix;
  applyToPoint(point: Point): Point;
  applyToPoints(points: Point[]): Point[];
  rotation(): number;
  point(): Point;
  decompose(): { x: number; y: number; scaleX: number; scaleY: number; rotation: number };
  clone(): Matrix;
  toCssString(): string;
  toDOMMatrix(): DOMMatrix;
}

export class Matrix implements IMatrix {
  a;
  b;
  c;
  d;
  e;
  f;

  constructor(a = 1, b = 0, c = 0, d = 1, e = 0, f = 0) {
    this.a = a;
    this.b = b;
    this.c = c;
    this.d = d;
    this.e = e;
    this.f = f;
  }

  equals(m: MatrixInit) {
    return this.a === m.a && this.b === m.b && this.c === m.c && this.d === m.d && this.e === m.e && this.f === m.f;
  }

  identity() {
    this.a = 1.0;
    this.b = 0.0;
    this.c = 0.0;
    this.d = 1.0;
    this.e = 0.0;
    this.f = 0.0;
    return this;
  }

  multiply(m: MatrixInit) {
    const { a, b, c, d, e, f } = this;
    this.a = a * m.a + c * m.b;
    this.c = a * m.c + c * m.d;
    this.e = a * m.e + c * m.f + e;
    this.b = b * m.a + d * m.b;
    this.d = b * m.c + d * m.d;
    this.f = b * m.e + d * m.f + f;
    return this;
  }

  rotate(r: number, cx?: number, cy?: number) {
    if (r === 0) return this;
    if (cx === undefined) return this.multiply(Matrix.Rotate(r));
    return this.translate(cx, cy!).multiply(Matrix.Rotate(r)).translate(-cx, -cy!);
  }

  translate(x: number, y: number): Matrix {
    return this.multiply(Matrix.Translate(x, y!));
  }

  scale(x: number, y: number) {
    return this.multiply(Matrix.Scale(x, y));
  }

  invert() {
    const { a, b, c, d, e, f } = this;
    const denominator = a * d - b * c;
    this.a = d / denominator;
    this.b = b / -denominator;
    this.c = c / -denominator;
    this.d = a / denominator;
    this.e = (d * e - c * f) / -denominator;
    this.f = (b * e - a * f) / denominator;
    return this;
  }

  applyToPoint(point: Point) {
    return Matrix.applyToPoint(this, point);
  }

  applyToPoints(points: Point[]) {
    return Matrix.applyToPoints(this, points);
  }

  rotation() {
    return Matrix.Rotation(this);
  }

  point() {
    return Matrix.ToPoint(this);
  }

  decompose() {
    return Matrix.Decompose(this);
  }

  clone() {
    return new Matrix(this.a, this.b, this.c, this.d, this.e, this.f);
  }

  toDOMMatrix(): DOMMatrix {
    return new DOMMatrix([this.a, this.b, this.c, this.d, this.e, this.f]);
  }

  toCssString() {
    return Matrix.ToCssString(this);
  }

  static Rotate(r: number, cx?: number, cy?: number) {
    if (r === 0) return Matrix.Identity();

    const cosAngle = Math.cos(r);
    const sinAngle = Math.sin(r);

    const rotationMatrix = new Matrix(cosAngle, sinAngle, -sinAngle, cosAngle, 0.0, 0.0);

    if (cx === undefined) return rotationMatrix;

    return Matrix.Compose(Matrix.Translate(cx, cy!), rotationMatrix, Matrix.Translate(-cx, -cy!));
  }

  static Scale: {
    (x: number, y: number): MatrixInit;
    (x: number, y: number, cx: number, cy: number): MatrixInit;
  } = (x: number, y: number, cx?: number, cy?: number) => {
    const scaleMatrix = new Matrix(x, 0, 0, y, 0, 0);

    if (cx === undefined) return scaleMatrix;

    return Matrix.Compose(Matrix.Translate(cx, cy!), scaleMatrix, Matrix.Translate(-cx, -cy!));
  };

  static Multiply(m1: MatrixInit, m2: MatrixInit): MatrixInit {
    return {
      a: m1.a * m2.a + m1.c * m2.b,
      c: m1.a * m2.c + m1.c * m2.d,
      e: m1.a * m2.e + m1.c * m2.f + m1.e,
      b: m1.b * m2.a + m1.d * m2.b,
      d: m1.b * m2.c + m1.d * m2.d,
      f: m1.b * m2.e + m1.d * m2.f + m1.f,
    };
  }

  static Inverse(m: MatrixInit): MatrixInit {
    const denominator = m.a * m.d - m.b * m.c;
    return {
      a: m.d / denominator,
      b: m.b / -denominator,
      c: m.c / -denominator,
      d: m.a / denominator,
      e: (m.d * m.e - m.c * m.f) / -denominator,
      f: (m.b * m.e - m.a * m.f) / denominator,
    };
  }

  static Absolute(m: MatrixInit): MatrixInit {
    const denominator = m.a * m.d - m.b * m.c;
    return {
      a: m.d / denominator,
      b: m.b / -denominator,
      c: m.c / -denominator,
      d: m.a / denominator,
      e: (m.d * m.e - m.c * m.f) / denominator,
      f: (m.b * m.e - m.a * m.f) / -denominator,
    };
  }

  static Compose(...matrices: MatrixInit[]) {
    const matrix = Matrix.Identity();
    for (let i = 0, n = matrices.length; i < n; i++) {
      matrix.multiply(matrices[i]);
    }
    return matrix;
  }

  static Identity() {
    return new Matrix(1.0, 0.0, 0.0, 1.0, 0.0, 0.0);
  }

  static Translate(x: number, y: number) {
    return new Matrix(1.0, 0.0, 0.0, 1.0, x, y);
  }

  static ToPoint(m: MatrixInit): Point {
    return { x: m.e, y: m.f };
  }

  static Rotation(m: MatrixInit): number {
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

  static Decompose(m: MatrixInit) {
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

  static applyToPoint(m: MatrixInit, point: Point) {
    return { x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f };
  }

  static applyToPoints(m: MatrixInit, points: Point[]): Point[] {
    return points.map((point) => ({ x: m.a * point.x + m.c * point.y + m.e, y: m.b * point.x + m.d * point.y + m.f }));
  }

  static From(m: MatrixInit | DOMMatrix) {
    if (m instanceof DOMMatrix) {
      return Matrix.FromDOMMatrix(m);
    }
    return new Matrix(m.a, m.b, m.c, m.d, m.e, m.f);
  }

  static FromDOMMatrix(domMatrix: DOMMatrix): Matrix {
    return new Matrix(domMatrix.a, domMatrix.b, domMatrix.c, domMatrix.d, domMatrix.e, domMatrix.f);
  }

  static ToCssString(m: MatrixInit) {
    return `matrix(${toDOMPrecision(m.a)}, ${toDOMPrecision(m.b)}, ${toDOMPrecision(
      m.c,
    )}, ${toDOMPrecision(m.d)}, ${toDOMPrecision(m.e)}, ${toDOMPrecision(m.f)})`;
  }
}

function clampRotation(radians: number) {
  return (PI2 + radians) % PI2;
}
