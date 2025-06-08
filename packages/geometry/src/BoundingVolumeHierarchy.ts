import * as R from './Rect2D.ts';
import * as S from './Shape2D.ts';
import * as V from './Vector2.ts';

// Look into https://github.com/mourner/rbush

export interface BVHLeafNode<T> {
  value: T;
  aabb: R.Rect2D;
  mortonCode: number;
  isLeaf: true;
  left: null;
  right: null;
}

export interface BVHInternalNode<T> {
  value: null;
  aabb: R.Rect2D;
  mortonCode: number;
  isLeaf: false;
  left: BVHNode<T>;
  right: BVHNode<T>;
}

export type BVHNode<T> = BVHInternalNode<T> | BVHLeafNode<T>;

export type BVHNodeReadonly<T> = Readonly<BVHNode<T>>;

export function constructBVHTree<T>(leafNodes: BVHLeafNode<T>[], start: number, end: number): BVHNode<T> {
  if (start === end) return leafNodes[start];

  const mid = Math.floor((start + end) / 2);
  const left = constructBVHTree(leafNodes, start, mid);
  const right = constructBVHTree(leafNodes, mid + 1, end);

  return {
    value: null,
    aabb: R.bounds(left.aabb, right.aabb),
    mortonCode: -1,
    isLeaf: false,
    left,
    right,
  };
}

// The quickest way to construct and query the BVH is to sort the array of rects in-place.
// It also seems to speed up time to check intersections
export function fromShapes(shapes: Array<S.Shape2D>): BVHNode<S.Shape2D> {
  if (shapes.length === 0) {
    return {
      value: S.fromValues(),
      aabb: R.fromValues(),
      mortonCode: -1,
      isLeaf: true,
      left: null,
      right: null,
    };
  }

  const leafNodes: BVHLeafNode<S.Shape2D>[] = shapes.map((shape) => {
    const aabb = S.bounds(shape);

    return {
      value: shape,
      aabb,
      mortonCode: V.mortonCode(R.center(aabb)),
      isLeaf: true,
      left: null,
      right: null,
    };
  });

  // Rectangles sorted in order of their morton codes.
  leafNodes.sort((a, b) => a.mortonCode - b.mortonCode);

  return constructBVHTree(leafNodes, 0, leafNodes.length - 1);
}

export function intersections<T>(root: BVHNode<T>, value: T, rect: R.Rect2D): T[] {
  const stack = [root];
  let node: BVHNode<T> | undefined;
  const collisions: T[] = [];

  while ((node = stack.pop())) {
    if (value === node.value || !R.intersecting(rect, node.aabb)) continue;

    if (node.isLeaf) {
      collisions.push(node.value);
    } else {
      // push right node before left node
      stack.push(node.right, node.left);
    }
  }
  return collisions;
}

export function breathFirstTraverse<T>(root: BVHNode<T>, cb: (node: BVHNode<T>) => boolean | void): void {
  const queue = [root];
  let node: BVHNode<T> | undefined;

  while ((node = queue.shift())) {
    if (cb(node) === false) continue;
    if (!node.isLeaf) queue.push(node.right, node.left);
  }
}

export function depthFirstTraverse<T>(root: BVHNode<T>, cb: (node: BVHNode<T>) => boolean | void): void {
  const stack = [root];
  let node: BVHNode<T> | undefined;

  while ((node = stack.pop())) {
    if (cb(node) === false) continue;
    if (!node.isLeaf) stack.push(node.right, node.left);
  }
}

export function nearestShape(root: BVHNode<S.Shape2D>, shape: S.Shape2D, direction?: V.Vector2): S.Shape2D | undefined {
  const stack = [root];
  let node: BVHNode<S.Shape2D> | undefined;

  const bounds = S.bounds(shape);
  const center = R.center(bounds);
  let distance = Infinity;
  let closestShape: S.Shape2D | undefined;

  while ((node = stack.pop())) {
    const nodeRect = node.aabb;

    if (nodeRect.x + nodeRect.width <= center.x) continue;

    if (node.isLeaf) {
      if (node.value === shape) continue;

      const nearestPoint = R.nearestPointOnRect(nodeRect, center);
      const d = V.distance(center, nearestPoint);

      if (d >= 0 && d < distance) {
        distance = d;
        closestShape = node.value;
      }
    } else {
      stack.push(node.right, node.left);
    }
  }

  return closestShape;
}
