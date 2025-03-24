import { Matrix } from '@folkjs/lib/Matrix';
import { describe, expect, test } from 'bun:test';

describe('Matrix', () => {
  describe('lerp', () => {
    test('negative alpha', () => {
      const m1 = Matrix.Identity().translate(10, 10);
      const m2 = Matrix.Identity();

      expect(m1.lerp(m2, -0.1)).toBeUndefined();
    });

    test('alpha greater than 1', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().translate(10, 10);

      expect(m1.lerp(m2, 1.1)).toBeUndefined();
    });

    test('alpha is 0', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().translate(10, 10);

      expect(m1.lerp(m2, 0)).toStrictEqual(m1);
    });

    test('alpha is 0', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().translate(10, 10);

      expect(m1.lerp(m2, 1)).toStrictEqual(m2);
    });

    test('50% translate', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().translate(10, 10);

      expect(m1.lerp(m2, 0.5)).toStrictEqual(Matrix.Identity().translate(5, 5));
    });

    test('50% scale', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().scale(0.5);

      expect(m1.lerp(m2, 0.5)).toStrictEqual(Matrix.Identity().scale(0.75));
    });

    test('50% rotation', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().rotate(Math.PI / 4);

      expect(m1.lerp(m2, 0.5)).toStrictEqual(Matrix.Identity().rotate(Math.PI / 8));
    });

    test('50% translate and scale', () => {
      const m1 = Matrix.Identity();
      const m2 = Matrix.Identity().translate(10, 10).scale(2);

      expect(m1.lerp(m2, 0.5)).toStrictEqual(Matrix.Identity().translate(5, 5).scale(1.5));
    });
  });
});
