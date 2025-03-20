import { describe, expect, test } from 'bun:test';
import { protocol } from '../utils/protocol';

describe('protocol', () => {
  test('should encode a simple string', () => {
    const proto = protocol`<name>`;
    const encoded = proto.encode({ name: 'John' });
    expect(encoded).toBe('John');
  });

  test('should encode a simple number', () => {
    const proto = protocol`<age:num>`;
    const encoded = proto.encode({ age: 30 });
    expect(encoded).toBe('30');
  });

  test('should decode a simple number', () => {
    const proto = protocol`<age:num>`;
    const decoded = proto.decode('30');
    expect(decoded).toEqual({ age: 30 });
  });

  test('should handle a simple string with a static prefix', () => {
    const proto = protocol`Hello <name>`;
    const encoded = proto.encode({ name: 'John' });
    expect(encoded).toBe('Hello John');
    const decoded = proto.decode('Hello John');
    expect(decoded).toEqual({ name: 'John' });
  });

  test('should handle list types', () => {
    const proto = protocol`<numbers:list>`;
    const encoded = proto.encode({ numbers: [1, 2, 3] });
    expect(encoded).toBe('1,2,3');
    const decoded = proto.decode('1,2,3');
    expect(decoded).toEqual({ numbers: ['1', '2', '3'] });
  });

  test('should handle a list of strings', () => {
    const proto = protocol`<names:list>`;
    const encoded = proto.encode({ names: ['John', 'Jane', 'Jim'] });
    expect(encoded).toBe('John,Jane,Jim');
    const decoded = proto.decode('John,Jane,Jim');
    expect(decoded).toEqual({ names: ['John', 'Jane', 'Jim'] });
  });

  test('should handle a complex format', () => {
    const proto = protocol`D|<name:text>:<age:num>|<numbers:list>`;
    const encoded = proto.encode({ name: 'John', age: 30, numbers: [1, 2, 3] });
    expect(encoded).toBe('D|John:30|1,2,3');
    const decoded = proto.decode('D|John:30|1,2,3');
    expect(decoded).toEqual({ name: 'John', age: 30, numbers: ['1', '2', '3'] });
  });

  test('should parse boolean values', () => {
    const proto = protocol`Status: <active:bool>`;
    const decoded = proto.decode('Status: true');
    expect(decoded).toEqual({ active: true });

    const encoded = proto.encode({ active: false });
    expect(encoded).toBe('Status: false');
  });

  test('should parse fixed-width text', () => {
    const proto = protocol`<chunks:list(3)>`;
    const decoded = proto.decode('ABCDEFGHI');
    expect(decoded).toEqual({ chunks: ['ABC', 'DEF', 'GHI'] });

    const encoded = proto.encode({ chunks: ['FOO', 'BAR', 'BAZ'] });
    expect(encoded).toBe('FOOBARBAZ');
  });

  test('should parse fixed-width numbers', () => {
    const proto = protocol`<digits:nums(2)>`;
    const decoded = proto.decode('0102030405');
    expect(decoded).toEqual({ digits: [1, 2, 3, 4, 5] });

    const encoded = proto.encode({ digits: [1, 2, 3, 10, 20] });
    expect(encoded).toBe('0102031020');
  });

  test('should parse delimited pairs', () => {
    const proto = protocol`<settings:pairs>`;
    const decoded = proto.decode('debug;true;timeout;30');
    expect(decoded).toEqual({
      settings: [
        ['debug', 'true'],
        ['timeout', '30'],
      ],
    });

    const encoded = proto.encode({
      settings: [
        ['mode', 'dark'],
        ['lang', 'en'],
      ],
    });
    expect(encoded).toBe('mode;dark;lang;en');
  });

  test('should parse numerical pairs', () => {
    const proto = protocol`<coordinates:numPairs>`;
    const decoded = proto.decode('10;20;30;40');
    expect(decoded).toEqual({
      coordinates: [
        [10, 20],
        [30, 40],
      ],
    });

    const encoded = proto.encode({
      coordinates: [
        [5, 15],
        [25, 35],
      ],
    });
    expect(encoded).toBe('5;15;25;35');
  });

  test('should parse complex patterns', () => {
    const proto = protocol`<method> <path> HTTP/<version>`;
    const decoded = proto.decode('GET /api/users HTTP/1.1');
    expect(decoded).toEqual({
      method: 'GET',
      path: '/api/users',
      version: '1.1',
    });

    const encoded = proto.encode({
      method: 'POST',
      path: '/api/login',
      version: '2.0',
    });
    expect(encoded).toBe('POST /api/login HTTP/2.0');
  });

  // Basic usage
  test('can encode and decode a greeting', () => {
    const proto = protocol`Hello, <name>`;
    const encoded = proto.encode({ name: 'Alice' });
    expect(encoded).toBe('Hello, Alice');

    const decoded = proto.decode('Hello, Alice');
    expect(decoded).toEqual({ name: 'Alice' });
  });

  test('should handle multiple text fields', () => {
    const proto = protocol`<firstName> <lastName>`;
    const encoded = proto.encode({ firstName: 'John', lastName: 'Doe' });
    expect(encoded).toBe('John Doe');
    const decoded = proto.decode('John Doe');
    expect(decoded).toEqual({ firstName: 'John', lastName: 'Doe' });
  });

  test('should handle numeric field with prefix', () => {
    const proto = protocol`Count: <value:num>`;
    const encoded = proto.encode({ value: 42 });
    expect(encoded).toBe('Count: 42');
    const decoded = proto.decode('Count: 42');
    expect(decoded).toEqual({ value: 42 });
  });

  test('should handle boolean values', () => {
    const proto = protocol`<enabled:bool>`;
    let encoded = proto.encode({ enabled: true });
    expect(encoded).toBe('true');
    let decoded = proto.decode('true');
    expect(decoded).toEqual({ enabled: true });

    encoded = proto.encode({ enabled: false });
    expect(encoded).toBe('false');
    decoded = proto.decode('false');
    expect(decoded).toEqual({ enabled: false });
  });

  // Collection types with delimiters
  test('should handle comma-separated list (default)', () => {
    const proto = protocol`<items:list>`;
    const encoded = proto.encode({ items: ['apple', 'banana', 'cherry'] });
    expect(encoded).toBe('apple,banana,cherry');
    const decoded = proto.decode('apple,banana,cherry');
    expect(decoded).toEqual({ items: ['apple', 'banana', 'cherry'] });
  });

  // Fixed-width parsing
  test('should handle fixed 3-character chunks', () => {
    const proto = protocol`<codes:list(3)>`;
    const encoded = proto.encode({ codes: ['ABC', 'DEF', 'GHI'] });
    expect(encoded).toBe('ABCDEFGHI');
    const decoded = proto.decode('ABCDEFGHI');
    expect(decoded).toEqual({ codes: ['ABC', 'DEF', 'GHI'] });
  });

  test('should handle fixed 2-digit number chunks', () => {
    const proto = protocol`<digits:nums(2)>`;
    const encoded = proto.encode({ digits: [1, 23, 45, 6] });
    expect(encoded).toBe('01234506');
    const decoded = proto.decode('01234506');
    expect(decoded).toEqual({ digits: [1, 23, 45, 6] });
  });

  test('should handle HTTP-like request format', () => {
    const proto = protocol`<method> <path> HTTP/<version>`;
    const encoded = proto.encode({ method: 'GET', path: '/api/users', version: '1.1' });
    expect(encoded).toBe('GET /api/users HTTP/1.1');

    const decoded = proto.decode('GET /api/users HTTP/1.1');
    expect(decoded).toEqual({ method: 'GET', path: '/api/users', version: '1.1' });
  });

  // Payload with $ delimiter
  test('should handle messages with payload', () => {
    const proto = protocol`CMD:<command>$`;
    const encoded = proto.encode({
      command: 'START',
      payload: 'This is the message content',
    });
    expect(encoded).toBe('CMD:START$This is the message content');

    const decoded = proto.decode('CMD:START$This is the message content');
    expect(decoded).toEqual({
      command: 'START',
      payload: 'This is the message content',
    });
  });

  // Fixed-size header with ! delimiter
  test('should handle fixed-size header with ! delimiter', () => {
    const proto = protocol`HDR:<type:text(3)>!`;
    const encoded = proto.encode({
      type: 'MSG',
      payload: 'This is a fixed-size header message',
    });
    expect(encoded).toBe('HDR:MSGThis is a fixed-size header message');

    const decoded = proto.decode('HDR:MSGThis is a fixed-size header message');
    expect(decoded).toEqual({
      type: 'MSG',
      payload: 'This is a fixed-size header message',
    });
  });

  // Fixed-size header with padding for consistent size
  test('should handle fixed-size header with padded fields', () => {
    const proto = protocol`CMD:<type:text(3)>!`;

    // With 3 characters, fits exactly
    let encoded = proto.encode({
      type: 'GET',
      payload: 'some data',
    });
    expect(encoded).toBe('CMD:GETsome data');

    let decoded = proto.decode('CMD:GETsome data');
    expect(decoded).toEqual({
      type: 'GET',
      payload: 'some data',
    });

    // With shorter value, should be padded
    encoded = proto.encode({
      type: 'OK',
      payload: 'success',
    });
    expect(encoded).toBe('CMD:OK success');

    decoded = proto.decode('CMD:OK success');
    expect(decoded).toEqual({
      type: 'OK ',
      payload: 'success',
    });
  });

  // Organized tests by type
  describe('text type', () => {
    test('basic text field', () => {
      const proto = protocol`<message:text>`;
      const encoded = proto.encode({ message: 'Hello world' });
      expect(encoded).toBe('Hello world');
      const decoded = proto.decode('Hello world');
      expect(decoded).toEqual({ message: 'Hello world' });
    });

    test('fixed width text', () => {
      const proto = protocol`<code:text(5)>`;
      const encoded = proto.encode({ code: 'ABCDE' });
      expect(encoded).toBe('ABCDE');
      const decoded = proto.decode('ABCDE');
      expect(decoded).toEqual({ code: 'ABCDE' });

      // Test padding for shorter values
      const encoded2 = proto.encode({ code: 'ABC' });
      expect(encoded2).toBe('ABC  ');
      const decoded2 = proto.decode('ABC  ');
      expect(decoded2).toEqual({ code: 'ABC  ' });

      // Test error for longer values
      expect(() => {
        proto.encode({ code: 'ABCDEFGHI' });
      }).toThrow('Value "ABCDEFGHI" exceeds fixed width of 5 for field "code"');
    });
  });

  describe('number type', () => {
    test('basic number field', () => {
      const proto = protocol`<count:num>`;
      const encoded = proto.encode({ count: 123 });
      expect(encoded).toBe('123');
      const decoded = proto.decode('123');
      expect(decoded).toEqual({ count: 123 });
    });

    test('fixed width num', () => {
      const proto = protocol`<code:num(4)>`;
      const encoded = proto.encode({ code: 42 });
      expect(encoded).toBe('0042');
      const decoded = proto.decode('0042');
      expect(decoded).toEqual({ code: 42 });

      // Test padding for shorter values
      const encoded2 = proto.encode({ code: 7 });
      expect(encoded2).toBe('0007');

      // Test error for longer values
      expect(() => {
        proto.encode({ code: 123456 });
      }).toThrow();
    });
  });

  describe('boolean type', () => {
    test('basic boolean field', () => {
      const proto = protocol`<active:bool>`;
      const encoded = proto.encode({ active: true });
      expect(encoded).toBe('true');
      const decoded = proto.decode('true');
      expect(decoded).toEqual({ active: true });

      const encoded2 = proto.encode({ active: false });
      expect(encoded2).toBe('false');
      const decoded2 = proto.decode('false');
      expect(decoded2).toEqual({ active: false });
    });
  });

  describe('list type', () => {
    test('basic list field', () => {
      const proto = protocol`<items:list>`;
      const encoded = proto.encode({ items: ['a', 'b', 'c'] });
      expect(encoded).toBe('a,b,c');
      const decoded = proto.decode('a,b,c');
      expect(decoded).toEqual({ items: ['a', 'b', 'c'] });
    });

    test('fixed width list', () => {
      const proto = protocol`<codes:list(2)>`;
      const encoded = proto.encode({ codes: ['AA', 'BB', 'CC'] });
      expect(encoded).toBe('AABBCC');
      const decoded = proto.decode('AABBCC');
      expect(decoded).toEqual({ codes: ['AA', 'BB', 'CC'] });

      // Test padding for shorter values
      const encoded2 = proto.encode({ codes: ['A', 'B', 'C'] });
      expect(encoded2).toBe('A B C ');
      const decoded2 = proto.decode('A B C ');
      expect(decoded2).toEqual({ codes: ['A ', 'B ', 'C '] });

      // Test error for longer values
      expect(() => {
        proto.encode({ codes: ['AAA', 'BB', 'CC'] });
      }).toThrow('Value "AAA" exceeds fixed width of 2 for item in "codes"');
    });
  });

  describe('nums type', () => {
    test('basic nums field', () => {
      const proto = protocol`<values:nums>`;
      const encoded = proto.encode({ values: [10, 20, 30] });
      expect(encoded).toBe('10,20,30');
      const decoded = proto.decode('10,20,30');
      expect(decoded).toEqual({ values: [10, 20, 30] });
    });

    test('fixed width nums', () => {
      const proto = protocol`<values:nums(3)>`;
      const encoded = proto.encode({ values: [7, 42, 123] });
      expect(encoded).toBe('007042123');
      const decoded = proto.decode('007042123');
      expect(decoded).toEqual({ values: [7, 42, 123] });

      // Test padding for shorter values
      const encoded2 = proto.encode({ values: [1, 2, 3] });
      expect(encoded2).toBe('001002003');

      // Test error for longer values
      expect(() => {
        proto.encode({ values: [1234, 5678, 9012] });
      }).toThrow('Value "1234" exceeds fixed width of 3 for item in "values"');
    });
  });

  describe('pairs type', () => {
    test('basic pairs field', () => {
      const proto = protocol`<config:pairs>`;
      const pairs = [
        ['name', 'test'],
        ['version', '1.0'],
      ];
      const encoded = proto.encode({ config: pairs });
      expect(encoded).toBe('name;test;version;1.0');
      const decoded = proto.decode('name;test;version;1.0');
      expect(decoded).toEqual({ config: pairs });
    });

    test('fixed width pairs', () => {
      const proto = protocol`<config:pairs(4)>`;
      const pairs = [
        ['name', 'test'],
        ['ver', '1.0'],
      ];

      // Note: fixed width for pairs is implemented by ignoring the fixed width
      // and formatting as regular pairs
      const encoded = proto.encode({ config: pairs });
      expect(encoded).toBe('name;test;ver;1.0');
    });
  });

  describe('numPairs type', () => {
    test('basic numPairs field', () => {
      const proto = protocol`<points:numPairs>`;
      const points = [
        [10, 20],
        [30, 40],
        [50, 60],
      ];
      const encoded = proto.encode({ points });
      expect(encoded).toBe('10;20;30;40;50;60');
      const decoded = proto.decode('10;20;30;40;50;60');
      expect(decoded).toEqual({ points });
    });

    test('should handle empty numPairs', () => {
      const proto = protocol`<points:numPairs>`;
      const encoded = proto.encode({ points: [] });
      expect(encoded).toBe('');
      const decoded = proto.decode('');
      expect(decoded).toEqual({ points: [] });
    });
  });

  describe('complex combinations', () => {
    test('mixed field types with fixed width', () => {
      const proto = protocol`<id:num(3)>|<name:text(5)>|<active:bool>`;
      const encoded = proto.encode({ id: 42, name: 'Alice', active: true });
      expect(encoded).toBe('042|Alice|true');
      const decoded = proto.decode('042|Alice|true');
      expect(decoded).toEqual({ id: 42, name: 'Alice', active: true });
    });

    test('fixed width header with multiple fields', () => {
      const proto = protocol`<type:text(3)><code:num(3)>!`;
      const encoded = proto.encode({
        type: 'MSG',
        code: 123,
        payload: 'Hello world',
      });
      expect(encoded).toBe('MSG123Hello world');
      const decoded = proto.decode('MSG123Hello world');
      expect(decoded).toEqual({
        type: 'MSG',
        code: 123,
        payload: 'Hello world',
      });
    });
  });
});
