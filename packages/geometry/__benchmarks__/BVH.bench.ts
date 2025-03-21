import { bench, run } from 'mitata';
import { BoundingVolumeHierarchy } from '../src/BoundingVolumeHierarchy';
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
let bvh3: BoundingVolumeHierarchy;

bench('BVH: instantiate 3 shapes', () => {
  bvh3 = new BoundingVolumeHierarchy(shapes3);
});

bench('BVH: collsion 3 shapes', () => {
  bvh3.collisions(shapes3[0]);
});

const shapes100 = createRandomShapes(100);
let bvh100: BoundingVolumeHierarchy;

bench('BVH: instantiate 100 shapes', () => {
  bvh100 = new BoundingVolumeHierarchy(shapes100);
});

bench('BVH: check collsion 100 shapes', () => {
  bvh100.collisions(shapes100[0]);
});

const shapes1000 = createRandomShapes(1000);
let bvh1000: BoundingVolumeHierarchy;

bench('BVH: instantiate 1000 shapes', () => {
  bvh1000 = new BoundingVolumeHierarchy(shapes1000);
});

bench('BVH: check collsion 1000 shapes', () => {
  bvh1000.collisions(shapes1000[0]);
});

const shapes10000 = createRandomShapes(10000);
let bvh10000: BoundingVolumeHierarchy;

bench('BVH: instantiate 10000 shapes', () => {
  bvh10000 = new BoundingVolumeHierarchy(shapes10000);
});

bench('BVH: check collsion 10000 shapes', () => {
  bvh10000.collisions(shapes10000[0]);
});

bench('BVH: instantiate 10000 shapes and check one collision', () => {
  const bvh10000 = new BoundingVolumeHierarchy(shapes10000);
  bvh10000.collisions(shapes10000[0]);
});

await run();
