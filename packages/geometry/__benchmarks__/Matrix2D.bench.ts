import { bench, do_not_optimize, run } from '@folkjs/repo-utils';
import {
  applyToPoint,
  applyToPoints,
  compose,
  copy,
  decompose,
  determinant,
  equals,
  exactlyEqual,
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
  do_not_optimize(applyToPoint(m1, { x: 1, y: 1 }));
}).gc('inner');

bench('Matrix2D.applyToPoints', () => {
  do_not_optimize(applyToPoints(m1, [{ x: 1, y: 1 }]));
}).gc('inner');

bench('Matrix2D.compose', () => {
  do_not_optimize(compose(m1, m2));
}).gc('inner');

bench('Matrix2D.decompose', () => {
  do_not_optimize(decompose(m1));
}).gc('inner');

bench('Matrix2D.determinant', () => {
  do_not_optimize(determinant(m1));
}).gc('inner');

bench('Matrix2D.equals', () => {
  do_not_optimize(equals(m1, m1));
}).gc('inner');

bench('Matrix2D.exactlyEqual', () => {
  do_not_optimize(exactlyEqual(m1, m1));
}).gc('inner');

bench('Matrix2D.fromMatrix2D', () => {
  do_not_optimize(fromMatrix2D(m1));
}).gc('inner');

bench('Matrix2D.fromRotate', () => {
  do_not_optimize(fromRotate(0.707));
}).gc('inner');

bench('Matrix2D.fromScale', () => {
  do_not_optimize(fromScale(2));
}).gc('inner');

bench('Matrix2D.fromTranslate', () => {
  do_not_optimize(fromTranslate(10, 15));
}).gc('inner');

bench('Matrix2D.fromValues identify', () => {
  do_not_optimize(fromValues());
}).gc('inner');

bench('Matrix2D.fromValues', () => {
  do_not_optimize(fromValues(1, 2, 3, 4, 5, 6));
}).gc('inner');

bench('Matrix2D.identitySelf', () => {
  do_not_optimize(identitySelf(m1));
}).gc('inner');

bench('Matrix2D.invert', () => {
  do_not_optimize(invert(m1));
}).gc('inner');

bench('Matrix2D.invertSelf', () => {
  do_not_optimize(invertSelf(m1));
}).gc('inner');

bench('Matrix2D.lerp', () => {
  do_not_optimize(lerp(m1, m2, 0.5));
}).gc('inner');

bench('Matrix2D.multiply', () => {
  do_not_optimize(multiply(m1, m2));
}).gc('inner');

bench('Matrix2D.multiplySelf', () => {
  do_not_optimize(multiplySelf(m1, m2));
}).gc('inner');

bench('Matrix2D.recompose', () => {
  do_not_optimize(recompose({ x: 10, y: 10, scaleX: 1.2, scaleY: 5, rotation: 0.707 }));
}).gc('inner');

bench('Matrix2D.rotate', () => {
  do_not_optimize(rotate(m1, 0.707));
}).gc('inner');

bench('Matrix2D.rotateSelf', () => {
  do_not_optimize(rotateSelf(m1, 0.707));
}).gc('inner');

bench('Matrix2D.rotation', () => {
  do_not_optimize(rotation(m1));
}).gc('inner');

bench('Matrix2D.scale', () => {
  do_not_optimize(scale(m1, 0.5, 0.5));
}).gc('inner');

bench('Matrix2D.scaleSelf', () => {
  do_not_optimize(scaleSelf(m1, 0.1, 0.2));
}).gc('inner');

bench('Matrix2D.toCSSString', () => {
  do_not_optimize(toCSSString(m1));
}).gc('inner');

bench('Matrix2D.toPoint', () => {
  do_not_optimize(toPoint(m1));
}).gc('inner');

bench('Matrix2D.translate', () => {
  do_not_optimize(translate(m1, 10, 10));
}).gc('inner');

bench('Matrix2D.translateSelf', () => {
  do_not_optimize(translateSelf(m1, 10, 10));
}).gc('inner');

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
}).gc('inner');

await run();
