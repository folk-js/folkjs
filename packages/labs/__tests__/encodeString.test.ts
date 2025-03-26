import { expect } from 'expect';
import { describe, test } from 'node:test';
import { encodeString } from '../src/utils/encodeString.ts';

// Basic encoding functionality
describe('String encoding templates', () => {
  test('should encode and decode a simple string', () => {
    const encoder = encodeString('<name>');
    const encoded = encoder.encode({ name: 'John' });
    expect(encoded).toBe('John');
    const decoded = encoder.decode('John');
    expect(decoded).toEqual({ name: 'John' });
  });

  test('should handle multiple text fields', () => {
    const encoder = encodeString('<firstName> <lastName>');
    const encoded = encoder.encode({ firstName: 'John', lastName: 'Doe' });
    expect(encoded).toBe('John Doe');
    const decoded = encoder.decode('John Doe');
    expect(decoded).toEqual({ firstName: 'John', lastName: 'Doe' });
  });

  test('should handle static prefix and suffix', () => {
    const encoder = encodeString('Hello, <name> foo');
    const encoded = encoder.encode({ name: 'Alice' });
    expect(encoded).toBe('Hello, Alice foo');
    const decoded = encoder.decode('Hello, Alice foo');
    expect(decoded).toEqual({ name: 'Alice' });
  });

  test('should handle complex formats with multiple fields', () => {
    const encoder = encodeString('<method> <path> HTTP/<version>');
    const encoded = encoder.encode({ method: 'GET', path: '/api/users', version: '1.1' });
    expect(encoded).toBe('GET /api/users HTTP/1.1');
    const decoded = encoder.decode('GET /api/users HTTP/1.1');
    expect(decoded).toEqual({ method: 'GET', path: '/api/users', version: '1.1' });
  });
});

describe('String encoding', () => {
  test('should throw error for missing required field', () => {
    const encoder = encodeString('<firstName> <lastName>');
    expect(() => {
      // @ts-expect-error - missing required field
      encoder.encode({ firstName: 'John' });
    }).toThrow('Missing required field "lastName"');
  });

  test('should handle mixed field types with fixed width', () => {
    const encoder = encodeString('<id:num-3>|<name:text-5>|<active:bool>');
    const encoded = encoder.encode({ id: 42, name: 'Alice', active: true });
    expect(encoded).toBe('042|Alice|true');
  });

  test('should handle mixed field types', () => {
    const encoder = encodeString('D|<name:text>:<age:num>|<active:bool>');
    const encoded = encoder.encode({ name: 'John', age: 30, active: true });
    expect(encoded).toBe('D|John:30|true');
  });
});

describe('String decoding', () => {
  test('should return null if input does not match pattern', () => {
    const encoder = encodeString('Hello <n>');
    const result = encoder.decode('Invalid input');
    expect(result).toBeNull();
  });

  test("should return null if delimiter can't be found", () => {
    const encoder = encodeString('<firstName> <lastName>');
    const result = encoder.decode('JohnDoe'); // Missing space delimiter
    expect(result).toBeNull();
  });

  test('should handle mixed field types with fixed width', () => {
    const encoder = encodeString('<id:num-3>|<name:text-5>|<active:bool>');
    const decoded = encoder.decode('042|Alice|true');
    expect(decoded).toEqual({ id: 42, name: 'Alice', active: true });
  });

  test('should handle mixed field types', () => {
    const encoder = encodeString('D|<name:text>:<age:num>|<active:bool>');
    const decoded = encoder.decode('D|John:30|true');
    expect(decoded).toEqual({ name: 'John', age: 30, active: true });
  });
});

