import { expect } from 'expect';
import { describe, test } from 'node:test';
import { codec } from '../src/utils/codecBits.ts';

describe('codec', () => {
  describe('basic functionality', () => {
    const encoder = codec('<flag:bool-1><count:num-3><type-4>');

    test('should encode bit fields correctly', () => {
      const result = encoder.encode({
        flag: true,
        count: 6, // '110' in binary
        type: '0000',
      });
      expect(result).toEqual(new Uint8Array([0xe0])); // 11100000
      expect(encoder.toBinaryString(result)).toBe('11100000');
    });

    test('should decode bit fields correctly', () => {
      const result = encoder.decode(new Uint8Array([0xe0])); // 11100000
      expect(result).toEqual({
        flag: true,
        count: 6, // '110' in binary
        type: '0000',
      });
    });

    test('should convert between binary string and Uint8Array', () => {
      const binaryStr = '11100000';
      const bytes = encoder.fromBinaryString(binaryStr);
      expect(bytes).toEqual(new Uint8Array([0xe0]));
      expect(encoder.toBinaryString(bytes)).toBe(binaryStr);
    });
  });

  describe('validation', () => {
    const encoder = codec('<status-2><data-6>');

    test('should reject invalid binary strings during encoding', () => {
      expect(() =>
        encoder.encode({
          status: '2', // not binary
          data: '000000',
        }),
      ).toThrow();

      expect(() =>
        encoder.encode({
          status: '11',
          data: '12345', // not binary
        }),
      ).toThrow();
    });

    test('should reject wrong-length binary strings during encoding', () => {
      expect(() =>
        encoder.encode({
          status: '1', // too short
          data: '000000',
        }),
      ).toThrow();

      expect(() =>
        encoder.encode({
          status: '111', // too long
          data: '000000',
        }),
      ).toThrow();
    });

    test('should return null for invalid input during decoding', () => {
      expect(encoder.decode(new Uint8Array([]))).toBeNull();
    });
  });

  describe('edge cases', () => {
    test('should handle single-bit fields with booleans', () => {
      const encoder = codec('<a:bool-1><b:bool-1><c:bool-1>');
      const encoded = encoder.encode({
        a: true,
        b: false,
        c: true,
      });
      expect(encoded).toEqual(new Uint8Array([0xa0])); // 10100000
      expect(encoder.toBinaryString(encoded)).toBe('10100000');
    });

    test('should handle byte-aligned numeric fields', () => {
      const encoder = codec('<byte1:num-8><byte2:num-8>');
      const encoded = encoder.encode({
        byte1: 255, // 11111111
        byte2: 0, // 00000000
      });
      expect(encoded).toEqual(new Uint8Array([0xff, 0x00]));
      expect(encoder.toBinaryString(encoded)).toBe('1111111100000000');
    });

    test('should handle non-byte-aligned fields with padding', () => {
      const encoder = codec('<field:num-3>');
      const encoded = encoder.encode({
        field: 5, // 101 in binary
      });
      expect(encoded).toEqual(new Uint8Array([0xa0])); // 10100000
      expect(encoder.toBinaryString(encoded)).toBe('10100000');
    });
  });

  describe('complex patterns', () => {
    const encoder = codec('<version:num-3><flags-5><payload-16>');

    test('should handle multi-byte patterns with mixed types', () => {
      const encoded = encoder.encode({
        version: 5, // 101 in binary
        flags: '11000',
        payload: '1111000011110000',
      });
      expect(encoded).toEqual(new Uint8Array([0xb8, 0xf0, 0xf0])); // 101110001111000011110000
      expect(encoder.toBinaryString(encoded)).toBe('101110001111000011110000');
    });

    test('should maintain field positions during decode', () => {
      const decoded = encoder.decode(new Uint8Array([0xb8, 0xf0, 0xf0, 0x00]));
      expect(decoded).toEqual({
        version: 5, // 101 in binary
        flags: '11000',
        payload: '1111000011110000',
      });
    });
  });

  describe('space efficiency', () => {
    test('should efficiently pack multiple small fields with mixed types', () => {
      const encoder = codec('<a:num-2><b:num-3><c:bool-1><d:bool-1><e:num-3><f:num-2><g:bool-1><h:num-3>');
      // Total bits: 16 bits (2 bytes)
      // As typed values, even more concise than binary strings

      const encoded = encoder.encode({
        a: 2, // 10
        b: 5, // 101
        c: true, // 1
        d: true, // 1
        e: 6, // 110
        f: 1, // 01
        g: false, // 0
        h: 3, // 011
      });

      // Should only take 2 bytes
      expect(encoded.length).toBe(2);
      expect(encoded).toEqual(new Uint8Array([0xaf, 0x93])); // 10101111 10010011

      // Verify we can decode it back correctly
      const decoded = encoder.decode(encoded);
      expect(decoded).toEqual({
        a: 2,
        b: 5,
        c: true,
        d: true,
        e: 6,
        f: 1,
        g: false,
        h: 3,
      });
    });
  });

  describe('typed fields', () => {
    test('should handle boolean and numeric fields', () => {
      const encoder = codec('<flag:bool-1><count:num-8><type-4>');

      const encoded = encoder.encode({
        flag: true,
        count: 123,
        type: '1010',
      });

      expect(encoded.length).toBe(2); // 13 bits total = 2 bytes
      expect(encoder.toBinaryString(encoded)).toBe('1011110111010000');

      const decoded = encoder.decode(encoded);
      expect(decoded).toEqual({
        flag: true,
        count: 123,
        type: '1010',
      });
    });

    test('should validate numeric ranges', () => {
      const encoder = codec('<value:num-3>');

      // Valid range for 3 bits is 0-7
      expect(() => encoder.encode({ value: 8 })).toThrow();
      expect(() => encoder.encode({ value: -1 })).toThrow();

      const encoded = encoder.encode({ value: 5 });
      expect(encoder.toBinaryString(encoded)).toBe('10100000');
      expect(encoder.decode(encoded)).toEqual({ value: 5 });
    });

    test('should validate boolean fields are always 1 bit', () => {
      // This should throw because bool fields must be 1 bit
      expect(() => codec('<flag:bool-2>')).toThrow();

      // This should NOT throw - proper bool field declaration
      const encoder = codec('<flag:bool-1>');
      expect(() => encoder.encode({ flag: true })).not.toThrow();
      expect(() => encoder.encode({ flag: false })).not.toThrow();

      // The encoded result should be correct
      const encoded = encoder.encode({ flag: true });
      expect(encoder.toBinaryString(encoded)).toBe('10000000');

      const encodedFalse = encoder.encode({ flag: false });
      expect(encoder.toBinaryString(encodedFalse)).toBe('00000000');
    });

    test('should validate number fields cannot exceed 8 bits', () => {
      // This should throw because num fields cannot exceed 8 bits
      expect(() => codec('<value:num-9>')).toThrow();

      // This should NOT throw - valid 8-bit number field
      const encoder = codec('<value:num-8>');
      expect(() => encoder.encode({ value: 255 })).not.toThrow(); // Max 8-bit value
    });

    test('should validate number values are within range for different bit sizes', () => {
      // Test 2-bit field (range: 0-3)
      const bits2 = codec('<value:num-2>');
      expect(() => bits2.encode({ value: 4 })).toThrow(); // Too large
      expect(() => bits2.encode({ value: 3 })).not.toThrow(); // Max value

      // Test 4-bit field (range: 0-15)
      const bits4 = codec('<value:num-4>');
      expect(() => bits4.encode({ value: 16 })).toThrow(); // Too large
      expect(() => bits4.encode({ value: 15 })).not.toThrow(); // Max value

      // Test 8-bit field (range: 0-255)
      const bits8 = codec('<value:num-8>');
      expect(() => bits8.encode({ value: 256 })).toThrow(); // Too large
      expect(() => bits8.encode({ value: 255 })).not.toThrow(); // Max value

      // Test very out-of-range values
      expect(() => bits8.encode({ value: 1000 })).toThrow(); // Way too large
      expect(() => bits8.encode({ value: -100 })).toThrow(); // Negative not allowed
    });

    test('should combine multiple typed fields in a practical example', () => {
      // Example: Protocol message with bit fields
      const protocol = codec(
        '<version:num-3><isRequest:bool-1><hasPayload:bool-1><messageType:num-3><sequenceId:num-8>',
      );

      const message = protocol.encode({
        version: 4, // Protocol version 4
        isRequest: true, // This is a request message
        hasPayload: true, // Has additional payload
        messageType: 2, // Message type 2 (e.g., "query")
        sequenceId: 42, // Message sequence number
      });

      expect(message.length).toBe(2);
      expect(protocol.toBinaryString(message)).toBe('1001101000101010');

      // Decode and verify
      const decoded = protocol.decode(message);
      expect(decoded).toEqual({
        version: 4,
        isRequest: true,
        hasPayload: true,
        messageType: 2,
        sequenceId: 42,
      });
    });

    test('should pack maximum practical information in 2 bytes', () => {
      // Packed protocol format (16 bits total):
      // <version:num-2>         - Protocol version (0-3)
      // <priority:num-2>        - Priority level (0-3)
      // <isRequest:bool-1>      - Request/Response flag
      // <hasPayload:bool-1>     - Payload indicator
      // <messageType:num-3>     - Message type (0-7)
      // <errorCode:num-3>       - Error code (0-7)
      // <sequenceId:num-4>      - Sequence number (0-15)
      const protocol = codec(
        '<version:num-2><priority:num-2><isRequest:bool-1><hasPayload:bool-1><messageType:num-3><errorCode:num-3><sequenceId:num-4>',
      );

      const message = protocol.encode({
        version: 2,
        priority: 3,
        isRequest: true,
        hasPayload: true,
        messageType: 5,
        errorCode: 0,
        sequenceId: 12,
      });

      expect(message.length).toBe(2);
      expect(protocol.toBinaryString(message)).toBe('1011111010001100');

      const decoded = protocol.decode(message);
      expect(decoded).toEqual({
        version: 2,
        priority: 3,
        isRequest: true,
        hasPayload: true,
        messageType: 5,
        errorCode: 0,
        sequenceId: 12,
      });
    });
  });
});
