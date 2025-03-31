import { atan2, cos, hypot, sin } from './utilities.ts';

export type Vector2 = {
  x: number;
  y: number;
};

export type Vector2Readonly = Readonly<Vector2>;

export type Point = Vector2;

/**
 * Creates a zero vector (0,0)
 * @returns A Vector2 representing a zero vector
 */
export function zero(): Vector2 {
  return { x: 0, y: 0 };
}

/**
 * Unit vector Vector2ing right (1,0)
 * @returns A Vector2 representing a right vector
 */
export function right(): Vector2 {
  return { x: 1, y: 0 };
}

/**
 * Unit vector Vector2ing left (-1,0)
 * @returns A Vector2 representing a left vector
 */
export function left(): Vector2 {
  return { x: -1, y: 0 };
}

/**
 * Unit vector Vector2ing up (0,-1)
 * @returns A Vector2 representing an up vector
 */
export function up(): Vector2 {
  return { x: 0, y: -1 };
}

/**
 * Unit vector Vector2ing down (0,1)
 * @returns A Vector2 representing a down vector
 */
export function down(): Vector2 {
  return { x: 0, y: 1 };
}

/**
 * Subtracts vector b from vector a
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The vector to subtract
 * @returns The resulting vector
 */
export function subtract(a: Vector2Readonly, b: Vector2Readonly): Vector2 {
  return { x: a.x - b.x, y: a.y - b.y };
}

/**
 * Adds two vectors together
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns The sum of the two vectors
 */
export function add(a: Vector2Readonly, b: Vector2Readonly): Vector2 {
  return { x: a.x + b.x, y: a.y + b.y };
}

/**
 * Multiplies two vectors component-wise
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns The component-wise product of the two vectors
 */
export function multiply(a: Vector2Readonly, b: Vector2Readonly): Vector2 {
  return { x: a.x * b.x, y: a.y * b.y };
}

/**
 * Scales a vector by a scalar value
 * @param {Vector2} v - The vector to scale
 * @param {number} scaleFactor - The scaling factor
 * @returns The scaled vector
 */
export function scale(v: Vector2Readonly, scaleFactor: number): Vector2 {
  return { x: v.x * scaleFactor, y: v.y * scaleFactor };
}

/**
 * Calculates the magnitude (length) of a vector
 * @param {Vector2} v - The vector
 * @returns The magnitude of the vector
 */
export function magnitude(v: Vector2Readonly): number {
  return Math.sqrt(v.x * v.x + v.y * v.y);
}

/**
 * Calculates the cross product of two vectors
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns The cross product of the two vectors
 */
export function cross(a: Vector2Readonly, b: Vector2Readonly): number {
  return a.x * b.y - a.y * b.x;
}

/**
 * Returns a normalized (unit) vector in the same direction
 * @param {Vector2} v - The vector to normalize
 * @returns The normalized vector
 */