// Type-specific testing
describe('Text type', () => {
  test('should handle basic text field', () => {
    const hdr = encodeString('<message:text>');
    const encoded = hdr.encode({ message: 'Hello world' });
    expect(encoded).toBe('Hello world');
    const decoded = hdr.decode('Hello world');
    expect(decoded).toEqual({ message: 'Hello world' });
  });

  test('should handle fixed width text', () => {
    const hdr = encodeString('<code:text-5>');
    const encoded = hdr.encode({ code: 'ABCDE' });
    expect(encoded).toBe('ABCDE');
    const decoded = hdr.decode('ABCDE');
    expect(decoded).toEqual({ code: 'ABCDE' });
  });

  test('should pad shorter values in fixed width text', () => {
    const hdr = encodeString('<code:text-5>');
    const encoded = hdr.encode({ code: 'ABC' });
    expect(encoded).toBe('ABC  ');
    const decoded = hdr.decode('ABC  ');
    expect(decoded).toEqual({ code: 'ABC  ' });
  });

  test('should throw error for values exceeding fixed width', () => {
    const hdr = encodeString('<code:text-5>');
    expect(() => {
      hdr.encode({ code: 'ABCDEFGHI' });
    }).toThrow('Value "ABCDEFGHI" exceeds fixed width of 5');
  });
});

describe('Number type', () => {
  test('should handle basic number field', () => {
    const hdr = encodeString('<count:num>');
    const encoded = hdr.encode({ count: 123 });
    expect(encoded).toBe('123');
    const decoded = hdr.decode('123');
    expect(decoded).toEqual({ count: 123 });
  });

  test('should handle fixed width number with padding', () => {
    const hdr = encodeString('<code:num-4>');
    const encoded = hdr.encode({ code: 42 });
    expect(encoded).toBe('0042');
    const decoded = hdr.decode('0042');
    expect(decoded).toEqual({ code: 42 });
  });

  test('should handle very small numbers with fixed width', () => {
    const hdr = encodeString('<code:num-4>');
    const encoded = hdr.encode({ code: 7 });
    expect(encoded).toBe('0007');
    const decoded = hdr.decode('0007');
    expect(decoded).toEqual({ code: 7 });
  });

  test('should throw error for numbers exceeding fixed width', () => {
    const hdr = encodeString('<code:num-4>');
    expect(() => {
      hdr.encode({ code: 123456 });
    }).toThrow();
  });
});

describe('Boolean type', () => {
  test('should handle true value', () => {
    const hdr = encodeString('<active:bool>');
    const encoded = hdr.encode({ active: true });
    expect(encoded).toBe('true');
    const decoded = hdr.decode('true');
    expect(decoded).toEqual({ active: true });
  });

  test('should handle false value', () => {
    const hdr = encodeString('<active:bool>');
    const encoded = hdr.encode({ active: false });
    expect(encoded).toBe('false');
    const decoded = hdr.decode('false');
    expect(decoded).toEqual({ active: false });
  });

  test('should be case-insensitive when decoding', () => {
    const hdr = encodeString('<active:bool>');
    const decoded = hdr.decode('TRUE');
    expect(decoded).toEqual({ active: true });
    const decoded2 = hdr.decode('False');
    expect(decoded2).toEqual({ active: false });
  });
});

describe('List type', () => {
  test('should handle basic list field', () => {
    const hdr = encodeString('<items:list>');
    const encoded = hdr.encode({ items: ['apple', 'banana', 'cherry'] });
    expect(encoded).toBe('apple,banana,cherry');
    const decoded = hdr.decode('apple,banana,cherry');
    expect(decoded).toEqual({ items: ['apple', 'banana', 'cherry'] });
  });

  test('should handle empty list', () => {
    const hdr = encodeString('<items:list>');
    const encoded = hdr.encode({ items: [] });
    expect(encoded).toBe('');
    const decoded = hdr.decode('');
    expect(decoded).toEqual({ items: [] });
  });

  test('should handle fixed width list', () => {
    const hdr = encodeString('<codes:list-2>');
    const encoded = hdr.encode({ codes: ['AA', 'BB', 'CC'] });
    expect(encoded).toBe('AABBCC');
    const decoded = hdr.decode('AABBCC');
    expect(decoded).toEqual({ codes: ['AA', 'BB', 'CC'] });
  });

  test('should pad shorter values in fixed width list', () => {
    const hdr = encodeString('<codes:list-2>');
    const encoded = hdr.encode({ codes: ['A', 'B', 'C'] });
    expect(encoded).toBe('A B C ');
    const decoded = hdr.decode('A B C ');
    expect(decoded).toEqual({ codes: ['A ', 'B ', 'C '] });
  });

  test('should throw error for list items exceeding fixed width', () => {
    const hdr = encodeString('<codes:list-2>');
    expect(() => {
      hdr.encode({ codes: ['AAA', 'BB', 'CC'] });
    }).toThrow('Value "AAA" exceeds fixed width of 2');
  });
});

