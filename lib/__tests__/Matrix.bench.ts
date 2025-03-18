import { bench, run } from 'mitata';
import { Matrix } from '../Matrix.ts';

const m1 = new Matrix(1, 2, 3, 4, 5, 6);
const m2 = new Matrix(7, 8, 9, 10, 11, 12);

bench('Matrix.applyToPoint', () => {
  m1.applyToPoint({ x: 1, y: 1 });
});

bench('Matrix.applyToPoints', () => {
  m1.applyToPoints([{ x: 1, y: 1 }]);
});

bench('Matrix.compose', () => {
  Matrix.Compose(m1, m2);
});

bench('Matrix.decompose', () => {
  m1.decompose();
});

bench('Matrix identity', () => {
  new Matrix();
});

bench('Matrix.fromMatrix', () => {
  Matrix.From(m1);
});

bench('Matrix.fromRotate', () => {
  m1.rotate(0, 0, 0.707);
});

bench('Matrix.fromScale', () => {
  new Matrix().scale(2, 2);
});

bench('Matrix.fromTranslate', () => {
  new Matrix().translate(10, 15);
});

bench('Matrix.invert', () => {
  m1.invert();
});

bench('Matrix.lerp', () => {
  m1.lerp(m2, 0.5);
});

bench('Matrix.multiply', () => {
  m1.multiply(m2);
});

bench('Matrix.recompose', () => {
  Matrix.Recompose({ x: 10, y: 10, scaleX: 1.2, scaleY: 5, rotation: 0.707 });
});

bench('Matrix.rotate', () => {
  m1.rotate(0, 0, 0.707);
});

bench('Matrix.scale', () => {
  m1.scale(0.5, 0.5);
});

bench('Matrix.translate', () => {
  m1.translate(10, 10);
});

bench('Matrix2D multiple transformations', () => {
  const transformOrigin = { x: 5, y: 6 };
  const mt = new Matrix(1, 2, 3, 4, 5, 6);
  const mi = new Matrix(1, 2, 3, 4, 5, 6);

  mt.translate(10, 15)
    .translate(transformOrigin.x, transformOrigin.y)
    .rotate(Math.PI / 3)
    .translate(-transformOrigin.x, -transformOrigin.y);

  mi.copy(mt).invert();
});

await run();
