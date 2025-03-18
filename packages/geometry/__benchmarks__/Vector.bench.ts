import { bench, run } from 'mitata';
import * as V from '../src/Vector2.ts';

// Basic vector operations
bench('Vector2.zero', () => {
  V.zero();
});

bench('Vector2.add', () => {
  V.add({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.sub', () => {
  V.subtract({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.mult', () => {
  V.multiply({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.scale', () => {
  V.scale({ x: 1, y: 2 }, 2);
});

// Trigonometric operations
bench('Vector2.rotate', () => {
  V.rotate({ x: 1, y: 2 }, Math.PI / 4);
});

bench('Vector2.rotateAround', () => {
  V.rotateAround({ x: 1, y: 2 }, { x: 0, y: 0 }, Math.PI / 4);
});

bench('Vector2.angle', () => {
  V.angle({ x: 1, y: 2 });
});

bench('Vector2.angleTo', () => {
  V.angleTo({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.angleFromOrigin', () => {
  V.angleFromOrigin({ x: 1, y: 2 }, { x: 0, y: 0 });
});

// Distance and magnitude operations
bench('Vector2.mag', () => {
  V.magnitude({ x: 1, y: 2 });
});

bench('Vector2.magSquared', () => {
  V.magSquared({ x: 1, y: 2 });
});

bench('Vector2.distance', () => {
  V.distance({ x: 1, y: 2 }, { x: 3, y: 4 });
});

bench('Vector2.distanceSquared', () => {
  V.distanceSquared({ x: 1, y: 2 }, { x: 3, y: 4 });
});

// Normalization and interpolation
bench('Vector2.normalized', () => {
  V.normalized({ x: 1, y: 2 });
});

bench('Vector2.lerp', () => {
  V.lerp({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5);
});

await run();