describe('Numeric list (nums) type', () => {
  test('should handle basic nums field', () => {
    const hdr = encodeString('<values:nums>');
    const encoded = hdr.encode({ values: [10, 20, 30] });
    expect(encoded).toBe('10,20,30');
    const decoded = hdr.decode('10,20,30');
    expect(decoded).toEqual({ values: [10, 20, 30] });
  });

  test('should handle empty numeric list', () => {
    const hdr = encodeString('<values:nums>');
    const encoded = hdr.encode({ values: [] });
    expect(encoded).toBe('');
    const decoded = hdr.decode('');
    expect(decoded).toEqual({ values: [] });
  });

  test('should handle fixed width nums', () => {
    const hdr = encodeString('<values:nums-3>');
    const encoded = hdr.encode({ values: [7, 42, 123] });
    expect(encoded).toBe('007042123');
    const decoded = hdr.decode('007042123');
    expect(decoded).toEqual({ values: [7, 42, 123] });
  });

  test('should throw error for numbers exceeding fixed width', () => {
    const hdr = encodeString('<values:nums-3>');
    expect(() => {
      hdr.encode({ values: [1234, 5678, 9012] });
    }).toThrow('Value "1234" exceeds fixed width of 3');
  });
});

describe('Pairs type', () => {
  test('should handle basic pairs field', () => {
    const hdr = encodeString('<config:pairs>');
    const pairs = [
      ['name', 'test'],
      ['version', '1.0'],
    ] as [string, string][];
    const encoded = hdr.encode({ config: pairs });
    expect(encoded).toBe('name;test;version;1.0');
    const decoded = hdr.decode('name;test;version;1.0');
    expect(decoded).toEqual({ config: pairs });
  });

  test('should handle empty pairs', () => {
    const hdr = encodeString('<config:pairs>');
    const encoded = hdr.encode({ config: [] });
    expect(encoded).toBe('');
    const decoded = hdr.decode('');
    expect(decoded).toEqual({ config: [] });
  });

  test('should ignore size parameter for pairs', () => {
    const hdr = encodeString('<config:pairs-4>');
    const pairs = [
      ['name', 'test'],
      ['ver', '1.0'],
    ] as [string, string][];
    // Fixed width for pairs is ignored - it formats as regular pairs
    const encoded = hdr.encode({ config: pairs });
    expect(encoded).toBe('name;test;ver;1.0');
    const decoded = hdr.decode('name;test;ver;1.0');
    expect(decoded).toEqual({ config: pairs });
  });
});

describe('Numeric pairs (numPairs) type', () => {
  test('should handle basic numPairs field', () => {
    const hdr = encodeString('<points:numPairs>');
    const points = [
      [10, 20],
      [30, 40],
      [50, 60],
    ] as [number, number][];
    const encoded = hdr.encode({ points });
    expect(encoded).toBe('10;20;30;40;50;60');
    const decoded = hdr.decode('10;20;30;40;50;60');
    expect(decoded).toEqual({ points });
  });

  test('should handle empty numPairs', () => {
    const hdr = encodeString('<points:numPairs>');
    const encoded = hdr.encode({ points: [] });
    expect(encoded).toBe('');
    const decoded = hdr.decode('');
    expect(decoded).toEqual({ points: [] });
  });

  test('should handle decimal numbers in numPairs', () => {
    const hdr = encodeString('<coordinates:numPairs>');
    const coordinates = [
      [10.5, 20.75],
      [30.25, 40.5],
    ] as [number, number][];
    const encoded = hdr.encode({ coordinates });
    expect(encoded).toBe('10.5;20.75;30.25;40.5');
    const decoded = hdr.decode('10.5;20.75;30.25;40.5');
    expect(decoded).toEqual({ coordinates });
  });
});

