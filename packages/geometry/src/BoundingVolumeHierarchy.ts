import * as R from './Rect2D.js';
import * as V from './Vector2.js';

interface MortonItem {
  mortonCode: number;
  rect: R.Rect2D;
}

export type BVHNode =
  | {
      rect: R.Rect2D;
      isLeaf: false;
      left: BVHNode;
      right: BVHNode;
    }
  | {
      rect: R.Rect2D;
      isLeaf: true;
      left: null;
      right: null;
    };

function constructSubTree(rects: readonly R.Rect2D[], start: number, end: number): BVHNode {
  if (start >= end) {
    const rect = rects[start]!;
    return { rect, isLeaf: true, left: null, right: null };
  }

  const mid = Math.floor((start + end) / 2);
  const left = constructSubTree(rects, start, mid);
  const right = constructSubTree(rects, mid + 1, end);

  return {
    isLeaf: false,
    left,
    right,
    rect: R.bounds(left.rect, right.rect),
  };
}

export function fromRects(rects: ReadonlyArray<R.Rect2D>): BVHNode {
  const len = rects.length;

  if (len === 0) throw new Error('Cant create an empty BVH.');

  const mortonCodes: MortonItem[] = [];

  for (let i = 0; i < len; i++) {
    const rect = rects[i]!;
    // TODO: we need to normalize this point between [0, 32767]
    const normalizedCenter = R.center(rect);

    mortonCodes.push({ rect, mortonCode: V.mortonCode(normalizedCenter) });
  }

  // Rectangles sorted in order of morton codes.
  const sortedRects = mortonCodes.sort((a, b) => a.mortonCode - b.mortonCode).map((b) => b.rect);

  return constructSubTree(sortedRects, 0, mortonCodes.length - 1);
}

export function intersections(root: BVHNode, rect: R.Rect2D): R.Rect2D[] {
  const stack = [root];
  const collisions: R.Rect2D[] = [];

  while (stack.length > 0) {
    const node = stack.pop()!;
    if (rect === node.rect || !R.intersecting(rect, node.rect)) continue;

    if (node.isLeaf) {
      collisions.push(node.rect);
    } else {
      // push right node before left node
      stack.push(node.right, node.left);
    }
  }

  return collisions;
}

function intersectionHelper(rect: R.Rect2D, node: BVHNode, collisions: R.Rect2D[]) {
  if (rect === node.rect || !R.intersecting(rect, node.rect)) return;

  if (node.isLeaf) {
    collisions.push(node.rect);
  } else {
    intersectionHelper(rect, node.left, collisions);
    intersectionHelper(rect, node.right, collisions);
  }
}

export function intersectionRecursion(root: BVHNode, rect: R.Rect2D): R.Rect2D[] {
  const collisions: R.Rect2D[] = [];
  intersectionHelper(rect, root, collisions);
  return collisions;
}
