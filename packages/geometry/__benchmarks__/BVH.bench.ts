import { bench, do_not_optimize, run } from '@folkjs/repo-utils';
import * as BVH from '../src/BoundingVolumeHierarchy.ts';
import * as S from '../src/Shape2D.ts';

function createRandomShapes(length: number): S.Shape2D[] {
  return Array.from({ length }).map(() =>
    S.fromValues(Math.random() * 1000, Math.random() * 1000, Math.random() * 1000, Math.random() * 1000),
  );
}

const shapes3 = createRandomShapes(3);

bench('BVH: instantiate 3 shapes', () => {
  do_not_optimize(BVH.fromShapes(shapes3));
}).gc('inner');

const bvh3 = BVH.fromShapes(shapes3);
bench('BVH: intersection 3 shapes', () => {
  do_not_optimize(BVH.intersections(bvh3, shapes3[0], S.boundingBox(shapes3[0])));
}).gc('inner');

const shapes100 = createRandomShapes(100);

bench('BVH: instantiate 100 shapes', () => {
  do_not_optimize(BVH.fromShapes(shapes100));
}).gc('inner');

const bvh100 = BVH.fromShapes(shapes100);
bench('BVH: check intersection 100 shapes', () => {
  do_not_optimize(BVH.intersections(bvh100, shapes100[0], S.boundingBox(shapes100[0])));
}).gc('inner');

const shapes1000 = createRandomShapes(1000);

bench('BVH: instantiate 1000 shapes', () => {
  do_not_optimize(BVH.fromShapes(shapes1000));
}).gc('inner');

const bvh1000 = BVH.fromShapes(shapes1000);
bench('BVH: check intersection 1000 shapes', () => {
  do_not_optimize(BVH.intersections(bvh1000, shapes1000[0], S.boundingBox(shapes1000[0])));
}).gc('inner');

const shapes10000 = createRandomShapes(10000);

bench('BVH: instantiate 10000 shapes', () => {
  do_not_optimize(BVH.fromShapes(shapes10000));
}).gc('inner');

const bvh10000 = BVH.fromShapes(shapes10000);
bench('BVH: check intersection 10000 shapes', () => {
  do_not_optimize(BVH.intersections(bvh10000, shapes10000[0], S.boundingBox(shapes10000[0])));
}).gc('inner');

bench('BVH: instantiate 10000 shapes and check one collision', () => {
  const bvh10000 = BVH.fromShapes(shapes10000);
  do_not_optimize(BVH.intersections(bvh10000, shapes10000[0], S.boundingBox(shapes10000[0])));
}).gc('inner');

await run();
