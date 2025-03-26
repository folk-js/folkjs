import { bench, do_not_optimize, run } from '@folkjs/repo-utils';
import type { BVHNode } from '../src/BoundingVolumeHierarchy.ts';
import * as BVH from '../src/BoundingVolumeHierarchy.ts';
import type { Rect2D } from '../src/Rect2D.ts';

function createRandomShapes(length: number): Rect2D[] {
  return Array.from({ length }).map(() => ({
    x: Math.random() * 1000,
    y: Math.random() * 1000,
    width: Math.random() * 1000,
    height: Math.random() * 1000,
  }));
}

const shapes3 = createRandomShapes(3);

bench('BVH: instantiate 3 shapes', () => {
  do_not_optimize(BVH.fromRects(shapes3));
}).gc('inner');

const bvh3 = BVH.fromRects(shapes3);
bench('BVH: collsion 3 shapes', () => {
  do_not_optimize(BVH.intersections(bvh3, shapes3[0]));
}).gc('inner');

const shapes100 = createRandomShapes(100);
let bvh100: BVHNode;

bench('BVH: instantiate 100 shapes', () => {
  do_not_optimize((bvh100 = BVH.fromRects(shapes100)));
}).gc('inner');

bench('BVH: check collsion 100 shapes', () => {
  do_not_optimize(BVH.intersections(bvh100, shapes100[0]));
}).gc('inner');

const shapes1000 = createRandomShapes(1000);
let bvh1000: BVHNode;

bench('BVH: instantiate 1000 shapes', () => {
  do_not_optimize((bvh1000 = BVH.fromRects(shapes1000)));
}).gc('inner');

bench('BVH: check collsion 1000 shapes', () => {
  do_not_optimize(BVH.intersections(bvh1000, shapes1000[0]));
}).gc('inner');

const shapes10000 = createRandomShapes(10000);
let bvh10000: BVHNode;

bench('BVH: instantiate 10000 shapes', () => {
  do_not_optimize((bvh10000 = BVH.fromRects(shapes10000)));
}).gc('inner');

bench('BVH: check collsion 10000 shapes', () => {
  do_not_optimize(BVH.intersections(bvh10000, shapes10000[0]));
}).gc('inner');

bench('BVH: instantiate 10000 shapes and check one collision', () => {
  const bvh10000 = BVH.fromRects(shapes10000);
  do_not_optimize(BVH.intersections(bvh10000, shapes10000[0]));
}).gc('inner');

await run();
