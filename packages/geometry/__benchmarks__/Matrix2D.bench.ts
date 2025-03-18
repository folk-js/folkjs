import { bench, run } from 'mitata';
import * as M from '../src/Matrix2D.ts';

const m1 = M.fromValues(1, 2, 3, 4, 5, 6);
const m2 = M.fromValues(7, 8, 9, 10, 11, 12);

bench('Matrix2D.applyToPoint', () => {
  M.applyToPoint(m1, { x: 1, y: 1 });
});

bench('Matrix2D.applyToPoints', () => {
  M.applyToPoints(m1, [{ x: 1, y: 1 }]);
});

bench('Matrix2D.compose', () => {
  M.compose(m1, m1);
});

bench('Matrix2D.decompose', () => {
  M.decompose(m1);
});

bench('Matrix2D.determinant', () => {
  M.determinant(m1);
});

bench('Matrix2D.equals', () => {
  M.equals(m1, m1);
});

bench('Matrix2D.exactlyEqual', () => {
  M.exactlyEqual(m1, m1);
});

bench('Matrix2D.fromIdentity', () => {
  M.fromIdentity();
});

bench('Matrix2D.fromMatrix2D', () => {
  M.fromMatrix2D(m1);
});

bench('Matrix2D.fromRotate', () => {
  M.fromRotate(0.707);
});

bench('Matrix2D.fromScale', () => {
  M.fromScale(2);
});

bench('Matrix2D.fromTranslate', () => {
  M.fromTranslate(10, 15);
});
bench('Matrix2D.fromValues', () => {
  M.fromValues(1, 2, 3, 4, 5, 6);
});

bench('Matrix2D.identitySelf', () => {
  M.identitySelf(m1);
});

bench('Matrix2D.invert', () => {
  M.invert(m1);
});

bench('Matrix2D.invertSelf', () => {
  M.invertSelf(m1);
});

bench('Matrix2D.lerp', () => {
  M.lerp(m1, m2, 0.5);
});

bench('Matrix2D.multiply', () => {
  M.multiply(m1, m2);
});

bench('Matrix2D.multiplySelf', () => {
  M.multiplySelf(m1, m2);
});

bench('Matrix2D.recompose', () => {
  M.recompose({ x: 10, y: 10, scaleX: 1.2, scaleY: 5, rotation: 0.707 });
});

bench('Matrix2D.rotate', () => {
  M.rotate(m1, 0.707);
});

bench('Matrix2D.rotateSelf', () => {
  M.rotateSelf(m1, 0.707);
});

bench('Matrix2D.rotation', () => {
  M.rotation(m1);
});

bench('Matrix2D.scale', () => {
  M.scale(m1, 0.5, 0.5);
});

bench('Matrix2D.scaleSelf', () => {
  M.scaleSelf(m1, 0.1, 0.2);
});

bench('Matrix2D.toCSSString', () => {
  M.toCSSString(m1);
});

bench('Matrix2D.toPoint', () => {
  M.toPoint(m1);
});

bench('Matrix2D.translate', () => {
  M.translate(m1, 10, 10);
});

bench('Matrix2D.translateSelf', () => {
  M.translateSelf(m1, 10, 10);
});

await run();
