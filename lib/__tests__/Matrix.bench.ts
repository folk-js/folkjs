import { bench, run } from 'mitata';
import { Matrix } from '../Matrix.ts';

const m1 = new Matrix(1, 2, 3, 4, 5, 6);
const m2 = new Matrix(7, 8, 9, 10, 11, 12);

bench('Matrix.transformPoint', () => {
  m1.applyToPoint({ x: 1, y: 1 });
});

bench('Matrix identity', () => {
  new Matrix();
});

bench('Matrix2D.fromMatrix', () => {
  Matrix.From(m1);
});

bench('Matrix2D.rotate', () => {
  m1.rotate(0, 0, 0.707);
});

bench('Matrix2D.scale', () => {
  new Matrix().scale(2, 2);
});

bench('Matrix2D.translate', () => {
  new Matrix().translate(10, 15);
});

bench('Matrix2D.invert', () => {
  m1.invert();
});

bench('Matrix2D.multiply', () => {
  m1.multiply(m2);
});

bench('Matrix2D.rotate', () => {
  m1.rotate(0, 0, 0.707);
});

bench('Matrix2D.scale', () => {
  m1.scale(0.5, 0.5);
});

bench('Matrix2D.toCSSString', () => {
  m1.toString();
});

bench('Matrix2D.translate', () => {
  m1.translate(10, 10);
});

await run();
