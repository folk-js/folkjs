import { bench, run } from 'mitata';
import { Vector } from '../Vector.ts';

// Basic vector operations
bench('Vector.zero()', () => {
  Vector.zero();
});

bench('Vector.add', () => {
  Vector.add({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector.sub', () => {
  Vector.sub({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector.mult', () => {
  Vector.mult({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector.scale', () => {
  Vector.scale({ x: 1, y: 2 }, 2);
});

// Trigonometric operations
bench('Vector.rotate', () => {
  Vector.rotate({ x: 1, y: 2 }, Math.PI / 4);
});

bench('Vector.rotateAround', () => {
  Vector.rotateAround({ x: 1, y: 2 }, { x: 0, y: 0 }, Math.PI / 4);
});

bench('Vector.angle', () => {
  Vector.angle({ x: 1, y: 2 });
});

bench('Vector.angleTo', () => {
  Vector.angleTo({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector.angleFromOrigin', () => {
  Vector.angleFromOrigin({ x: 1, y: 2 }, { x: 0, y: 0 });
});

// Distance and magnitude operations
bench('Vector.mag', () => {
  Vector.mag({ x: 1, y: 2 });
});

bench('Vector.magSquared', () => {
  Vector.magSquared({ x: 1, y: 2 });
});

bench('Vector.distance', () => {
  Vector.distance({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector.distanceSquared', () => {
  Vector.distanceSquared({ x: 1, y: 2 }, { x: 3, y: 4 });
});

// Normalization and interpolation
bench('Vector.normalized', () => {
  Vector.normalized({ x: 1, y: 2 });
});

bench('Vector.lerp', () => {
  Vector.lerp({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5);
});

await run();
