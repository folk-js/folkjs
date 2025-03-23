import { DOMShape } from '@folkjs/geometry/DOMShape2';
import { bench, run } from 'mitata';

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
  shape.rotatedWidth = 50;
});

// Each property takes about 50ns, so N properties takes about 200ns
bench('DOMShape: update multiple properties', () => {
  shape.rotatedWidth = 50;
  shape.rotatedHeight = 20;
  shape.x = 10;
  shape.y = 10;
});

bench('DOMShape: update and read top left corner', () => {
  shape.topLeft = { x: 1, y: 2 };
  const topLeft = shape.topLeft;
});

bench('DOMShape: update bottom right corner', () => {
  shape.bottomRight = { x: 100, y: 50 };
});

bench('DOMShape: bounds', () => {
  shape.x = 0;
  const height = shape.height;
  const width = shape.width;
  const left = shape.left;
  const right = shape.right;
  const top = shape.top;
  const bottom = shape.bottom;
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
