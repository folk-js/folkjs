import * as S from '@folkjs/geometry/Shape2D';
import type { Vector2Readonly } from '@folkjs/geometry/Vector2';
import { describe, expect, test } from 'bun:test';

// Helper for comparing points with floating point values
const expectPointClose = (actual: Vector2Readonly, expected: Vector2Readonly) => {
  expect(actual.x).toBeCloseTo(expected.x);
  expect(actual.y).toBeCloseTo(expected.y);
};

describe('Shape2D', () => {
  test('constructor initializes with default values', () => {
    const shape = S.fromValues();
    expect(shape.x).toBe(0);
    expect(shape.y).toBe(0);
    expect(shape.width).toBe(0);
    expect(shape.height).toBe(0);
    expect(shape.rotation).toBe(0);
  });

  test('constructor initializes with provided values', () => {
    const shape = S.fromValues(10, 20, 100, 50, Math.PI / 4);
    expect(shape.x).toBe(10);
    expect(shape.y).toBe(20);
    expect(shape.width).toBe(100);
    expect(shape.height).toBe(50);
    expect(shape.rotation).toBe(Math.PI / 4);
  });

  test('bounds are calculated correctly', () => {
    const shape = S.fromValues(10, 20, 100, 50);
    const bounds = S.bounds(shape);
    expect(bounds.x).toBe(10);
    expect(bounds.y).toBe(20);
    expect(bounds.width).toBe(100);
    expect(bounds.height).toBe(50);
  });

  test('bounds with rotation are calculated correctly', () => {
    const shape = S.fromValues(10, 20, 100, 50, Math.PI / 4);
    const bounds = S.bounds(shape);
    expect(bounds.x).toBeCloseTo(6.967);
    expect(bounds.y).toBeCloseTo(-8.033);
    expect(bounds.width).toBeCloseTo(106.066);
    expect(bounds.height).toBeCloseTo(106.066);
  });

  test('corners returns correct values', () => {
    const shape = S.fromValues(0, 0, 100, 50);
    const corners = S.corners(shape);
    expectPointClose(corners.topLeft, { x: 0, y: 0 });
    expectPointClose(corners.topRight, { x: 100, y: 0 });
    expectPointClose(corners.bottomRight, { x: 100, y: 50 });
    expectPointClose(corners.bottomLeft, { x: 0, y: 50 });
  });

  test('rotated corners returns correct values', () => {
    const shape = S.fromValues(0, 0, 100, 100, Math.PI / 2);
    const corners = S.corners(shape);
    expectPointClose(corners.topLeft, { x: 100, y: 0 });
    expectPointClose(corners.topRight, { x: 100, y: 100 });
    expectPointClose(corners.bottomRight, { x: 0, y: 100 });
    expectPointClose(corners.bottomLeft, { x: 0, y: 0 });
  });

  //   test('coordinate space conversion with rotation', () => {
  //     const shape = S.fromValues({
  //       x: 10,
  //       y: 20,
  //       width: 100,
  //       height: 50,
  //       rotation: Math.PI / 2, // 90 degrees
  //     });

  //     const parentPoint = { x: 10, y: 20 };
  //     const localPoint = shape.toLocalSpace(parentPoint);
  //     const backToParent = shape.toParentSpace(localPoint);

  //     expectPointClose(backToParent, parentPoint);
  //   });

  test('bounds are correct bounding box after rotation', () => {
    const shape = S.fromValues(
      0,
      0,
      100,
      50,
      Math.PI / 2, // 90 degrees
    );

    const bounds = S.bounds(shape);

    expect(bounds.width).toBeCloseTo(50);
    expect(bounds.height).toBeCloseTo(100);
  });

  //   test('setters update matrices correctly', () => {
  //     const shape = S.fromValues();
  //     shape.x = 10;
  //     shape.y = 20;
  //     shape.width = 100;
  //     shape.height = 50;
  //     shape.rotation = Math.PI / 4;

  //     const point = { x: 0, y: 0 };
  //     const transformed = shape.toParentSpace(point);
  //     const backToLocal = shape.toLocalSpace(transformed);

  //     expectPointClose(backToLocal, point);
  //   });

  //   test('coordinate transformations with rotation and translation', () => {
  //     const shape = S.fromValues({
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
  //       const localPoint = shape.toLocalSpace(point);
  //       const backToParent = shape.toParentSpace(localPoint);
  //       expectPointClose(backToParent, point);
  //     });
  //   });

  describe('corner', () => {
    test('set topLeft corner', () => {
      const shape = S.fromValues(10, 10, 10, 10);

      S.setTopLeftCorner(shape, { x: 15, y: 15 });

      expect(shape.x).toBe(15);
      expect(shape.y).toBe(15);
      expect(shape.width).toBe(5);
      expect(shape.height).toBe(5);
      expectPointClose(S.topLeftCorner(shape), { x: 15, y: 15 });
    });

    test('set topRight corner', () => {
      const shape = S.fromValues(10, 10, 10, 10);

      S.setTopRightCorner(shape, { x: 15, y: 15 });

      expect(shape.x).toBe(10);
      expect(shape.y).toBe(15);
      expect(shape.width).toBe(5);
      expect(shape.height).toBe(5);
      expectPointClose(S.topRightCorner(shape), { x: 15, y: 15 });
    });

    test('set bottomRight corner', () => {
      const shape = S.fromValues(10, 10, 10, 10);

      S.setBottomRightCorner(shape, { x: 15, y: 15 });

      expect(shape.x).toBe(10);
      expect(shape.y).toBe(10);
      expect(shape.width).toBe(5);
      expect(shape.height).toBe(5);
      expectPointClose(S.bottomRightCorner(shape), { x: 15, y: 15 });
    });

    test('set bottomLeft cornner', () => {
      const shape = S.fromValues(10, 10, 10, 10);

      S.setBottomLeftCorner(shape, { x: 15, y: 15 });

      expect(shape.x).toBe(15);
      expect(shape.y).toBe(10);
      expect(shape.width).toBe(5);
      expect(shape.height).toBe(5);
      expectPointClose(S.bottomLeftCorner(shape), { x: 15, y: 15 });
    });

    test('topLeft corner setters with rotation', () => {
      const shape = S.fromValues(10, 10, 10, 10, Math.PI / 2);

      S.setTopLeftCorner(shape, { x: 15, y: 15 });

      expect(shape.x).toBe(10);
      expect(shape.y).toBe(15);
      expect(shape.width).toBe(5);
      expect(shape.height).toBe(5);
      expectPointClose(S.topLeftCorner(shape), { x: 15, y: 15 });
    });

    test('bottomRight corner setters with rotation', () => {
      const shape = S.fromValues(10, 10, 10, 10, Math.PI / 2);

      S.setBottomRightCorner(shape, { x: 15, y: 15 });

      expect(shape.x).toBe(15);
      expect(shape.y).toBe(10);
      expect(shape.width).toBe(5);
      expect(shape.height).toBe(5);
      expectPointClose(S.bottomRightCorner(shape), { x: 15, y: 15 });
    });

    test('set bottomRight works with upside down rotation', () => {
      const shape = S.fromValues(
        100,
        100,
        200,
        100,
        Math.PI, // 180 degrees - upside down
      );

      S.setBottomRightCorner(shape, { x: 150, y: 75 });

      expect(shape.x).toBe(150);
      expect(shape.y).toBe(75);
      expect(shape.width).toBe(150);
      expect(shape.height).toBe(125);

      // Verify the corner is actually at the expected position in local space
      expectPointClose(S.bottomRightCorner(shape), { x: 150, y: 75 });
    });

    test('resizing from corners keeps the opposite corner fixed without rotation', () => {
      const shape = S.fromValues(100, 100, 200, 100, 0);

      const originalTopLeft = S.topLeftCorner(shape);

      // Resize from bottom-right corner
      S.setBottomRightCorner(shape, { x: 300, y: 200 });

      // Opposite corner (top-left) should remain the same
      expectPointClose(S.topLeftCorner(shape), originalTopLeft);
    });

    test('resizing from corners keeps the opposite corner fixed with rotation', () => {
      const shape = S.fromValues(
        100,
        100,
        200,
        100,
        Math.PI / 4, // 45 degrees
      );

      const oldTopLeft = S.topLeftCorner(shape);

      S.setBottomRightCorner(shape, { x: 300, y: 150 });

      expectPointClose(S.topLeftCorner(shape), oldTopLeft);
    });

    test.skip('rotate with origin', () => {
      const shape = S.fromValues(0, 0, 1, 1);

      // rotate around origin
      S.rotateAround(shape, Math.PI, { x: 0, y: 0 });
      const corners = S.corners(shape);
      expectPointClose(corners.topLeft, { x: 0, y: 0 });
      expectPointClose(corners.topRight, { x: -1, y: 0 });
      expectPointClose(corners.bottomRight, { x: -1, y: -1 });
      expectPointClose(corners.bottomLeft, { x: 0, y: -1 });

      // rotate around center
      shape.rotation -= Math.PI / 2;
      const newCorners = S.corners(shape);
      expectPointClose(newCorners.topLeft, { x: -1, y: 0 });
      expectPointClose(newCorners.topRight, { x: -1, y: -1 });
      expectPointClose(newCorners.bottomRight, { x: 0, y: -1 });
      expectPointClose(newCorners.bottomLeft, { x: 0, y: 0 });
    });
  });

  //   describe('point conversion with rotation', () => {
  //     test('converts points correctly with 45-degree rotation', () => {
  //       const shape = S.fromValues({
  //         x: 100,
  //         y: 100,
  //         width: 100,
  //         height: 100,
  //         rotation: Math.PI / 4, // 45 degrees
  //       });

  //       expectPointClose(shape.center, { x: 150, y: 150 }); // Center in parent space
  //       // Center point should remain at the same position after transformation
  //       const center = { x: 50, y: 50 }; // Center in local space
  //       const centerInParent = shape.toParentSpace(center);
  //       expectPointClose(centerInParent, { x: 150, y: 150 }); // Center in parent space

  //       // Test a point on the edge
  //       const edge = { x: 100, y: 50 }; // Right-middle in local space
  //       const edgeInParent = shape.toParentSpace(edge);
  //       // At 45 degrees, this point should be √2/2 * 100 units right and up from center
  //       expectPointClose(edgeInParent, {
  //         x: 150 + Math.cos(Math.PI / 4) * 50,
  //         y: 150 + Math.sin(Math.PI / 4) * 50,
  //       });
  //     });

  //     test('maintains relative positions through multiple transformations', () => {
  //       const shape = S.fromValues({
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
  //           const parent1 = shape.toParentSpace(point1);
  //           const parent2 = shape.toParentSpace(point2);

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
  //         const shape = S.fromValues({
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
  //           const parentPoint = shape.toParentSpace(localPoint);
  //           const backToLocal = shape.toLocalSpace(parentPoint);
  //           expectPointClose(backToLocal, localPoint);
  //         });
  //       });
  //     });

  //     test('maintains aspect ratio through transformations', () => {
  //       const shape = S.fromValues({
  //         x: 100,
  //         y: 100,
  //         width: 200,
  //         height: 100,
  //         rotation: Math.PI / 3, // 60 degrees
  //       });

  //       // Test diagonal distances
  //       const topLeft = { x: 0, y: 0 };
  //       const bottomRight = { x: 200, y: 100 };

  //       const topLeftParent = shape.toParentSpace(topLeft);
  //       const bottomRightParent = shape.toParentSpace(bottomRight);

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
  //       const shape = S.fromValues();
  //       expectPointClose(shape.transformOrigin, { x: 0.5, y: 0.5 });
  //     });

  //     test('constructor accepts custom origins', () => {
  //       const shape = S.fromValues({
  //         transformOrigin: { x: 0, y: 0 },
  //       });
  //       expectPointClose(shape.transformOrigin, { x: 0, y: 0 });
  //     });

  //     test('maintains point relationships with custom origins', () => {
  //       const shape = S.fromValues({
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
  //         const transformed = shape.toParentSpace(point);
  //         const backToLocal = shape.toLocalSpace(transformed);
  //         expectPointClose(backToLocal, point);
  //       });
  //     });
  //   });

  //   test('rotate with origin', () => {
  //     const shape = S.fromValues({
  //       x: 0,
  //       y: 0,
  //       width: 1,
  //       height: 1,
  //     });

  //     shape.rotate(Math.PI, { x: 0, y: 0 });

  //     expectPointClose(shape.toParentSpace(shape.topLeft), { x: 0, y: 0 });
  //     expectPointClose(shape.toParentSpace(shape.topRight), { x: -1, y: 0 });
  //     expectPointClose(shape.toParentSpace(shape.bottomRight), { x: -1, y: -1 });
  //     expectPointClose(shape.toParentSpace(shape.bottomLeft), { x: 0, y: -1 });

  //     // console.log(shape.vertices.map((v) => shape.toParentSpace(v)));
  //     shape.rotation = Math.PI / 2;
  //     // console.log(shape.vertices.map((v) => shape.toParentSpace(v)));
  //     expectPointClose(shape.toParentSpace(shape.topLeft), { x: -1, y: 0 });
  //     expectPointClose(shape.toParentSpace(shape.topRight), { x: -1, y: -1 });
  //     expectPointClose(shape.toParentSpace(shape.bottomRight), { x: 0, y: -1 });
  //     expectPointClose(shape.toParentSpace(shape.bottomLeft), { x: 0, y: 0 });
  //   });
  // });
});
