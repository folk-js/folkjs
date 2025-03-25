import { bench, run } from '@folkjs/repo-utils';
import {
  add,
  angle,
  angleFromOrigin,
  angleTo,
  distance,
  distanceSquared,
  lerp,
  magnitude,
  magSquared,
  multiply,
  normalized,
  rotate,
  rotateAround,
  scale,
  subtract,
  zero,
} from '../src/Vector2.ts';

// Basic vector operations
bench('Vector2.zero', () => {
  zero();
});

bench('Vector2.add', () => {
  add({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.sub', () => {
  subtract({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.mult', () => {
  multiply({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.scale', () => {
  scale({ x: 1, y: 2 }, 2);
});

// Trigonometric operations
bench('Vector2.rotate', () => {
  rotate({ x: 1, y: 2 }, Math.PI / 4);
});

bench('Vector2.rotateAround', () => {
  rotateAround({ x: 1, y: 2 }, { x: 0, y: 0 }, Math.PI / 4);
});

bench('Vector2.angle', () => {
  angle({ x: 1, y: 2 });
});

bench('Vector2.angleTo', () => {
  angleTo({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.angleFromOrigin', () => {
  angleFromOrigin({ x: 1, y: 2 }, { x: 0, y: 0 });
});

// Distance and magnitude operations
bench('Vector2.mag', () => {
  magnitude({ x: 1, y: 2 });
});

bench('Vector2.magSquared', () => {
  magSquared({ x: 1, y: 2 });
});

bench('Vector2.distance', () => {
  distance({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.distanceSquared', () => {
  distanceSquared({ x: 1, y: 2 }, { x: 3, y: 4 });
});

// Normalization and interpolation
bench('Vector2.normalized', () => {
  normalized({ x: 1, y: 2 });
});

bench('Vector2.lerp', () => {
  lerp({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5);
});

await run();
