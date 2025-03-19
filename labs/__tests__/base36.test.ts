import { describe, expect, test } from 'bun:test';
import { base36ToNum, numToBase36 } from '../utils/base36';

describe('base36 encoding', () => {
  test('encode single number', () => {
    expect(numToBase36(0)).toBe('000');
    expect(numToBase36(1)).toBe('001');
    expect(numToBase36(35)).toBe('00z');
    expect(numToBase36(36)).toBe('010');
    expect(numToBase36(46655)).toBe('zzz');
  });

  test('decode single number', () => {
    expect(base36ToNum('000')).toBe(0);
    expect(base36ToNum('001')).toBe(1);
    expect(base36ToNum('00z')).toBe(35);
    expect(base36ToNum('010')).toBe(36);
    expect(base36ToNum('zzz')).toBe(46655);
  });

  test('encode/decode roundtrip', () => {
    const testValues = [0, 1, 35, 36, 1000, 46655];
    for (const value of testValues) {
      const encoded = numToBase36(value);
      const decoded = base36ToNum(encoded);
      expect(decoded).toBe(value);
    }
  });

  test('encode out of range', () => {
    expect(() => numToBase36(-1)).toThrow('Number out of range');
    expect(() => numToBase36(46656)).toThrow('Number out of range');
  });

  test('decode invalid input', () => {
    expect(() => base36ToNum('00')).toThrow('Invalid length');
    expect(() => base36ToNum('0000')).toThrow('Invalid length');
    expect(() => base36ToNum('AA!')).toThrow('Invalid character');
    expect(() => base36ToNum('AAA')).toThrow('Invalid character');
  });
});
