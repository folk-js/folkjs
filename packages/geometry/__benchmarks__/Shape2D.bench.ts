import { bench, run } from 'mitata';
import type { Shape2D } from '../src/Shape2D.js';
import * as S from '../src/Shape2D.js';

const shape: Shape2D = {
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: Math.PI / 2, // 90 degrees
};

bench('Shape2D: instantiate', () => {
  S.fromValues();
});

bench('Shape2D: instantiate Shape2D with arguments', () => {
  S.fromValues(0, 0, 100, 50, Math.PI / 2);
});

bench('Shape2D: update width', () => {
  shape.width = 50;
});

// Each property takes about 50ns, so N properties takes about 200ns
bench('Shape2D: update multiple properties', () => {
  shape.width = 50;
  shape.height = 20;
  shape.x = 10;
  shape.y = 10;
});

bench('Shape2D: update and read top left corner', () => {
  S.setTopLeftCorner(shape, { x: 1, y: 2 });
  const topLeft = S.topLeftCorner(shape);
});

bench('Shape2D: update bottom right corner', () => {
  S.setBottomRightCorner(shape, { x: 100, y: 50 });
});

bench('Shape2D: bounds', () => {
  const bounds = S.bounds(shape);
});

bench('Shape2D: flip handles', () => {
  const handlePoint = S.topLeftCorner(shape);
  S.setTopLeftCorner(shape, S.bottomRightCorner(shape));
  S.setBottomRightCorner(shape, handlePoint);
});

bench('Shape2D: rotate around origin', () => {
  S.rotateAround(shape, Math.PI, { x: 0, y: 0 });
});

await run();
