import type { Point } from './types';
import { lerp } from './utils';

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
  decompose(): DecompsedMatrix;
  clone(): Matrix;
  toCssString(): string;
  toDOMMatrix(): DOMMatrix;
}

export interface DecompsedMatrix {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number;
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
    return this.multiply(Matrix.Translate(x, y));
  }

  scale(x: number, y: number = x) {
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

  lerp(m: MatrixInit, alpha: number) {
    return Matrix.Lerp(this, m, alpha);
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

  static Decompose(m: MatrixInit): DecompsedMatrix {
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

  static Recompose(d: DecompsedMatrix): MatrixInit {
    return this.Identity().translate(d.x, d.y).rotate(d.rotation).scale(d.scaleX, d.scaleY);
  }

  // https://www.w3.org/TR/css-transforms-1/#matrix-interpolation
  static Lerp(m1: MatrixInit, m2: MatrixInit, alpha: number) {
    if (alpha < 0 || alpha > 1) return;

    const d1 = this.Decompose(m1);
    const d2 = this.Decompose(m2);

    return this.Recompose({
      x: lerp(d1.x, d2.x, alpha),
      y: lerp(d1.y, d2.y, alpha),
      scaleX: lerp(d1.scaleX, d2.scaleX, alpha),
      scaleY: lerp(d1.scaleY, d2.scaleY, alpha),
      rotation: lerp(d1.rotation, d2.rotation, alpha),
    });
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

  /**
   * Creates a copy of a DOMMatrix
   * @param source - The source DOMMatrix to copy
   * @returns A new DOMMatrix with the same values
   */
  static copyDOMMatrix(source: DOMMatrix): DOMMatrix {
    const result = new DOMMatrix();
    result.a = source.a;
    result.b = source.b;
    result.c = source.c;
    result.d = source.d;
    result.e = source.e;
    result.f = source.f;
    return result;
  }

  /**
   * Projects a point onto a plane defined by an orthographic 3D transformation matrix.
   * @param point - The point to project onto the plane.
   * @param matrix - The transformation matrix defining the plane.
   * @returns The projected point in the plane's local coordinates.
   * @note Currently assumes 0-0 transform origin.
   */
  static projectPointOntoPlane(point: Point, matrix: DOMMatrix) {
    // Create a ray from camera (assuming orthographic projection)
    const rayOrigin = { x: point.x, y: point.y, z: -1000 }; // Camera positioned behind screen
    const rayDirection = { x: 0, y: 0, z: 1 }; // Pointing forward along z-axis

    const matrixElements = matrix.toFloat32Array();

    // To transform normals correctly with a matrix that includes scaling,
    // we need to use the inverse transpose of the upper 3x3 portion of the matrix
    // Fortunately, for plane normals, we can extract this directly from the inverse matrix
    const inverseMatrix = matrix.inverse();
    const invMatrixElements = inverseMatrix.toFloat32Array();

    // The transformed plane normal is the third row of the inverse matrix (for the Z-normal)
    // Note: We take the 3rd row (not column) of the inverse because of how normals transform
    const planeNormal = {
      x: invMatrixElements[2], // Element [0,2]
      y: invMatrixElements[6], // Element [1,2]
      z: invMatrixElements[10], // Element [2,2]
    };

    // Normalize the normal vector
    const normalLength = Math.sqrt(
      planeNormal.x * planeNormal.x + planeNormal.y * planeNormal.y + planeNormal.z * planeNormal.z,
    );

    if (normalLength < 0.0001) {
      console.warn('Plane normal is too small, defaulting to simple inverse transform');
      // Fall back to the original method if the normal is degenerate
      const pointOnTransformedSpace = inverseMatrix.transformPoint(point);
      return pointOnTransformedSpace;
    }

    planeNormal.x /= normalLength;
    planeNormal.y /= normalLength;
    planeNormal.z /= normalLength;

    // A point on the plane (the transform origin point)
    const planePoint = {
      x: matrixElements[12],
      y: matrixElements[13],
      z: matrixElements[14],
    };

    // Calculate ray-plane intersection
    const dotNormalDirection =
      planeNormal.x * rayDirection.x + planeNormal.y * rayDirection.y + planeNormal.z * rayDirection.z;

    if (Math.abs(dotNormalDirection) < 0.0001) {
      // Ray is parallel to the plane, no intersection
      console.warn('Ray is parallel to plane, no intersection possible');
      return point; // Return original point as fallback
    }

    const dotNormalDifference =
      planeNormal.x * (planePoint.x - rayOrigin.x) +
      planeNormal.y * (planePoint.y - rayOrigin.y) +
      planeNormal.z * (planePoint.z - rayOrigin.z);

    const t = dotNormalDifference / dotNormalDirection;

    // Calculate intersection point in world space
    const intersectionPoint = {
      x: rayOrigin.x + rayDirection.x * t,
      y: rayOrigin.y + rayDirection.y * t,
      z: rayOrigin.z + rayDirection.z * t,
    };

    // Transform the world intersection point to plane local coordinates
    const localPoint = inverseMatrix.transformPoint(
      new DOMPoint(intersectionPoint.x, intersectionPoint.y, intersectionPoint.z),
    );

    // The local point in 2D (x,y) is what we want to return
    const pointOnTransformedSpace = {
      x: localPoint.x,
      y: localPoint.y,
    };

    return pointOnTransformedSpace;
  }

  /**
   * Projects a point from a plane's local coordinates back to screen space.
   * This is the inverse of projectPointOntoPlane.
   * @param planePoint - The point in the plane's local coordinates.
   * @param matrix - The transformation matrix defining the plane.
   * @returns The corresponding screen-space point.
   */
  static projectPointFromPlane(planePoint: Point, matrix: DOMMatrix): Point {
    // Transform the point from the plane's local space to world space
    const worldPoint = matrix.transformPoint(planePoint);

    return {
      x: worldPoint.x,
      y: worldPoint.y,
    };
  }
}

function clampRotation(radians: number) {
  return (PI2 + radians) % PI2;
}
