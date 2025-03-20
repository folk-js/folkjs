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
    const decoded = proto.decode('debug=true;timeout=30');
    expect(decoded).toEqual({
      settings: [
        { key: 'debug', value: 'true' },
        { key: 'timeout', value: '30' },
      ],
    });

    const encoded = proto.encode({
      settings: [
        { key: 'mode', value: 'dark' },
        { key: 'lang', value: 'en' },
      ],
    });
    expect(encoded).toBe('mode=dark;lang=en');
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
});
