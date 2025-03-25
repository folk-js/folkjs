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
    const rect = rects[start];
    return { rect, isLeaf: true, left: null, right: null };
  }

  const mid = Math.floor((start + end) / 2);
  const left = constructSubTree(rects, start, mid);
  const right = constructSubTree(rects, mid + 1, end);

  return {
    rect: R.bounds(left.rect, right.rect),
    isLeaf: false,
    left,
    right,
  };
}

export function fromRects2(rects: ReadonlyArray<R.Rect2D>): BVHNode {
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

export function fromRects(rects: Array<R.Rect2D>): BVHNode {
  if (rects.length === 0) throw new Error('Cant create an empty BVH.');

  // Rectangles sorted in order of their morton codes.
  rects.sort((a, b) => V.mortonCode(R.center(a)) - V.mortonCode(R.center(b)));

  return constructSubTree(rects, 0, rects.length - 1);
}

export function intersections(root: BVHNode, rect: R.Rect2D): R.Rect2D[] {
  const stack = [root];
  let node: BVHNode | undefined;
  const collisions: R.Rect2D[] = [];

  while ((node = stack.pop())) {
    const nodeRect = node.rect;
    if (rect === nodeRect || !R.intersecting(rect, nodeRect)) continue;

    if (node.isLeaf) {
      collisions.push(nodeRect);
    } else {
      // push right node before left node
      stack.push(node.right, node.left);
    }
  }
  return collisions;
}

export function closestRectLeft(root: BVHNode, point: V.Vector2): R.Rect2D | undefined {
  const stack = [root];
  let node: BVHNode | undefined;
  let distance = Infinity;
  let rect: R.Rect2D | undefined;

  while ((node = stack.pop())) {
    if (node.isLeaf) {
    } else {
      // push right node before left node
      stack.push(node.right, node.left);
    }
  }

  return rect;
}
