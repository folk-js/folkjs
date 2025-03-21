import * as R from './Rect2D.js';
import type { Vector2Readonly } from './Vector2.js';

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
function morton2DEncode({ x, y }: Vector2Readonly): number {
  if (x < 0 || x > 32_767 || (y < 0 && y > 32_767)) {
    throw new Error('All input coords must be in Uint15 range (0 - 32,767)');
  }
  return morton2DSplitBy2bits(x) | (morton2DSplitBy2bits(y) << 1);
}

interface MortonItem {
  mortonCode: number;
  rect: R.Rect2D;
}

type BVHNode =
  | {
      rect: R.Rect2D;
      isLeaf: false;
      left: BVHNode;
      right: BVHNode;
    }
  | {
      rect: R.Rect2D;
      isLeaf: true;
      left: undefined;
      right: undefined;
    };

export class BoundingVolumeHierarchy {
  #root: BVHNode | undefined;

  get root() {
    return this.#root;
  }

  constructor(rects: ReadonlyArray<R.Rect2D>) {
    this.#root = this.#constructTree(rects);
  }

  #constructTree(rects: ReadonlyArray<R.Rect2D>) {
    const len = rects.length;

    if (len === 0) return;

    const mortonCodes: MortonItem[] = [];

    for (let i = 0; i < len; i++) {
      const rect = rects[i]!;
      // TODO: we need to normalize this point between [0, 32767]
      const normalizedCenter = R.center(rect);

      mortonCodes.push({ rect, mortonCode: morton2DEncode(normalizedCenter) });
    }

    // Rectangles sorted in order of morton codes.
    const sortedRects = mortonCodes.sort((a, b) => a.mortonCode - b.mortonCode).map((b) => b.rect);

    return this.#constructSubTree(sortedRects, 0, mortonCodes.length - 1);
  }

  #constructSubTree(rects: readonly R.Rect2D[], start: number, end: number): BVHNode {
    if (start >= end) {
      const rect = rects[start]!;
      return { rect, isLeaf: true, left: undefined, right: undefined };
    }

    const mid = Math.floor((start + end) / 2);
    const left = this.#constructSubTree(rects, start, mid);
    const right = this.#constructSubTree(rects, mid + 1, end);
    const leftRect = left.rect;
    const rightRect = right.rect;
    const x = Math.min(leftRect.x, rightRect.x);
    const y = Math.min(leftRect.y, rightRect.y);

    return {
      isLeaf: false,
      left,
      right,
      rect: {
        x,
        y,
        width: Math.max(leftRect.x + leftRect.width, rightRect.x + rightRect.width) - x,
        height: Math.max(leftRect.y + leftRect.height, rightRect.y + rightRect.height) - y,
      },
    };
  }

  // collisions2(rect: R.Rect2D): R.Rect2D[] {
  //   if (this.#root === undefined) return [];

  //   const collisions: R.Rect2D[] = [];
  //   this.#collisions(rect, this.#root, collisions);
  //   return collisions;
  // }

  // #collisions(rect: R.Rect2D, node: BVHNode, collisions: R.Rect2D[]) {
  //   if (rect === node.rect || !R.aabbIntersection(rect, node.rect)) return;

  //   if (node.isLeaf) {
  //     collisions.push(node.rect);
  //     return;
  //   }

  //   this.#collisions(rect, node.left, collisions);
  //   this.#collisions(rect, node.right, collisions);
  // }

  collisions(rect: R.Rect2D): R.Rect2D[] {
    if (this.#root === undefined) return [];

    const stack = [this.#root];
    const collisions: R.Rect2D[] = [];

    while (stack.length > 0) {
      const node = stack.pop()!;
      if (rect === node.rect || !R.aabbIntersection(rect, node.rect)) continue;

      if (node.isLeaf) {
        collisions.push(node.rect);
        continue;
      }

      // push right node before left node
      stack.push(node.right, node.left);
    }

    return collisions;
  }
}
