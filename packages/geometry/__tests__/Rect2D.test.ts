import { expect } from 'expect';
import { describe, test } from 'node:test';
import * as R from '../src/Rect2D.ts';

describe('Rect2D', () => {
  test('bounds utility', () => {
    const bounds = R.bounds(R.fromValues(0, 0, 10, 10), R.fromValues(15, 15, 10, 10));

    expect(bounds).toStrictEqual({
      x: 0,
      y: 0,
      width: 25,
      height: 25,
    });
  });
});
