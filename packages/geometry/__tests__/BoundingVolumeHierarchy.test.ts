import { describe, expect, test } from 'bun:test';
import { BoundingVolumeHierarchy } from '../src/BoundingVolumeHierarchy.ts';

describe('BoundingVolumeHierarchy', () => {
  test('constructor initializes with no rectangles', () => {
    const bvh = new BoundingVolumeHierarchy([]);

    expect(bvh.root).toBeUndefined();
  });

  test('constructor initializes with one rectangles', () => {
    const bvh = new BoundingVolumeHierarchy([
      {
        x: 0,
        y: 0,
        width: 10,
        height: 10,
      },
    ]);

    expect(bvh.root).toBeDefined();
    expect(bvh.root?.isLeaf).toBeTrue();
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
    const bvh = new BoundingVolumeHierarchy(rects);

    expect(bvh.root).toBeDefined();
    expect(bvh.root?.left?.isLeaf).toBeTrue();
    expect(bvh.root?.right?.isLeaf).toBeTrue();

    expect(bvh.root!.rect).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });

    expect(bvh.collisions(rects[0]).length).toBe(0);
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
    const bvh = new BoundingVolumeHierarchy(rects);

    expect(bvh.root).toBeDefined();

    expect(bvh.root!.rect).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });

    // console.log(bvh.tree.map((n) => n.toJSON()));

    const c1 = bvh.collisions(rects[0]);
    expect(c1.length).toBe(1);
    expect(c1[0]).toBe(rects[2]);

    const c2 = bvh.collisions(rects[2]);
    expect(c2.length).toBe(2);
    expect(c2).toContain(rects[0]);
    expect(c2).toContain(rects[1]);
  });
});
