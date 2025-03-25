import { satisfies } from "./interfaces/InterfaceKey";
import { IPointTransform } from "./interfaces/IPointTransform";
import type { Point } from "./types";

/**
 * A class that manages a stack of transformations and provides methods
 * to convert coordinates between different spaces.
 */
export class TransformStack {
  private transforms: IPointTransform[] = [];

  /**
   * Creates a new TransformStack with the given transforms
   * @param transforms The transforms to include, ordered from parent to child
   */
  constructor(transforms: IPointTransform[] = []) {
    this.transforms = [...transforms];
  }

  /**
   * Maps a point from the top-most parent space to the bottom-most local space
   * @param point The point in parent coordinates
   * @returns The point in local coordinates
   */
  mapPointToLocal(point: Point): Point {
    let result = { ...point };

    // Apply transforms in reverse order (from parent to local)
    for (let i = this.transforms.length - 1; i >= 0; i--) {
      result = this.transforms[i].mapPointFromParent(result);
    }

    return result;
  }

  /**
   * Maps a point from the bottom-most local space to the top-most parent space
   * @param point The point in local coordinates
   * @returns The point in parent coordinates
   */
  mapPointToParent(point: Point): Point {
    let result = { ...point };

    // Apply transforms in order (from local to parent)
    for (let i = 0; i < this.transforms.length; i++) {
      result = this.transforms[i].mapPointToParent(result);
    }

    return result;
  }

  /**
   * Maps a vector from the top-most parent space to the bottom-most local space
   * @param vector The vector in parent coordinates
   * @returns The vector in local coordinates
   */
  mapVectorToLocal(vector: Point): Point {
    let result = { ...vector };

    // Apply transforms in reverse order (from parent to local)
    for (let i = this.transforms.length - 1; i >= 0; i--) {
      result = this.transforms[i].mapVectorFromParent(result);
    }

    return result;
  }

  /**
   * Maps a vector from the bottom-most local space to the top-most parent space
   * @param vector The vector in local coordinates
   * @returns The vector in parent coordinates
   */
  mapVectorToParent(vector: Point): Point {
    let result = { ...vector };

    // Apply transforms in order (from local to parent)
    for (let i = 0; i < this.transforms.length; i++) {
      result = this.transforms[i].mapVectorToParent(result);
    }

    return result;
  }

  /**
   * Creates a transform stack by walking up the DOM tree from the given element
   * @param element The element to start from (usually the deepest child)
   * @returns A new TransformStack with all transforms in the hierarchy
   */
  static fromElement(element: Element): TransformStack {
    const transforms: IPointTransform[] = [];
    let current: Element | null = element;

    // Walk up the DOM tree and collect all transforms
    while (current) {
      if (satisfies(current, IPointTransform) && current !== element) {
        transforms.unshift(current);
      }
      current = current.parentElement;
    }

    return new TransformStack(transforms);
  }
}
