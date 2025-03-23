import { bench, run } from 'mitata';
import * as BVH from '../src/BoundingVolumeHierarchy.ts';
import { BVHNode } from '../src/BoundingVolumeHierarchy.ts';
import { Rect2D } from '../src/Rect2D';

function createRandomShapes(length: number): Rect2D[] {
  return Array.from({ length }).map(() => ({
    x: Math.random() * 1000,
    y: Math.random() * 1000,
    width: Math.random() * 1000,
    height: Math.random() * 1000,
  }));
}

const shapes3 = createRandomShapes(3);
let bvh3: BVH.BVHNode;

bench('BVH: instantiate 3 shapes', () => {
  bvh3 = BVH.fromRects(shapes3);
});

bench('BVH: collsion 3 shapes', () => {
  BVH.intersections(bvh3, shapes3[0]);
});

const shapes100 = createRandomShapes(100);
let bvh100: BVHNode;

bench('BVH: instantiate 100 shapes', () => {
  bvh100 = BVH.fromRects(shapes100);
});

bench('BVH: check collsion 100 shapes', () => {
  BVH.intersections(bvh100, shapes100[0]);
});

const shapes1000 = createRandomShapes(1000);
let bvh1000: BVHNode;

bench('BVH: instantiate 1000 shapes', () => {
  bvh1000 = BVH.fromRects(shapes1000);
});

bench('BVH: check collsion 1000 shapes', () => {
  BVH.intersections(bvh1000, shapes1000[0]);
});

const shapes10000 = createRandomShapes(10000);
let bvh10000: BVHNode;

bench('BVH: instantiate 10000 shapes', () => {
  bvh10000 = BVH.fromRects(shapes10000);
});

bench('BVH: check collsion 10000 shapes', () => {
  BVH.intersections(bvh10000, shapes10000[0]);
});

bench('BVH: instantiate 10000 shapes and check one collision', () => {
  const bvh10000 = BVH.fromRects(shapes10000);
  BVH.intersections(bvh10000, shapes10000[0]);
});

await run();
