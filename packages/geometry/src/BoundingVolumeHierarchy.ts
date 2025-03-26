import * as R from './Rect2D.ts';
import * as V from './Vector2.ts';

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

export type BVHNodeReadonly = Readonly<BVHNode>;

function constructSubTree(rects: readonly R.Rect2D[], start: number, end: number): BVHNode {
  if (start >= end) return { rect: rects[start], isLeaf: true, left: null, right: null };

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

// The quickest way to construct and query the BVH is to sort the array of rects in-place.
// It also seems to speed up time to check intersections
export function fromRects(rects: Array<R.Rect2D>): BVHNode {
  if (rects.length === 0) {
    return {
      rect: R.fromValues(),
      isLeaf: true,
      left: null,
      right: null,
    };
  }

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

export function traverse(root: BVHNode, cb: (node: BVHNode) => boolean | void): void {
  const stack = [root];
  let node: BVHNode | undefined;

  while ((node = stack.pop())) {
    if (cb(node) === false) continue;

    if (!node.isLeaf) {
      // push right node before left node
      stack.push(node.right, node.left);
    }
  }
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
