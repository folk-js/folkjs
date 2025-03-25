import { bench, run } from 'mitata';
import {
  applyToPoint,
  applyToPoints,
  compose,
  copy,
  decompose,
  determinant,
  equals,
  exactlyEqual,
  fromIdentity,
  fromMatrix2D,
  fromRotate,
  fromScale,
  fromTranslate,
  fromValues,
  identitySelf,
  invert,
  invertSelf,
  lerp,
  multiply,
  multiplySelf,
  recompose,
  rotate,
  rotateSelf,
  rotation,
  scale,
  scaleSelf,
  toCSSString,
  toPoint,
  translate,
  translateSelf,
} from '../src/Matrix2D.ts';
import { PI } from '../src/utilities.ts';

const m1 = fromValues(1, 2, 3, 4, 5, 6);
const m2 = fromValues(7, 8, 9, 10, 11, 12);

bench('Matrix2D.applyToPoint', () => {
  applyToPoint(m1, { x: 1, y: 1 });
});

bench('Matrix2D.applyToPoints', () => {
  applyToPoints(m1, [{ x: 1, y: 1 }]);
});

bench('Matrix2D.compose', () => {
  compose(m1, m2);
});

bench('Matrix2D.decompose', () => {
  decompose(m1);
});

bench('Matrix2D.determinant', () => {
  determinant(m1);
});

bench('Matrix2D.equals', () => {
  equals(m1, m1);
});

bench('Matrix2D.exactlyEqual', () => {
  exactlyEqual(m1, m1);
});

bench('Matrix2D.fromIdentity', () => {
  fromIdentity();
});

bench('Matrix2D.fromMatrix2D', () => {
  fromMatrix2D(m1);
});

bench('Matrix2D.fromRotate', () => {
  fromRotate(0.707);
});

bench('Matrix2D.fromScale', () => {
  fromScale(2);
});

bench('Matrix2D.fromTranslate', () => {
  fromTranslate(10, 15);
});

bench('Matrix2D.fromValues', () => {
  fromValues(1, 2, 3, 4, 5, 6);
});

bench('Matrix2D.identitySelf', () => {
  identitySelf(m1);
});

bench('Matrix2D.invert', () => {
  invert(m1);
});

bench('Matrix2D.invertSelf', () => {
  invertSelf(m1);
});

bench('Matrix2D.lerp', () => {
  lerp(m1, m2, 0.5);
});

bench('Matrix2D.multiply', () => {
  multiply(m1, m2);
});

bench('Matrix2D.multiplySelf', () => {
  multiplySelf(m1, m2);
});

bench('Matrix2D.recompose', () => {
  recompose({ x: 10, y: 10, scaleX: 1.2, scaleY: 5, rotation: 0.707 });
});

bench('Matrix2D.rotate', () => {
  rotate(m1, 0.707);
});

bench('Matrix2D.rotateSelf', () => {
  rotateSelf(m1, 0.707);
});

bench('Matrix2D.rotation', () => {
  rotation(m1);
});

bench('Matrix2D.scale', () => {
  scale(m1, 0.5, 0.5);
});

bench('Matrix2D.scaleSelf', () => {
  scaleSelf(m1, 0.1, 0.2);
});

bench('Matrix2D.toCSSString', () => {
  toCSSString(m1);
});

bench('Matrix2D.toPoint', () => {
  toPoint(m1);
});

bench('Matrix2D.translate', () => {
  translate(m1, 10, 10);
});

bench('Matrix2D.translateSelf', () => {
  translateSelf(m1, 10, 10);
});

bench('Matrix2D multiple transformations', () => {
  const transformOrigin = { x: 5, y: 6 };
  const mt = fromValues(1, 2, 3, 4, 5, 6);
  const mi = fromValues(1, 2, 3, 4, 5, 6);
  translateSelf(mt, 10, 15);
  translateSelf(mt, transformOrigin.x, transformOrigin.y);
  rotateSelf(mt, PI / 3);
  translateSelf(mt, -transformOrigin.x, -transformOrigin.y);
  copy(mi, mt);
  invertSelf(mi);
});

await run();