export function normalized(v: Vector2Readonly): Vector2 {
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
export function normal(v: Vector2Readonly): Vector2 {
  return { x: -v.y, y: v.x };
}

/**
 * Calculates the dot product of two vectors
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector
 * @returns {number} The dot product of the two vectors
 */
export function dotProduct(a: Vector2Readonly, b: Vector2Readonly): number {
  return a.x * b.x + a.y * b.y;
}

/**
 * Calculates the Euclidean distance between two Vector2s
 * @param {Vector2} a - The first Vector2
 * @param {Vector2} b - The second Vector2
 * @returns {number} The distance between the Vector2s
 */
export function distance(a: Vector2Readonly, b: Vector2Readonly): number {
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
export function distanceSquared(a: Vector2Readonly, b: Vector2Readonly): number {
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
export function lerp(a: Vector2Readonly, b: Vector2Readonly, t: number): Vector2 {
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
export function rotate(v: Vector2Readonly, angle: number): Vector2 {
  const _cos = cos(angle);
  const _sin = sin(angle);
  return {
    x: v.x * _cos - v.y * _sin,
    y: v.x * _sin + v.y * _cos,
  };
}

/**
 * Rotates a Vector2 around a pivot Vector2 by a given angle (in radians), **clockwise**
 * @param {Vector2} Vector2 - The Vector2 to rotate
 * @param {Vector2} pivot - The Vector2 to rotate around
 * @param {number} angle - The angle in radians
 * @returns The rotated Vector2
 */
export function rotateAround(v: Vector2Readonly, pivot: Vector2Readonly, angle: number): Vector2 {
  const dx = v.x - pivot.x;
  const dy = v.y - pivot.y;
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
export function angle(v: Vector2Readonly): number {
  return atan2(v.y, v.x);
}

/**
 * Calculates the angle (in radians) between two vectors
 * @param {Vector2} a - The first vector
 * @param {Vector2} b - The second vector (optional, defaults to positive x-axis unit vector)
 * @returns {number} The angle in radians
 */
export function angleTo(a: Vector2Readonly, b: Vector2Readonly = { x: 1, y: 0 }): number {
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
export function angleFromOrigin(Vector2: Vector2Readonly, origin: Vector2Readonly): number {
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
export function magSquared(v: Vector2Readonly): number {
  return v.x * v.x + v.y * v.y;
}

/**
 * Calculates the bounding box of a set of Vector2s
 * @param {Vector2[]} Vector2s - Array of Vector2s to find bounds for
 * @returns Object containing min and max Vector2s of the bounds
 */
export function bounds(vs: ReadonlyArray<Vector2Readonly>) {
  const x = vs.map((v) => v.x);
  const y = vs.map((v) => v.y);

  return {
    minX: Math.min.apply(null, x),
    maxX: Math.max.apply(null, x),
    minY: Math.min.apply(null, y),
    maxY: Math.max.apply(null, y),
  };
}

/**
 * Calculates the center Vector2 of a set of Vector2s
 * @param {Vector2[]} Vector2s - Array of Vector2s to find center for
 * @returns The center Vector2
 */
export function center(...vs: Vector2Readonly[]): Vector2 {
  const { minX, maxX, minY, maxY } = bounds(vs);
  return {
    x: (minX + maxX) / 2,
    y: (minY + maxY) / 2,
  };
}

/**
 * Projects a Vector2 onto an axis
 * @param {Vector2} Vector2 - The Vector2 to project
 * @param {Vector2} axis - The axis to project onto
 * @returns The projected Vector2
 */
export function project(v: Vector2Readonly, axis: Vector2Readonly): Vector2 {
  const n = normalized(axis);
  const dot = v.x * n.x + v.y * n.y;
  return scale(n, dot);
}

/**
 * Clone a vector
 * @param v
 * @returns a cloned vector
 */
export function clone(v: Vector2Readonly): Vector2 {
  return { x: v.x, y: v.y };
}

// Morton codes ported from  https://github.com/liamdon/fast-morton

/**
 *
 * @param coord single coord (x/y/z)
 * @returns component with bits shifted into place
 */
function morton2DSplitBy2bits(coord: number) {
  let x = coord & 0xffffffff;
  x = (x | (x << 16)) & 0x0000ffff;
  x = (x | (x << 8)) & 0x00ff00ff;
  x = (x | (x << 4)) & 0x0f0f0f0f;
  x = (x | (x << 2)) & 0x33333333;
  x = (x | (x << 1)) & 0x55555555;
  return x;
}

/**
 * Encode a 2D point as a morton code.
 * @param x X coordinate (up to 15 bits: 0-32,767)
 * @param y Y coordinate (up to 15 bits: 0-32,767)
 * @returns 32-bit 2D Morton code
 */
export function mortonCode({ x, y }: Vector2Readonly): number {
  if (x < 0 || x > 32_767 || (y < 0 && y > 32_767)) {
    throw new Error('All input coords must be in Uint15 range (0 - 32,767)');
  }
  return morton2DSplitBy2bits(x) | (morton2DSplitBy2bits(y) << 1);
}