// Special features
describe('Payloads with $ delimiter', () => {
  test('should handle messages with payload', () => {
    const encoder = encodeString('CMD:<command>$');
    const encoded = encoder.encode({
      command: 'START',
      payload: 'This is the message content',
    });
    expect(encoded).toBe('CMD:START$This is the message content');
    const decoded = encoder.decode('CMD:START$This is the message content');
    expect(decoded).toEqual({
      command: 'START',
      payload: 'This is the message content',
    });
  });

  test('should handle empty payload', () => {
    const encoder = encodeString('CMD:<command>$');
    const encoded = encoder.encode({
      command: 'PING',
    });
    expect(encoded).toBe('CMD:PING$');
    const decoded = encoder.decode('CMD:PING$');
    expect(decoded).toEqual({
      command: 'PING',
    });
  });

  test('should handle payload with special characters', () => {
    const encoder = encodeString('MSG:<type>$');
    const encoded = encoder.encode({
      type: 'DATA',
      payload: '{"key":"value","arr":[1,2,3]}',
    });
    expect(encoded).toBe('MSG:DATA${"key":"value","arr":[1,2,3]}');
    const decoded = encoder.decode('MSG:DATA${"key":"value","arr":[1,2,3]}');
    expect(decoded).toEqual({
      type: 'DATA',
      payload: '{"key":"value","arr":[1,2,3]}',
    });
  });
});

describe('Fixed-size encodings', () => {
  test('should handle fixed-size encoding with ! delimiter', () => {
    const encoder = encodeString('HDR:<type:text-3>!');
    const encoded = encoder.encode({
      type: 'MSG',
      payload: 'This is a fixed-size encoding message',
    });
    expect(encoded).toBe('HDR:MSGThis is a fixed-size encoding message');
    const decoded = encoder.decode('HDR:MSGThis is a fixed-size encoding message');
    expect(decoded).toEqual({
      type: 'MSG',
      payload: 'This is a fixed-size encoding message',
    });
  });

  test('should return null if fixed-size encoding does not match pattern', () => {
    const encoder = encodeString('HDR:<type:text-3>!');
    const result = encoder.decode('XYZ:MSGThis is a message');
    expect(result).toBeNull();
  });

  test('should handle fixed-size encoding with padding for consistent size', () => {
    const encoder = encodeString('CMD:<type:text-3>!');
    // With 3 characters, fits exactly
    let encoded = encoder.encode({
      type: 'GET',
      payload: 'some data',
    });
    expect(encoded).toBe('CMD:GETsome data');
    let decoded = encoder.decode('CMD:GETsome data');
    expect(decoded).toEqual({
      type: 'GET',
      payload: 'some data',
    });

    // With shorter value, should be padded
    encoded = encoder.encode({
      type: 'OK',
      payload: 'success',
    });
    expect(encoded).toBe('CMD:OK success');
    decoded = encoder.decode('CMD:OK success');
    expect(decoded).toEqual({
      type: 'OK ',
      payload: 'success',
    });
  });

  test('should handle fixed-size encoding with multiple fields', () => {
    const encoder = encodeString('<type:text-3><code:num-3>!');
    const encoded = encoder.encode({
      type: 'MSG',
      code: 123,
      payload: 'Hello world',
    });
    expect(encoded).toBe('MSG123Hello world');
    const decoded = encoder.decode('MSG123Hello world');
    expect(decoded).toEqual({
      type: 'MSG',
      code: 123,
      payload: 'Hello world',
    });
  });

  test('should throw error if fixed-size encoding field lacks size parameter', () => {
    expect(() => {
      encodeString('<type:text>!');
    }).toThrow('Fixed-size encoding requires a size parameter for all fields');
  });
});

describe('String decode error handling', () => {
  test('should return null for completely invalid input', () => {
    const encoder = encodeString('<firstName> <lastName>');
    const result = encoder.decode('');
    expect(result).toBeNull();
  });

  test('should return null for input with incorrect delimiters', () => {
    const encoder = encodeString('<name>:<age>');
    const result = encoder.decode('John-42');
    expect(result).toBeNull();
  });
});
