import { atan2, cos, hypot, sin } from './utilities.js';

export type Vector2 = {
  x: number;
  y: number;
};

export type Vector2Readonly = Readonly<Vector2>;

/**
 * Creates a zero vector (0,0)
 * @returns A Vector2 representing a zero vector
 */
export function fromZero(): Vector2 {
  return { x: 0, y: 0 };
}

/**
 * Unit vector Vector2ing right (1,0)
 * @returns A Vector2 representing a right vector
 */
export function fromRight(): Vector2 {
  return { x: 1, y: 0 };
}

/**
 * Unit vector Vector2ing left (-1,0)
 * @returns A Vector2 representing a left vector
 */
export function fromLeft(): Vector2 {
  return { x: -1, y: 0 };
}

/**
 * Unit vector Vector2ing up (0,-1)
 * @returns A Vector2 representing an up vector
 */
export function fromUp(): Vector2 {
  return { x: 0, y: -1 };
}

/**
 * Unit vector Vector2ing down (0,1)
 * @returns A Vector2 representing a down vector
 */
export function fromDown(): Vector2 {
  return { x: 0, y: 1 };
}

/**
 * Subtracts vector b from vector a
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The vector to subtract
 * @returns The resulting vector
 */
export function subtract(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Adds two vectors together
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns The sum of the two vectors
 */
export function add(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Multiplies two vectors component-wise
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns The component-wise product of the two vectors
 */
export function multiply(a: Vector2, b: Vector2): Vector2 {
  return { x: a.x * b.x, y: a.y * b.y };
}

/**
 * Scales a vector by a scalar value
 * @param {Vector2} v - The vector to scale
 * @param {number} scaleFactor - The scaling factor
 * @returns The scaled vector
 */
export function scale(v: Vector2, scaleFactor: number): Vector2 {
  return { x: v.x * scaleFactor, y: v.y * scaleFactor };
}

/**
 * Calculates the magnitude (length) of a vector
 * @param {Vector2} v - The vector
 * @returns The magnitude of the vector
 */
export function magnitude(v: Vector2): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Calculates the cross product of two vectors
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns The cross product of the two vectors
 */
export function cross(a: Vector2, b: Vector2): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Returns a normalized (unit) vector in the same direction
 * @param {Vector2} v - The vector to normalize
 * @returns The normalized vector
 */
export function normalized(v: Vector2): Vector2 {
  const { x, y } = v;
  const magnitude = hypot(x, y);
  if (magnitude === 0) return { x: 0, y: 0 };
  const invMag = 1 / magnitude;
  return { x: x * invMag, y: y * invMag };
}

/**
 * Returns a vector perpendicular to the given vector
 * @param {Vector2} v - The vector to get the perpendicular of
 * @returns The perpendicular vector
 */
export function normal(v: Vector2): Vector2 {
  return { x: -v.y, y: v.x };
}

/**
 * Calculates the dot product of two vectors
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns {number} The dot product of the two vectors
 */
export function dotProduct(a: Vector2, b: Vector2): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Calculates the Euclidean distance between two Vector2s
 * @param {Vector2} a - The first Vector2
 * @param {Vector2} b - The second Vector2
 * @returns {number} The distance between the Vector2s
 */
export function distance(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Calculates the squared distance between two Vector2s
 * Useful for performance when comparing distances
 * @param {Vector2} a - The first Vector2
 * @param {Vector2} b - The second Vector2
 * @returns {number} The squared distance between the Vector2s
 */
export function distanceSquared(a: Vector2, b: Vector2): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Linearly interpolates between two `Vector2`s
 * @param {Vector2} a - The starting Vector2
 * @param {Vector2} b - The ending Vector2
 * @param {number} t - The interpolation parameter (0-1)
 * @returns The interpolated Vector2
 */
export function lerp(a: Vector2, b: Vector2, t: number): Vector2 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
  };
}

/**
 * Rotates a vector by a given angle (in radians)
 * @param {Vector2} v - The vector to rotate
 * @param {number} angle - The angle in radians
 * @returns The rotated vector
 */
export function rotate(v: Vector2, angle: number): Vector2 {
  const _cos = cos(angle);
  const _sin = sin(angle);
  return {
    x: v.x * _cos - v.y * _sin,
    y: v.x * _sin + v.y * _cos,
  };
}

/**
 * Rotates a Vector2 around a pivot Vector2 by a given angle (in radians)
 * @param {Vector2} Vector2 - The Vector2 to rotate
 * @param {Vector2} pivot - The Vector2 to rotate around
 * @param {number} angle - The angle in radians
 * @returns The rotated Vector2
 */
export function rotateAround(Vector2: Vector2, pivot: Vector2, angle: number): Vector2 {
  const dx = Vector2.x - pivot.x;
  const dy = Vector2.y - pivot.y;
  const c = cos(angle);
  const s = sin(angle);
  return {
    x: pivot.x + dx * c - dy * s,
    y: pivot.y + dx * s + dy * c,
  };
}

/**
 * Calculates the angle (in radians) between the vector and the positive x-axis
 * @param {Vector2} v - The vector
 * @returns {number} The angle in radians
 */
export function angle(v: Vector2): number {
  return atan2(v.y, v.x);
}

/**
 * Calculates the angle (in radians) between two vectors
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector (optional, defaults to positive x-axis unit vector)
 * @returns {number} The angle in radians
 */
export function angleTo(a: Vector2, b: Vector2 = { x: 1, y: 0 }): number {
  // Get the angle of each vector relative to x-axis
  const angleA = angle(a);
  const angleB = angle(b);

  // Return the difference
  return angleA - angleB;
}

/**
 * Calculates the angle between a Vector2 and a center Vector2 relative to the positive x-axis
 * @param {Vector2} Vector2 - The Vector2 to measure from
 * @param {Vector2} origin - The origin Vector2 to measure around
 * @returns {number} The angle in radians
 */
export function angleFromOrigin(Vector2: Vector2, origin: Vector2): number {
  return angleTo({
    x: Vector2.x - origin.x,
    y: Vector2.y - origin.y,
  });
}

/**
 * Calculates the squared magnitude of a vector
 * @param {Vector2} v - The vector
 * @returns {number} The squared magnitude of the vector
 */
export function magSquared(v: Vector2): number {
  return v.x * v.x + v.y * v.y;
}

/**
 * Calculates the bounding box of a set of Vector2s
 * @param {Vector2[]} Vector2s - Array of Vector2s to find bounds for
 * @returns {{ min: Vector2, max: Vector2 }} Object containing min and max Vector2s of the bounds
 */
export function bounds(Vector2s: Vector2[]): { min: Vector2; max: Vector2 } {
  return Vector2s.reduce(
    (acc, p) => ({
      min: { x: Math.min(acc.min.x, p.x), y: Math.min(acc.min.y, p.y) },
      max: { x: Math.max(acc.max.x, p.x), y: Math.max(acc.max.y, p.y) },
    }),
    { min: { x: Infinity, y: Infinity }, max: { x: -Infinity, y: -Infinity } },
  );
}

/**
 * Calculates the center Vector2 of a set of Vector2s
 * @param {Vector2[]} Vector2s - Array of Vector2s to find center for
 * @returns The center Vector2
 */
export function center(Vector2s: Vector2[]): Vector2 {
  const { min, max } = bounds(Vector2s);
  return {
    x: (min.x + max.x) / 2,
    y: (min.y + max.y) / 2,
  };
}

/**
 * Projects a Vector2 onto an axis
 * @param {Vector2} Vector2 - The Vector2 to project
 * @param {Vector2} axis - The axis to project onto
 * @returns The projected Vector2
 */
export function project(Vector2: Vector2, axis: Vector2): Vector2 {
  const n = normalized(axis);
  const dot = Vector2.x * n.x + Vector2.y * n.y;
  return scale(n, dot);
}
