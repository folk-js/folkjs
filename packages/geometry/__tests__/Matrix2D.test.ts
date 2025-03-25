import { expect } from 'expect';
import { describe, test } from 'node:test';
import * as M from '../src/Matrix2D.ts';
import { PI } from '../src/utilities.ts';

describe('Matrix2D', () => {
  test('rotate', () => {
    const m = M.rotate(M.fromValues(1, 2, 3, 4, 5, 6), PI / 2);

    expect(m).toBe(M.fromValues(3, 4, -1, -2, 6));
  });

  test('scale', () => {
    const m = M.scale(M.fromValues(1, 2, 3, 4, 5, 6), 2, 3);

    expect(m).toBe(M.fromValues(2, 4, 9, 12, 5, 6));
  });

  test('translate', () => {
    const m = M.translate(M.fromValues(1, 2, 3, 4, 5, 6), 2, 3);

    expect(m).toBe(M.fromValues(1, 2, 3, 4, 16, 22));
  });

  test('invert', () => {
    const m = M.invert(M.fromValues(1, 2, 3, 4, 5, 6));

    expect(m).toStrictEqual(M.fromValues(-2, 1, 1.5, -0.5, 1, -2));
  });

  test('determinant', () => {
    const m = M.fromValues(1, 2, 3, 4, 5, 6);

    expect(M.determinant(m)).toStrictEqual(-2);
  });

  test('multiply', () => {
    const m1 = M.fromValues(1, 2, 3, 4, 5, 6);
    const m2 = M.fromValues(7, 8, 9, 10, 11, 12);

    expect(M.multiply(m1, m2)).toStrictEqual(M.fromValues(31, 46, 39, 58, 52, 76));
  });

  describe('lerp', () => {
    test('negative alpha', () => {
      const m1 = M.fromTranslate(10, 10);
      const m2 = M.fromValues();

      expect(M.lerp(m1, m2, -0.1)).toStrictEqual(m1);
    });

    test('alpha greater than 1', () => {
      const m1 = M.fromValues();
      const m2 = M.fromTranslate(10, 10);

      expect(M.lerp(m1, m2, 1.1)).toStrictEqual(m2);
    });

    test('alpha is 0', () => {
      const m1 = M.fromValues();
      const m2 = M.fromTranslate(10, 10);

      expect(M.lerp(m1, m2, 0)).toStrictEqual(m1);
    });

    test('alpha is 0', () => {
      const m1 = M.fromValues();
      const m2 = M.fromTranslate(10, 10);

      expect(M.lerp(m1, m2, 1)).toStrictEqual(m2);
    });

    test('50% translate', () => {
      const m1 = M.fromValues();
      const m2 = M.fromTranslate(10, 10);

      expect(M.lerp(m1, m2, 0.5)).toStrictEqual(M.fromTranslate(5, 5));
    });

    test('50% scale', () => {
      const m1 = M.fromValues();
      const m2 = M.fromScale(0.5);

      expect(M.lerp(m1, m2, 0.5)).toStrictEqual(M.fromScale(0.75));
    });

    test('50% rotation', () => {
      const m1 = M.fromValues();
      const m2 = M.fromRotate(PI / 4);

      expect(M.lerp(m1, m2, 0.5)).toStrictEqual(M.fromRotate(PI / 8));
    });

    test('50% translate and scale', () => {
      const m1 = M.fromValues();
      const m2 = M.scaleSelf(M.fromTranslate(10, 10), 2);

      expect(M.lerp(m1, m2, 0.5)).toStrictEqual(M.scaleSelf(M.fromTranslate(5, 5), 1.5));
    });
  });
});
