import { bench, run } from 'mitata';
import { DOMShape } from '../src/DOMShape';

const shape = new DOMShape({
  x: 0,
  y: 0,
  width: 100,
  height: 50,
  rotation: Math.PI / 2, // 90 degrees
});

bench('DOMShape: instantiate', () => {
  new DOMShape();
});

bench('DOMShape: instantiate DOMShape with arguments', () => {
  new DOMShape({
    x: 0,
    y: 0,
    width: 100,
    height: 50,
    rotation: Math.PI / 2, // 90 degrees
  });
});

bench('DOMShape: update width', () => {
  shape.width = 50;
});

// Each property takes about 50ns, so N properties takes about 200ns
bench('DOMShape: update multiple properties', () => {
  shape.width = 50;
  shape.height = 20;
  shape.x = 10;
  shape.y = 10;
});

bench('DOMShape: update top left corner', () => {
  shape.topLeft = { x: 1, y: 2 };
  const topLeft = shape.topLeft;
});

bench('DOMShape: update bottom right corner', () => {
  shape.bottomRight = { x: 100, y: 50 };
});

bench('DOMShape: toLocalSpace', () => {
  shape.toLocalSpace({ x: 100, y: 50 });
});

bench('DOMShape: toParentSpace', () => {
  shape.toParentSpace({ x: 100, y: 50 });
});

bench('DOMShape: bounds', () => {
  shape.bounds;
});

bench('DOMShape: flip handles', () => {
  const handlePoint = shape.topLeft;
  shape.topLeft = shape.bottomRight;
  shape.bottomRight = handlePoint;
});

bench('DOMShape: rotate around origin', () => {
  shape.rotate(Math.PI, { x: 0, y: 0 });
});

await run();
