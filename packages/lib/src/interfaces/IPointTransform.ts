import type { Point } from '@folkjs/lib';

export const IPointTransform = Symbol('IPointTransform');
export interface IPointTransform {
  /**
   * Converts a point from parent coordinates to local space coordinates.
   *
   * @param point The point in parent coordinates
   * @returns The point in local space coordinates
   */
  mapPointFromParent(point: Point): Point;

  /**
   * Converts a vector from parent coordinates to local space coordinates.
   * Vectors are affected by scale and rotation, but not by translation.
   *
   * @param vector The vector in parent coordinates
   * @returns The vector in local space coordinates
   */
  mapVectorFromParent(vector: Point): Point;

  /**
   * Converts a point from local space coordinates to parent coordinates.
   *
   * @param point The point in local space coordinates
   * @returns The point in parent coordinates
   */
  mapPointToParent(point: Point): Point;

  /**
   * Converts a vector from local space coordinates to parent coordinates.
   *
   * @param vector The vector in local space coordinates
   * @returns The vector in parent coordinates
   */
  mapVectorToParent(vector: Point): Point;
}
