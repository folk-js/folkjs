/**
 * BitHeader - A utility for encoding/decoding bit-level headers
 *
 * This utility provides a DSL for defining fixed-width bit headers using
 * string patterns. It handles parsing of binary strings into objects and
 * encoding objects back to binary data.
 *
 * Basic usage:
 * const myHeader = encodeBits("<flag:bool><count:num-8><type-4>");
 * const result = myHeader.decode(new Uint8Array([0xE0])); // 11100000
 * const encoded = myHeader.encode({ flag: true, count: 6, type: "0000" });
 *
 * Supported types:
 * - bits: Raw binary string (default type if no type specified)
 * - bool: Boolean value (1 bit)
 * - num: Numeric value (up to 8 bits)
 */

type BitFieldType = 'bits' | 'bool' | 'num';

type ParseType<T extends string> = T extends 'bool' ? boolean : T extends 'num' ? number : string;

type ExtractBitFields<T extends string> = T extends `${string}<${infer Field}:${infer Type}-${infer Size}>${infer Rest}`
  ? { [K in Field]: ParseType<Type> } & ExtractBitFields<Rest>
  : T extends `${string}<${infer Field}-${infer Size}>${infer Rest}`
    ? { [K in Field]: string } & ExtractBitFields<Rest>
    : {};

type BitEncodingData<T extends string> = ExtractBitFields<T>;

interface BitPattern {
  name: string;
  type: BitFieldType;
  size: number;
  startBit: number;
}

interface BitEncoding<T extends string> {
  decode: (input: Uint8Array) => BitEncodingData<T> | null;
  encode: (data: BitEncodingData<T>) => Uint8Array;
  toBinaryString: (data: Uint8Array) => string;
  fromBinaryString: (binary: string) => Uint8Array;
}

type InternalBitData<T extends string> = BitEncodingData<T> & Record<string, any>;

function encodeBool(value: boolean): string {
  return value ? '1' : '0';
}

function decodeBool(bits: string): boolean {
  return bits === '1';
}

function encodeNum(value: number, size: number): string {
  if (value < 0 || value >= Math.pow(2, size)) {
    throw new Error(`Number ${value} cannot be encoded in ${size} bits`);
  }
  return value.toString(2).padStart(size, '0');
}

function decodeNum(bits: string): number {
  return parseInt(bits, 2);
}

export function encodeBits<T extends string>(pattern: T): BitEncoding<T> {
  const patterns = parsePattern(pattern);
  const totalBits = patterns.reduce((sum, p) => sum + p.size, 0);
  const totalBytes = Math.ceil(totalBits / 8);

  function toBinaryString(data: Uint8Array): string {
    let result = '';
    for (let i = 0; i < data.length; i++) {
      result += data[i].toString(2).padStart(8, '0');
    }
    return result;
  }

  function fromBinaryString(binary: string): Uint8Array {
    const bytes = new Uint8Array(Math.ceil(binary.length / 8));
    for (let i = 0; i < bytes.length; i++) {
      const start = i * 8;
      const slice = binary.slice(start, start + 8).padEnd(8, '0');
      bytes[i] = parseInt(slice, 2);
    }
    return bytes;
  }

  return {
    toBinaryString,
    fromBinaryString,

    decode(input: Uint8Array): BitEncodingData<T> | null {
      const binaryString = toBinaryString(input);

      // Validate input length
      if (binaryString.length < totalBits) {
        return null;
      }

      const result = {} as BitEncodingData<T>;

      for (const pattern of patterns) {
        const bits = binaryString.substr(pattern.startBit, pattern.size);

        switch (pattern.type) {
          case 'bool':
            result[pattern.name as keyof BitEncodingData<T>] = decodeBool(bits) as any;
            break;
          case 'num':
            result[pattern.name as keyof BitEncodingData<T>] = decodeNum(bits) as any;
            break;
          default: // 'bits'
            result[pattern.name as keyof BitEncodingData<T>] = bits as any;
        }
      }

      return result;
    },

    encode(data: BitEncodingData<T>): Uint8Array {
      // Cast to internal type to allow dynamic property access
      const internalData = data as InternalBitData<T>;
      let binaryString = '0'.repeat(totalBytes * 8);

      for (const pattern of patterns) {
        const value = internalData[pattern.name];
        let bits: string;

        switch (pattern.type) {
          case 'bool':
            bits = encodeBool(value as boolean);
            break;
          case 'num':
            bits = encodeNum(value as number, pattern.size);
            break;
          default: // 'bits'
            bits = value as string;
            if (!bits || !bits.match(/^[01]+$/) || bits.length !== pattern.size) {
              throw new Error(`Invalid value for ${pattern.name}: must be ${pattern.size} bits`);
            }
        }

        binaryString =
          binaryString.substring(0, pattern.startBit) + bits + binaryString.substring(pattern.startBit + pattern.size);
      }

      return fromBinaryString(binaryString);
    },
  };
}

function parsePattern(pattern: string): BitPattern[] {
  const patterns: BitPattern[] = [];
  let currentBit = 0;

  const matches = pattern.matchAll(/<([^:>-]+)(?::([^>-]+))?-(\d+)>/g);

  for (const match of matches) {
    const [, name, type = 'bits', size] = match;
    if (type === 'bool' && parseInt(size) !== 1) {
      throw new Error('Boolean fields must be 1 bit');
    }
    if (type === 'num' && parseInt(size) > 8) {
      throw new Error('Number fields cannot exceed 8 bits');
    }
    patterns.push({
      name,
      type: type as BitFieldType,
      size: parseInt(size),
      startBit: currentBit,
    });
    currentBit += parseInt(size);
  }

  return patterns;
}
