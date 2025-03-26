import { bench, do_not_optimize, run } from '@folkjs/repo-utils';
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
  do_not_optimize(zero());
}).gc('inner');

bench('Vector2.add', () => {
  do_not_optimize(add({ x: 1, y: 2 }, { x: 3, y: 4 }));
}).gc('inner');

bench('Vector2.sub', () => {
  do_not_optimize(subtract({ x: 1, y: 2 }, { x: 3, y: 4 }));
}).gc('inner');

bench('Vector2.mult', () => {
  do_not_optimize(multiply({ x: 1, y: 2 }, { x: 3, y: 4 }));
}).gc('inner');

bench('Vector2.scale', () => {
  do_not_optimize(scale({ x: 1, y: 2 }, 2));
}).gc('inner');

// Trigonometric operations
bench('Vector2.rotate', () => {
  do_not_optimize(rotate({ x: 1, y: 2 }, Math.PI / 4));
}).gc('inner');

bench('Vector2.rotateAround', () => {
  do_not_optimize(rotateAround({ x: 1, y: 2 }, { x: 0, y: 0 }, Math.PI / 4));
}).gc('inner');

bench('Vector2.angle', () => {
  do_not_optimize(angle({ x: 1, y: 2 }));
}).gc('inner');

bench('Vector2.angleTo', () => {
  do_not_optimize(angleTo({ x: 1, y: 2 }, { x: 3, y: 4 }));
}).gc('inner');

bench('Vector2.angleFromOrigin', () => {
  do_not_optimize(angleFromOrigin({ x: 1, y: 2 }, { x: 0, y: 0 }));
}).gc('inner');

// Distance and magnitude operations
bench('Vector2.mag', () => {
  do_not_optimize(magnitude({ x: 1, y: 2 }));
}).gc('inner');

bench('Vector2.magSquared', () => {
  do_not_optimize(magSquared({ x: 1, y: 2 }));
}).gc('inner');

bench('Vector2.distance', () => {
  do_not_optimize(distance({ x: 1, y: 2 }, { x: 3, y: 4 }));
}).gc('inner');

bench('Vector2.distanceSquared', () => {
  do_not_optimize(distanceSquared({ x: 1, y: 2 }, { x: 3, y: 4 }));
}).gc('inner');

// Normalization and interpolation
bench('Vector2.normalized', () => {
  do_not_optimize(normalized({ x: 1, y: 2 }));
}).gc('inner');

bench('Vector2.lerp', () => {
  do_not_optimize(lerp({ x: 1, y: 2 }, { x: 3, y: 4 }, 0.5));
}).gc('inner');

await run();
