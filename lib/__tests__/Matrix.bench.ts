import { bench, run } from 'mitata';
import { Matrix } from '../Matrix.ts';

// Basic creation benchmarks
bench('Matrix creation', () => {
  new Matrix(1, 0, 0, 1, 10, 20);
});

bench('DOMMatrix creation', () => {
  new DOMMatrix([1, 0, 0, 1, 10, 20]);
});

bench('Matrix.Identity()', () => {
  Matrix.Identity();
});

bench('DOMMatrix identity', () => {
  new DOMMatrix();
});

// Transform operations
bench('Matrix.translate', () => {
  new Matrix().translate(10, 20);
});

bench('DOMMatrix.translateSelf', () => {
  new DOMMatrix().translateSelf(10, 20);
});

bench('Matrix.rotate', () => {
  new Matrix().rotate(Math.PI / 4);
});

bench('DOMMatrix.rotateSelf', () => {
  new DOMMatrix().rotateSelf(((Math.PI / 4) * 180) / Math.PI); // Convert to degrees for DOMMatrix
});

bench('Matrix.scale', () => {
  new Matrix().scale(2, 3);
});

bench('DOMMatrix.scaleSelf', () => {
  new DOMMatrix().scaleSelf(2, 3);
});

// Complex transformations
bench('Matrix combined transforms', () => {
  new Matrix()
    .translate(10, 20)
    .rotate(Math.PI / 4)
    .scale(2, 3);
});

bench('DOMMatrix combined transforms', () => {
  new DOMMatrix()
    .translateSelf(10, 20)
    .rotateSelf(((Math.PI / 4) * 180) / Math.PI)
    .scaleSelf(2, 3);
});

// Matrix multiplication
bench('Matrix.multiply', () => {
  const m1 = new Matrix(1, 0, 0, 1, 10, 20);
  const m2 = new Matrix(2, 0, 0, 2, 30, 40);
  m1.multiply(m2);
});

bench('DOMMatrix.multiplySelf', () => {
  const m1 = new DOMMatrix([1, 0, 0, 1, 10, 20]);
  const m2 = new DOMMatrix([2, 0, 0, 2, 30, 40]);
  m1.multiplySelf(m2);
});

// Inversion
bench('Matrix.invert', () => {
  new Matrix(1, 0, 0, 1, 10, 20).invert();
});

bench('DOMMatrix.invertSelf', () => {
  new DOMMatrix([1, 0, 0, 1, 10, 20]).invertSelf();
});

// Point transformation
bench('Matrix.applyToPoint', () => {
  const m = new Matrix(1, 0, 0, 1, 10, 20);
  m.applyToPoint({ x: 5, y: 10 });
});

bench('DOMMatrix.transformPoint', () => {
  const m = new DOMMatrix([1, 0, 0, 1, 10, 20]);
  m.transformPoint(new DOMPoint(5, 10));
});

// Decomposition
bench('Matrix.decompose', () => {
  const m = new Matrix(
    Math.cos(Math.PI / 4),
    Math.sin(Math.PI / 4),
    -Math.sin(Math.PI / 4),
    Math.cos(Math.PI / 4),
    10,
    20,
  );
  m.decompose();
});

bench('DOMMatrix.getDecomposedValues', () => {
  const m = new DOMMatrix([
    Math.cos(Math.PI / 4),
    Math.sin(Math.PI / 4),
    -Math.sin(Math.PI / 4),
    Math.cos(Math.PI / 4),
    10,
    20,
  ]);
  // DOMMatrix doesn't have a direct equivalent, but we're measuring its properties access
  const { translateX, translateY, translateZ, scaleX, scaleY, scaleZ, rotate } = m.toJSON();
});

// Conversion
bench('Matrix to DOMMatrix', () => {
  const m = new Matrix(1, 0, 0, 1, 10, 20);
  m.toDOMMatrix();
});

bench('DOMMatrix to Matrix', () => {
  const dm = new DOMMatrix([1, 0, 0, 1, 10, 20]);
  Matrix.FromDOMMatrix(dm);
});

// String conversion
bench('Matrix.toCssString', () => {
  const m = new Matrix(1, 0, 0, 1, 10, 20);
  m.toCssString();
});

bench('DOMMatrix toString', () => {
  const m = new DOMMatrix([1, 0, 0, 1, 10, 20]);
  m.toString();
});

await run();
