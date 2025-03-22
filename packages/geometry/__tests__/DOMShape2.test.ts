import { describe, expect, test } from 'bun:test';
import { DOMShape, DOMShapeReadonly } from '../src/DOMShape2.js';
import { Vector2 } from '../src/Vector2.js';

// Helper for comparing points with floating point values
const expectPointClose = (actual: Vector2, expected: Vector2) => {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
};

describe('DOMShape2', () => {
  test('constructor initializes with default values', () => {
    const rect = new DOMShape();
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.rotatedWidth).toBe(0);
    expect(rect.rotatedHeight).toBe(0);
    expect(rect.rotation).toBe(0);
  });

  test('constructor initializes with provided values', () => {
    const rect = new DOMShape({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
      rotation: Math.PI / 4,
    });
    expect(rect.x).toBe(10);
    expect(rect.y).toBe(20);
    expect(rect.rotatedWidth).toBe(100);
    expect(rect.rotatedHeight).toBe(50);
    expect(rect.rotation).toBe(Math.PI / 4);
  });

  test('bounds are calculated correctly', () => {
    const rect = new DOMShape({
      x: 10,
      y: 20,
      width: 100,
      height: 50,
    });
    expect(rect.left).toBe(10);
    expect(rect.top).toBe(20);
    expect(rect.right).toBe(110);
    expect(rect.bottom).toBe(70);
  });

  test('corners returns correct values', () => {
    const rect = new DOMShape({
      width: 100,
      height: 50,
    });

    expectPointClose(rect.topLeft, { x: 0, y: 0 });
    expectPointClose(rect.topRight, { x: 100, y: 0 });
    expectPointClose(rect.bottomRight, { x: 100, y: 50 });
    expectPointClose(rect.bottomLeft, { x: 0, y: 50 });
  });

  test('rotated corners returns correct values', () => {
    const rect = new DOMShape({
      width: 100,
      height: 100,
      rotation: Math.PI / 2,
    });

    expectPointClose(rect.topLeft, { x: 100, y: 0 });
    expectPointClose(rect.topRight, { x: 100, y: 100 });
    expectPointClose(rect.bottomRight, { x: 0, y: 100 });
    expectPointClose(rect.bottomLeft, { x: 0, y: 0 });
  });

  //   test('coordinate space conversion with rotation', () => {
  //     const rect = new DOMShape({
  //       x: 10,
  //       y: 20,
  //       width: 100,
  //       height: 50,
  //       rotation: Math.PI / 2, // 90 degrees
  //     });

  //     const parentPoint = { x: 10, y: 20 };
  //     const localPoint = rect.toLocalSpace(parentPoint);
  //     const backToParent = rect.toParentSpace(localPoint);

  //     expectPointClose(backToParent, parentPoint);
  //   });

  test('bounds are correct bounding box after rotation', () => {
    const rect = new DOMShape({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2, // 90 degrees
    });

    expect(rect.width).toBeCloseTo(50);
    expect(rect.height).toBeCloseTo(100);
  });

  //   test('setters update matrices correctly', () => {
  //     const rect = new DOMShape();
  //     rect.x = 10;
  //     rect.y = 20;
  //     rect.width = 100;
  //     rect.height = 50;
  //     rect.rotation = Math.PI / 4;

  //     const point = { x: 0, y: 0 };
  //     const transformed = rect.toParentSpace(point);
  //     const backToLocal = rect.toLocalSpace(transformed);

  //     expectPointClose(backToLocal, point);
  //   });

  //   test('coordinate transformations with rotation and translation', () => {
  //     const rect = new DOMShape({
  //       x: 100,
  //       y: 100,
  //       width: 200,
  //       height: 100,
  //       rotation: Math.PI / 4, // 45 degrees
  //     });

  //     // Test multiple points
  //     const testPoints = [
  //       { x: -100, y: 100 }, // Origin point
  //       { x: 200, y: 150 }, // Middle point
  //       { x: 300, y: 200 }, // Far point
  //     ];

  //     testPoints.forEach((point) => {
  //       const localPoint = rect.toLocalSpace(point);
  //       const backToParent = rect.toParentSpace(localPoint);
  //       expectPointClose(backToParent, point);
  //     });
  //   });

  describe('corner', () => {
    test('set topLeft corner', () => {
      const rect = new DOMShape({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
      });

      rect.topLeft = { x: 15, y: 15 };

      expect(rect.x).toBe(15);
      expect(rect.y).toBe(15);
      expect(rect.rotatedWidth).toBe(5);
      expect(rect.rotatedHeight).toBe(5);
      expectPointClose(rect.topLeft, { x: 15, y: 15 });
    });

    test('set topRight corner', () => {
      const rect = new DOMShape({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
      });

      rect.topRight = { x: 15, y: 15 };

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(15);
      expect(rect.rotatedWidth).toBe(5);
      expect(rect.rotatedHeight).toBe(5);
      expectPointClose(rect.topRight, { x: 15, y: 15 });
    });

    test('set bottomRight corner', () => {
      const rect = new DOMShape({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
      });

      rect.bottomRight = { x: 15, y: 15 };

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(10);
      expect(rect.rotatedWidth).toBe(5);
      expect(rect.rotatedHeight).toBe(5);
      expectPointClose(rect.bottomRight, { x: 15, y: 15 });
    });

    test('set bottomLeft conrner', () => {
      const rect = new DOMShape({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
      });

      rect.bottomLeft = { x: 15, y: 15 };

      expect(rect.x).toBe(15);
      expect(rect.y).toBe(10);
      expect(rect.rotatedWidth).toBe(5);
      expect(rect.rotatedHeight).toBe(5);
      expectPointClose(rect.bottomLeft, { x: 15, y: 15 });
    });

    test('topLeft corner setters with rotation', () => {
      const rect = new DOMShape({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
        rotation: Math.PI / 2,
      });

      rect.topLeft = { x: 15, y: 15 };

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(15);
      expect(rect.rotatedWidth).toBe(5);
      expect(rect.rotatedWidth).toBe(5);
      expectPointClose(rect.topLeft, { x: 15, y: 15 });
    });

    test('bottomRight corner setters with rotation', () => {
      const rect = new DOMShape({
        x: 10,
        y: 10,
        width: 10,
        height: 10,
        rotation: Math.PI / 2,
      });

      rect.bottomRight = { x: 15, y: 15 };

      expect(rect.x).toBe(15);
      expect(rect.y).toBe(10);
      expect(rect.rotatedWidth).toBe(5);
      expect(rect.rotatedHeight).toBe(5);
      expectPointClose(rect.bottomRight, { x: 15, y: 15 });
    });

    test('set bottomRight works with upside down rotation', () => {
      const rect = new DOMShape({
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        rotation: Math.PI, // 180 degrees - upside down
      });

      rect.bottomRight = { x: 150, y: 75 };

      expect(rect.x).toBe(150);
      expect(rect.y).toBe(75);
      expect(rect.rotatedWidth).toBe(150);
      expect(rect.rotatedHeight).toBe(125);

      // Verify the corner is actually at the expected position in local space
      expectPointClose(rect.bottomRight, { x: 150, y: 75 });
    });

    test('resizing from corners keeps the opposite corner fixed without rotation', () => {
      const rect = new DOMShape({
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        rotation: 0,
      });

      const originalTopLeft = rect.topLeft;

      // Resize from bottom-right corner
      rect.bottomRight = { x: 300, y: 200 };

      // Opposite corner (top-left) should remain the same
      expectPointClose(rect.topLeft, originalTopLeft);
    });

    test('resizing from corners keeps the opposite corner fixed with rotation', () => {
      const rect = new DOMShape({
        x: 100,
        y: 100,
        width: 200,
        height: 100,
        rotation: Math.PI / 4, // 45 degrees
      });

      const oldTopLeft = rect.topLeft;

      rect.bottomRight = { x: 300, y: 150 };

      expectPointClose(rect.topLeft, oldTopLeft);
    });

    test.skip('rotate with origin', () => {
      const rect = new DOMShape({
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      });

      // rotate around origin
      rect.rotate(Math.PI, { x: 0, y: 0 });

      expectPointClose(rect.topLeft, { x: 0, y: 0 });
      expectPointClose(rect.topRight, { x: -1, y: 0 });
      expectPointClose(rect.bottomRight, { x: -1, y: -1 });
      expectPointClose(rect.bottomLeft, { x: 0, y: -1 });

      // rotate around center
      rect.rotation = Math.PI / 2;

      expectPointClose(rect.topLeft, { x: -1, y: 0 });
      expectPointClose(rect.topRight, { x: -1, y: -1 });
      expectPointClose(rect.bottomRight, { x: 0, y: -1 });
      expectPointClose(rect.bottomLeft, { x: 0, y: 0 });
    });
  });

  //   describe('point conversion with rotation', () => {
  //     test('converts points correctly with 45-degree rotation', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 100,
  //         height: 100,
  //         rotation: Math.PI / 4, // 45 degrees
  //       });

  //       expectPointClose(rect.center, { x: 150, y: 150 }); // Center in parent space
  //       // Center point should remain at the same position after transformation
  //       const center = { x: 50, y: 50 }; // Center in local space
  //       const centerInParent = rect.toParentSpace(center);
  //       expectPointClose(centerInParent, { x: 150, y: 150 }); // Center in parent space

  //       // Test a point on the edge
  //       const edge = { x: 100, y: 50 }; // Right-middle in local space
  //       const edgeInParent = rect.toParentSpace(edge);
  //       // At 45 degrees, this point should be √2/2 * 100 units right and up from center
  //       expectPointClose(edgeInParent, {
  //         x: 150 + Math.cos(Math.PI / 4) * 50,
  //         y: 150 + Math.sin(Math.PI / 4) * 50,
  //       });
  //     });

  //     test('maintains relative positions through multiple transformations', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 100,
  //         height: 100,
  //         rotation: Math.PI / 6, // 30 degrees
  //       });

  //       // Create a grid of test points
  //       const gridPoints: Vector2[] = [];
  //       for (let x = 0; x <= 100; x += 25) {
  //         for (let y = 0; y <= 100; y += 25) {
  //           gridPoints.push({ x, y });
  //         }
  //       }

  //       // Verify all points maintain their relative distances
  //       gridPoints.forEach((point1, i) => {
  //         gridPoints.forEach((point2, j) => {
  //           if (i === j) return;

  //           // Calculate distance in local space
  //           const dx = point2.x - point1.x;
  //           const dy = point2.y - point1.y;
  //           const localDistance = Math.sqrt(dx * dx + dy * dy);

  //           // Transform points to parent space
  //           const parent1 = rect.toParentSpace(point1);
  //           const parent2 = rect.toParentSpace(point2);

  //           // Calculate distance in parent space
  //           const pdx = parent2.x - parent1.x;
  //           const pdy = parent2.y - parent1.y;
  //           const parentDistance = Math.sqrt(pdx * pdx + pdy * pdy);

  //           // Distances should be preserved
  //           expect(parentDistance).toBeCloseTo(localDistance);
  //         });
  //       });
  //     });

  //     test('handles edge cases with various rotations', () => {
  //       const testRotations = [
  //         0, // No rotation
  //         Math.PI / 2, // 90 degrees
  //         Math.PI, // 180 degrees
  //         (3 * Math.PI) / 2, // 270 degrees
  //         Math.PI / 6, // 30 degrees
  //         Math.PI / 3, // 60 degrees
  //         (2 * Math.PI) / 3, // 120 degrees
  //         (5 * Math.PI) / 6, // 150 degrees
  //       ];

  //       testRotations.forEach((rotation) => {
  //         const rect = new DOMShape({
  //           x: 100,
  //           y: 100,
  //           width: 100,
  //           height: 50,
  //           rotation,
  //         });

  //         // Test various points including corners and edges
  //         const testPoints = [
  //           { x: 0, y: 0 }, // Top-left
  //           { x: 100, y: 0 }, // Top-right
  //           { x: 100, y: 50 }, // Bottom-right
  //           { x: 0, y: 50 }, // Bottom-left
  //           { x: 50, y: 25 }, // Center
  //           { x: 50, y: 0 }, // Top middle
  //           { x: 100, y: 25 }, // Right middle
  //           { x: 50, y: 50 }, // Bottom middle
  //           { x: 0, y: 25 }, // Left middle
  //         ];

  //         testPoints.forEach((localPoint) => {
  //           const parentPoint = rect.toParentSpace(localPoint);
  //           const backToLocal = rect.toLocalSpace(parentPoint);
  //           expectPointClose(backToLocal, localPoint);
  //         });
  //       });
  //     });

  //     test('maintains aspect ratio through transformations', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 200,
  //         height: 100,
  //         rotation: Math.PI / 3, // 60 degrees
  //       });

  //       // Test diagonal distances
  //       const topLeft = { x: 0, y: 0 };
  //       const bottomRight = { x: 200, y: 100 };

  //       const topLeftParent = rect.toParentSpace(topLeft);
  //       const bottomRightParent = rect.toParentSpace(bottomRight);

  //       // Calculate distances
  //       const localDiagonal = Math.sqrt(Math.pow(bottomRight.x - topLeft.x, 2) + Math.pow(bottomRight.y - topLeft.y, 2));
  //       const parentDiagonal = Math.sqrt(
  //         Math.pow(bottomRightParent.x - topLeftParent.x, 2) + Math.pow(bottomRightParent.y - topLeftParent.y, 2),
  //       );

  //       // Distances should be preserved
  //       expect(parentDiagonal).toBeCloseTo(localDiagonal);
  //     });
  //   });

  //   describe('transform and rotate origins', () => {
  //     test('constructor initializes with default origins at center', () => {
  //       const rect = new DOMShape();
  //       expectPointClose(rect.transformOrigin, { x: 0.5, y: 0.5 });
  //     });

  //     test('constructor accepts custom origins', () => {
  //       const rect = new DOMShape({
  //         transformOrigin: { x: 0, y: 0 },
  //       });
  //       expectPointClose(rect.transformOrigin, { x: 0, y: 0 });
  //     });

  //     test('maintains point relationships with custom origins', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 100,
  //         height: 100,
  //         rotation: Math.PI / 3, // 60 degrees
  //         transformOrigin: { x: 0.25, y: 0.75 },
  //       });

  //       // Test multiple points
  //       const points = [
  //         { x: 0, y: 0 },
  //         { x: 100, y: 0 },
  //         { x: 100, y: 100 },
  //         { x: 0, y: 100 },
  //       ];

  //       // Transform all points to parent space and back
  //       points.forEach((point) => {
  //         const transformed = rect.toParentSpace(point);
  //         const backToLocal = rect.toLocalSpace(transformed);
  //         expectPointClose(backToLocal, point);
  //       });
  //     });
  //   });

  //   test('rotate with origin', () => {
  //     const rect = new DOMShape({
  //       x: 0,
  //       y: 0,
  //       width: 1,
  //       height: 1,
  //     });

  //     rect.rotate(Math.PI, { x: 0, y: 0 });

  //     expectPointClose(rect.toParentSpace(rect.topLeft), { x: 0, y: 0 });
  //     expectPointClose(rect.toParentSpace(rect.topRight), { x: -1, y: 0 });
  //     expectPointClose(rect.toParentSpace(rect.bottomRight), { x: -1, y: -1 });
  //     expectPointClose(rect.toParentSpace(rect.bottomLeft), { x: 0, y: -1 });

  //     // console.log(rect.vertices.map((v) => rect.toParentSpace(v)));
  //     rect.rotation = Math.PI / 2;
  //     // console.log(rect.vertices.map((v) => rect.toParentSpace(v)));
  //     expectPointClose(rect.toParentSpace(rect.topLeft), { x: -1, y: 0 });
  //     expectPointClose(rect.toParentSpace(rect.topRight), { x: -1, y: -1 });
  //     expectPointClose(rect.toParentSpace(rect.bottomRight), { x: 0, y: -1 });
  //     expectPointClose(rect.toParentSpace(rect.bottomLeft), { x: 0, y: 0 });
  //   });
  // });

  describe('TransformDOMRectReadonly', () => {
    test('prevents modifications through setters', () => {
      const rect = new DOMShapeReadonly({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      });

      rect.x = 20;
      rect.y = 30;
      rect.width = 200;
      rect.height = 100;
      rect.rotation = Math.PI;

      // Values should remain unchanged
      expect(rect.x).toBe(10);
      expect(rect.y).toBe(20);
      expect(rect.rotatedWidth).toBe(100);
      expect(rect.rotatedHeight).toBe(50);
      expect(rect.rotation).toBe(0);
    });

    test('allows reading properties', () => {
      const rect = new DOMShapeReadonly({
        x: 10,
        y: 20,
        width: 100,
        height: 50,
      });

      expect(rect.x).toBe(10);
      expect(rect.y).toBe(20);
      expect(rect.width).toBe(100);
      expect(rect.height).toBe(50);
    });
  });
});
