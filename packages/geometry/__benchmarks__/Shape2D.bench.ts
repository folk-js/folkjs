import { bench, do_not_optimize, run } from '@folkjs/repo-utils';
import type { Shape2D } from '../src/Shape2D.ts';
import * as S from '../src/Shape2D.ts';

const shape: Shape2D = {
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: Math.PI / 2, // 90 degrees
};

bench('Shape2D: instantiate', () => {
  do_not_optimize(S.fromValues());
}).gc('inner');

bench('Shape2D: instantiate Shape2D with arguments', () => {
  do_not_optimize(S.fromValues(0, 0, 100, 50, Math.PI / 2));
}).gc('inner');

bench('Shape2D: update and read top left corner', () => {
  S.setTopLeftCorner(shape, { x: 1, y: 2 });
  do_not_optimize(S.topLeftCorner(shape));
}).gc('inner');

bench('Shape2D: update bottom right corner', () => {
  S.setBottomRightCorner(shape, { x: 100, y: 50 });
}).gc('inner');

bench('Shape2D: bounds', () => {
  do_not_optimize(S.bounds(shape));
}).gc('inner');

bench('Shape2D: flip handles', () => {
  const handlePoint = S.topLeftCorner(shape);
  S.setTopLeftCorner(shape, S.bottomRightCorner(shape));
  S.setBottomRightCorner(shape, handlePoint);
}).gc('inner');

bench('Shape2D: rotate around origin', () => {
  S.rotateAround(shape, Math.PI, { x: 0, y: 0 });
}).gc('inner');

await run();
