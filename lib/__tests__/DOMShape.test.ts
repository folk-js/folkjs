import { describe, expect, test } from 'bun:test';
import { DOMShape, DOMShapeReadonly } from '../DOMShape.ts';
import { Point } from '../types';

// Helper for comparing points with floating point values
const expectPointClose = (actual: Point, expected: Point) => {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
};

describe('DOMShape', () => {
  test('constructor initializes with default values', () => {
    const rect = new DOMShape();
    expect(rect.x).toBe(0);
    expect(rect.y).toBe(0);
    expect(rect.width).toBe(0);
    expect(rect.height).toBe(0);
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
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(50);
    expect(rect.rotation).toBe(Math.PI / 4);
  });

  test('DOMRect properties are calculated correctly', () => {
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

  test('vertices returns correct corners', () => {
    const rect = new DOMShape({
      width: 100,
      height: 50,
    });

    expectPointClose(rect.topLeft, { x: 0, y: 0 });
    expectPointClose(rect.topRight, { x: 100, y: 0 });
    expectPointClose(rect.bottomRight, { x: 100, y: 50 });
    expectPointClose(rect.bottomLeft, { x: 0, y: 50 });
  });

  // test('coordinate space conversion with rotation', () => {
  //   const rect = new DOMShape({
  //     x: 10,
  //     y: 20,
  //     width: 100,
  //     height: 50,
  //     rotation: Math.PI / 2, // 90 degrees
  //   });

  //   const parentPoint = { x: 10, y: 20 };
  //   const localPoint = rect.toLocalSpace(parentPoint);
  //   const backToParent = rect.toParentSpace(localPoint);

  //   expectPointClose(backToParent, parentPoint);
  // });

  test('correct bounding box after rotation', () => {
    const rect = new DOMShape({
      x: 0,
      y: 0,
      width: 100,
      height: 50,
      rotation: Math.PI / 2, // 90 degrees
    });

    expect(rect.x).toBeCloseTo(0);
    expect(rect.y).toBeCloseTo(0);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(50);
  });

  test('setters update shape correctly', () => {
    const rect = new DOMShape();
    rect.x = 10;
    rect.y = 20;
    rect.width = 100;
    rect.height = 50;
    rect.rotation = Math.PI / 4;

    expect(rect.x).toBeCloseTo(10);
    expect(rect.y).toBeCloseTo(20);
    expect(rect.width).toBeCloseTo(100);
    expect(rect.height).toBeCloseTo(50);
  });

  test('coordinate transformations with rotation and translation', () => {
    const rect = new DOMShape({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: Math.PI / 4, // 45 degrees
    });

    expectPointClose({ x: rect.x, y: rect.y }, { x: 100, y: 100 });
    expectPointClose(rect.center, { x: 200, y: 150 });
    expectPointClose({ x: rect.right, y: rect.bottom }, { x: 300, y: 200 });
  });
});

describe('DOMShape corners', () => {
  test('set topLeft corner ', () => {
    const rect = new DOMShape({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    rect.topLeft = { x: 150, y: 125 };

    expect(rect.x).toBe(150); // Original x + local x
    expect(rect.y).toBe(125); // Original y + local y
    expect(rect.width).toBe(150); // Original width - local x
    expect(rect.height).toBe(75); // Original height - local y
  });

  test('set topRight corner', () => {
    const rect = new DOMShape({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    rect.topRight = { x: 250, y: 125 };

    expect(rect.x).toBe(100); // Original x unchanged
    expect(rect.y).toBe(125); // Original y + local y
    expect(rect.width).toBe(150); // New local x
    expect(rect.height).toBe(75); // Original height - local y
  });

  test('set bottomRight corner', () => {
    const rect = new DOMShape({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    rect.bottomRight = { x: 250, y: 175 };

    expect(rect.x).toBe(100); // Original x unchanged
    expect(rect.y).toBe(100); // Original y unchanged
    expect(rect.width).toBe(150); // New local x
    expect(rect.height).toBe(75); // New local y
  });

  test('set bottomLeft corner', () => {
    const rect = new DOMShape({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
    });

    rect.bottomLeft = { x: 150, y: 175 };
    expect(rect.x).toBe(150); // Original x + local x
    expect(rect.y).toBe(100); // Original y unchanged
    expect(rect.width).toBe(150); // Original width - local x
    expect(rect.height).toBe(75); // New local y
  });

  test('topLeft corner with rotation', () => {
    const rect = new DOMShape({
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: Math.PI / 4, // 45 degrees
    });
    console.log(rect.x, rect.y, rect.topLeft);
    // Move top-left corner in local space
    rect.topLeft = { x: 50, y: 25 };

    expect(rect.x).toBeCloseTo(50);
    expect(rect.y).toBeCloseTo(25);
    expect(rect.width).toBe(150); // Original width - local x
    expect(rect.height).toBe(75); // Original height - local y
  });

  //     test('set bottomRight works with upside down rotation', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 200,
  //         height: 100,
  //         rotation: Math.PI, // 180 degrees - upside down
  //       });

  //       // Set bottom-right corner in local space
  //       rect.bottomRight = { x: 150, y: 75 };

  //       expect(rect.width).toBe(150);
  //       expect(rect.height).toBe(75);

  //       // Verify the corner is actually at the expected position in local space
  //       expectPointClose(rect.bottomRight, { x: 150, y: 75 });
  //     });

  //     test('resizing from corners keeps the opposite corner fixed without rotation', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 200,
  //         height: 100,
  //         rotation: 0,
  //       });

  //       const originalTopLeft = rect.topLeft;

  //       // Resize from bottom-right corner
  //       rect.bottomRight = { x: 300, y: 200 };

  //       // Opposite corner (top-left) should remain the same
  //       expectPointClose(rect.topLeft, originalTopLeft);
  //     });

  //     test('resizing from corners keeps the opposite corner fixed with rotation', () => {
  //       const rect = new DOMShape({
  //         x: 100,
  //         y: 100,
  //         width: 200,
  //         height: 100,
  //         rotation: Math.PI / 4, // 45 degrees
  //       });

  //       const originalTopLeft = rect.toParentSpace(rect.topLeft);
  //       const originalBottomRight = rect.toParentSpace(rect.bottomRight);

  //       // Resize from bottom-right corner in local space
  //       rect.bottomRight = { x: 300, y: 150 };

  //       // Transform corners back to parent space to compare
  //       const newTopLeft = rect.toParentSpace(rect.topLeft);
  //       const newBottomRight = rect.toParentSpace(rect.bottomRight);

  //       // Opposite corner (top-left) should remain the same in parent space
  //       expectPointClose(newTopLeft, originalTopLeft);

  //       // New bottom-right should be updated correctly in parent space
  //       // Calculate the expected new bottom-right position
  //       const expectedBottomRightLocal = { x: 300, y: 150 };
  //       const expectedBottomRightParent = rect.toParentSpace(expectedBottomRightLocal);

  //       expectPointClose(newBottomRight, expectedBottomRightParent);
  //     });
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
//       const gridPoints: Point[] = [];
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
//         Math.pow(bottomRightParent.x - topLeftParent.x, 2) + Math.pow(bottomRightParent.y - topLeftParent.y, 2)
//       );

//       // Distances should be preserved
//       expect(parentDiagonal).toBeCloseTo(localDiagonal);
//     });
//   });

//   describe('transform and rotate origins', () => {
//     test('constructor initializes with default origins at center', () => {
//       const rect = new DOMShape();
//       expectPointClose(rect.transformOrigin, { x: 0.5, y: 0.5 });
//       expectPointClose(rect.rotateOrigin, { x: 0.5, y: 0.5 });
//     });

//     test('constructor accepts custom origins', () => {
//       const rect = new DOMShape({
//         transformOrigin: { x: 0, y: 0 },
//         rotateOrigin: { x: 1, y: 1 },
//       });
//       expectPointClose(rect.transformOrigin, { x: 0, y: 0 });
//       expectPointClose(rect.rotateOrigin, { x: 1, y: 1 });
//     });

//     test('maintains point relationships with custom origins', () => {
//       const rect = new DOMShape({
//         x: 100,
//         y: 100,
//         width: 100,
//         height: 100,
//         rotation: Math.PI / 3, // 60 degrees
//         transformOrigin: { x: 0.25, y: 0.75 },
//         rotateOrigin: { x: 0.75, y: 0.25 },
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
    expect(rect.width).toBe(100);
    expect(rect.height).toBe(50);
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
