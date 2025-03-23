import { Point } from './types';

interface DOMTransformInit {
  x?: number;
  y?: number;
  rotationX?: number;
  rotationY?: number;
  rotationZ?: number;
}

/**
 * Represents a 2D transform with position and rotation,
 * capable of transforming points between local and parent coordinate spaces.
 */
export class DOMTransform {
  // Private properties for position and rotation
  #x: number;
  #y: number;
  #rotationX: number;
  #rotationY: number;
  #rotationZ: number;

  // Internal transformation matrices
  #transformMatrix: DOMMatrix;
  #inverseMatrix: DOMMatrix;

  constructor(init: DOMTransformInit = {}) {
    this.#x = init.x ?? 0;
    this.#y = init.y ?? 0;
    this.#rotationX = init.rotationX ?? 0;
    this.#rotationY = init.rotationY ?? 0;
    this.#rotationZ = init.rotationZ ?? 0;

    // Initialize with identity matrices
    this.#transformMatrix = new DOMMatrix();
    this.#inverseMatrix = new DOMMatrix();

    this.#updateMatrices();
  }

  get x(): number {
    return this.#x;
  }
  set x(value: number) {
    this.#x = value;
    this.#updateMatrices();
  }

  get y(): number {
    return this.#y;
  }
  set y(value: number) {
    this.#y = value;
    this.#updateMatrices();
  }

  get rotationX(): number {
    return this.#rotationX;
  }
  set rotationX(value: number) {
    this.#rotationX = value;
    this.#updateMatrices();
  }

  get rotationY(): number {
    return this.#rotationY;
  }
  set rotationY(value: number) {
    this.#rotationY = value;
    this.#updateMatrices();
  }

  get rotationZ(): number {
    return this.#rotationZ;
  }
  set rotationZ(value: number) {
    this.#rotationZ = value;
    this.#updateMatrices();
  }

  get rotation(): number {
    return this.#rotationZ;
  }
  set rotation(value: number) {
    this.#rotationZ = value;
    this.#updateMatrices();
  }

  // Matrix accessors
  get matrix(): DOMMatrix {
    return this.#transformMatrix;
  }
  get inverse(): DOMMatrix {
    return this.#inverseMatrix;
  }

  /**
   * Converts a point from parent space to local space.
   */
  toPoint(point: Point): Point {
    // Transform using DOMMatrix directly without DOMPoint
    const { a, b, c, d, e, f } = this.#inverseMatrix;
    return {
      x: point.x * a + point.y * c + e,
      y: point.x * b + point.y * d + f,
    };
  }

  /**
   * Converts a point from local space to parent space.
   */
  toInversePoint(point: Point): Point {
    const { a, b, c, d, e, f } = this.#transformMatrix;
    return {
      x: point.x * a + point.y * c + e,
      y: point.x * b + point.y * d + f,
    };
  }

  /**
   * Generates a CSS transform string representing the transformation.
   */
  toCssString(): string {
    return this.#transformMatrix.toString();
  }

  /**
   * Converts the transform's properties to a JSON serializable object.
   */
  toJSON() {
    return {
      x: this.x,
      y: this.y,
      rotationX: this.rotationX,
      rotationY: this.rotationY,
      rotationZ: this.rotationZ,
    };
  }

  /**
   * Updates the transformation matrices based on the current position and rotation.
   */
  #updateMatrices() {
    // Create a fresh identity matrix
    this.#transformMatrix = new DOMMatrix()
      .translate(this.#x, this.#y)
      .rotate(0, 0, this.#rotationZ)
      .rotate(0, this.#rotationY, 0)
      .rotate(this.#rotationX, 0, 0);

    // DOMMatrix has built-in inverse calculation
    this.#inverseMatrix = this.#transformMatrix.inverse();
  }
}
