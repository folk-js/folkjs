import { describe, expect, test } from 'bun:test';
import * as V from '../src/Vector2.ts';

describe('V', () => {
  describe('basic operations', () => {
    test('zero() returns zero vector', () => {
      expect(V.zero()).toEqual({ x: 0, y: 0 });
    });

    test('add() combines two vectors', () => {
      const a = { x: 1, y: 2 };
      const b = { x: 3, y: 4 };
      expect(V.add(a, b)).toEqual({ x: 4, y: 6 });
    });

    test('sub() subtracts vectors', () => {
      const a = { x: 3, y: 4 };
      const b = { x: 1, y: 2 };
      expect(V.subtract(a, b)).toEqual({ x: 2, y: 2 });
    });

    test('mult() multiplies vectors component-wise', () => {
      const a = { x: 2, y: 3 };
      const b = { x: 4, y: 5 };
      expect(V.multiply(a, b)).toEqual({ x: 8, y: 15 });
    });

    test('scale() multiplies vector by scalar', () => {
      const v = { x: 2, y: 3 };
      expect(V.scale(v, 2)).toEqual({ x: 4, y: 6 });
    });
  });

  describe('vector properties', () => {
    test('mag() calculates magnitude', () => {
      const v = { x: 3, y: 4 };
      expect(V.magnitude(v)).toBe(5);
    });

    test('normalized() returns unit vector', () => {
      const v = { x: 3, y: 4 };
      const normalized = V.normalized(v);
      expect(normalized.x).toBeCloseTo(0.6);
      expect(normalized.y).toBeCloseTo(0.8);
    });

    test('normalized() handles zero vector', () => {
      const v = { x: 0, y: 0 };
      expect(V.normalized(v)).toEqual({ x: 0, y: 0 });
    });
  });

  describe('distance calculations', () => {
    test('distance() calculates Euclidean distance', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };
      expect(V.distance(a, b)).toBe(5);
    });

    test('distanceSquared() calculates squared distance', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 3, y: 4 };
      expect(V.distanceSquared(a, b)).toBe(25);
    });
  });

  describe('interpolation and rotation', () => {
    test('lerp() interpolates between points', () => {
      const a = { x: 0, y: 0 };
      const b = { x: 10, y: 10 };
      expect(V.lerp(a, b, 0.5)).toEqual({ x: 5, y: 5 });
    });

    test('rotate() rotates vector by angle', () => {
      const v = { x: 1, y: 0 };
      const rotated = V.rotate(v, Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0);
      expect(rotated.y).toBeCloseTo(1);
    });

    test('rotateAround() rotates point around pivot', () => {
      const point = { x: 2, y: 0 };
      const pivot = { x: 0, y: 0 };
      const rotated = V.rotateAround(point, pivot, Math.PI / 2);
      expect(rotated.x).toBeCloseTo(0);
      expect(rotated.y).toBeCloseTo(2);
    });
  });

  describe('angle calculations', () => {
    test('angle() calculates angle from x-axis', () => {
      const v = { x: 1, y: 1 };
      expect(V.angle(v)).toBeCloseTo(Math.PI / 4);
    });

    test('angleTo() calculates angle between vectors', () => {
      const a = { x: 1, y: 0 };
      const b = { x: 0, y: 1 };
      expect(V.angleTo(b, a)).toBeCloseTo(Math.PI / 2);
    });

    test('angleFromOrigin() calculates angle relative to origin', () => {
      const point = { x: 1, y: 1 };
      const origin = { x: 0, y: 0 };
      expect(V.angleFromOrigin(point, origin)).toBeCloseTo(Math.PI / 4);
    });
  });
});
