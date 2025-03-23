import { describe, expect, test } from 'bun:test';
import * as BVH from '../src/BoundingVolumeHierarchy.ts';

describe('BoundingVolumeHierarchy', () => {
  test('constructor initializes with no rectangles', () => {
    expect(() => BVH.fromRects([])).toThrow();
  });

  test('constructor initializes with one rectangles', () => {
    const bvh = BVH.fromRects([
      {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ]);

    expect(bvh.isLeaf).toBeTrue();
  });

  test('constructor initializes with two rectangles', () => {
    const rects = [
      {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },

      {
        x: 15,
        y: 15,
        width: 10,
        height: 10,
      },
    ];
    const bvh = BVH.fromRects(rects);

    expect(bvh.left?.isLeaf).toBeTrue();
    expect(bvh.right?.isLeaf).toBeTrue();

    expect(bvh.rect).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });

    expect(BVH.intersections(bvh, rects[0]).length).toBe(0);
  });

  test('constructor initializes with three rectangles', () => {
    const rects = [
      {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },

      {
        x: 15,
        y: 15,
        width: 10,
        height: 10,
      },
      {
        x: 5,
        y: 5,
        width: 10,
        height: 10,
      },
    ];
    const bvh = BVH.fromRects(rects);

    expect(bvh.rect).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });

    // console.log(bvh.tree.map((n) => n.toJSON()));

    const c1 = BVH.intersections(bvh, rects[0]);
    expect(c1.length).toBe(1);
    expect(c1[0]).toBe(rects[2]);

    const c2 = BVH.intersections(bvh, rects[2]);
    expect(c2.length).toBe(2);
    expect(c2).toContain(rects[0]);
    expect(c2).toContain(rects[1]);
  });
});
