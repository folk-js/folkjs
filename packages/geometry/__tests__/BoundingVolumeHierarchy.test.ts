import { expect } from 'expect';
import { describe, test } from 'node:test';
import * as BVH from '../src/BoundingVolumeHierarchy.ts';
import * as R from '../src/Rect2D.ts';
import * as S from '../src/Shape2D.ts';
import * as V from '../src/Vector2.ts';

describe('BoundingVolumeHierarchy', () => {
  test('constructor initializes with no rectangles', () => {
    expect(BVH.fromShapes([])).toStrictEqual({
      value: S.fromValues(),
      aabb: R.fromValues(),
      mortonCode: -1,
      isLeaf: true,
      left: null,
      right: null,
    });
  });

  test('initialize BVH with one rectangles', () => {
    const bvh = BVH.fromShapes([S.fromValues(0, 0, 10, 10)]);

    expect(bvh.isLeaf).toBe(true);
  });

  test('initializes BVH with two rectangles', () => {
    const shapes = [S.fromValues(0, 0, 10, 10), S.fromValues(15, 15, 10, 10)];
    const bvh = BVH.fromShapes(shapes);

    expect(bvh.left?.isLeaf).toBe(true);
    expect(bvh.right?.isLeaf).toBe(true);

    expect(bvh.aabb).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });

    expect(BVH.intersections(bvh, shapes[0], S.boundingBox(shapes[0])).length).toBe(0);
  });

  const shapes = [S.fromValues(0, 0, 10, 10), S.fromValues(15, 15, 10, 10), S.fromValues(5, 5, 10, 10)];

  test('initialize BVH with three rectangles', () => {
    const bvh = BVH.fromShapes([...shapes]);

    expect(bvh.aabb).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });
  });

  test('intersection', () => {
    const bvh = BVH.fromShapes([...shapes]);

    const c1 = BVH.intersections(bvh, shapes[0], S.boundingBox(shapes[0]));
    expect(c1.length).toBe(1);
    expect(c1).toContain(shapes[2]);

    const c2 = BVH.intersections(bvh, shapes[2], S.boundingBox(shapes[2]));
    expect(c2.length).toBe(2);
    expect(c2).toContain(shapes[0]);
    expect(c2).toContain(shapes[1]);
  });

  describe('nearest neighbor', () => {
    test('nearest right overlap', () => {
      const bvh = BVH.fromShapes([...shapes]);

      const neighbor = BVH.nearestShape(bvh, shapes[2], V.right());
      expect(neighbor).toEqual(shapes[1]);
    });

    test('nearest right inside', () => {
      const bvh = BVH.fromShapes([...shapes]);

      const neighbor = BVH.nearestShape(bvh, shapes[0], V.right());
      expect(neighbor).toEqual(shapes[2]);
    });
  });
});
