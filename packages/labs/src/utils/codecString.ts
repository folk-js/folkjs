/**
 * StringEncoder - A utility for encoding/decoding structured text formats
 *
 * This utility provides a DSL for defining structured text formats using
 * string patterns. It handles basic parsing of structured text
 * formats into JavaScript objects and encoding objects back to strings.
 *
 * Basic usage:
 * const encoder = encodeString("prefix <field:type> suffix");
 * const result = encoder.decode("prefix value suffix");
 * const encoded = encoder.encode({ field: "value" });
 *
 * Example:
 * const encoder = encodeString("QRTPB<index:num>:<hash:text-16><payload>");
 *
 * Supported types:
 * - text: Default type, represents a text string
 * - num: Numeric value
 * - bool: Boolean value (true/false)
 * - list: A comma-separated list of values
 * - nums: A list of numeric values
 * - pairs: A list of tuple arrays where each tuple is [key, value] (format is 'key;value;key;value')
 * - numPairs: A list of number tuple arrays where each tuple is [number, number] (format is 'num;num;num;num')
 * - enum: A fixed set of values, encoded using the minimum number of bits needed
 *   Format: <field:enum-[value1,value2,value3]>
 *
 * Fixed-width fields:
 * You can specify a fixed width for a field using dash notation:
 * <field:type-size> - for example, <code:text-3> for a 3-character code
 * or <id:num-5> for a 5-digit number (padded with leading zeros)
 *
 * End markers:
 * - $: Indicates that everything after this point is payload data
 * - !: Marks a fixed-size encoding where the length is determined by the field sizes
 */

// Type definitions for string parsing
type PatternType = 'text' | 'num' | 'bool' | 'list' | 'nums' | 'pairs' | 'numPairs' | 'enum';

// Helper type to extract enum values from pattern
type ExtractEnumValues<T extends string> = T extends `enum[${infer Values}]`
  ? Values extends string
    ? Values extends ''
      ? never
      : Values extends `${infer First},${infer Rest}`
        ? First | ExtractEnumValues<`enum[${Rest}]`>
        : Values
    : never
  : never;

// Parse basic types including enums
type ParseType<T extends string> = T extends `${infer Base}-${string}`
  ? ParseType<Base>
  : T extends 'text'
    ? string
    : T extends 'num'
      ? number
      : T extends 'bool'
        ? boolean
        : T extends 'list'
          ? string[]
          : T extends 'nums'
            ? number[]
            : T extends 'pairs'
              ? Array<[string, string]>
              : T extends 'numPairs'
                ? Array<[number, number]>
                : T extends `enum[${string}]`
                  ? ExtractEnumValues<T>
                  : string;

// Extract field definitions from string pattern
type ExtractFields<T extends string> = T extends `${string}<${infer Field}:${infer Type}>${infer Rest}`
  ? { [K in Field]: ParseType<Type> } & ExtractFields<Rest>
  : T extends `${string}<${infer Field}>${infer Rest}`
    ? { [K in Field]: string } & ExtractFields<Rest>
    : {};

// Expand type helper to force full type expansion in IDE
type Expand<T> = T extends infer O ? { [K in keyof O]: O[K] } : never;

// Main type that produces the decode return type and encode input type from a pattern string
type CodecData<T extends string> = Expand<
  ExtractFields<T> & {
    payload?: string;
  }
>;

// Add a separate type for internal use that includes the index signature
type InternalCodecData<T extends string> = CodecData<T> & Record<string, any>;

interface Pattern {
  name: string;
  type: PatternType;
  size?: number;
  isFixedHeader?: boolean;
  enumValues?: string[]; // Add enum values
}

const DELIMITERS = {
  PAYLOAD: '$',
  FIXED_HEADER: '!',
  LIST: ',',
  PAIRS_ITEM: ';',
};

interface StringCodec<T extends string> {
  decode: (input: string) => CodecData<T> | null;
  encode: (data: CodecData<T>) => string;
}

export function codec<T extends string>(pattern: T): Expand<StringCodec<T>> {
  const { staticParts, patterns, hasFixedHeader, hasDollarDelimiter } = parseTemplate(pattern);

  // Calculate fixed header length if needed
  const fixedHeaderLength = hasFixedHeader ? patterns.reduce((sum, p) => sum + (p.size || 0), 0) : 0;

  return {
    encode(data: CodecData<T>): string {
      // SETUP
      let result = staticParts[0];
      // Cast to internal type to allow dynamic property access
      const internalData = data as InternalCodecData<T>;

      // MAIN LOOP: Format each pattern
      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];

        // Verify required field exists
        if (internalData[pattern.name] === undefined) {
          throw new Error(`Missing required field "${pattern.name}"`);
        }

        // Format value and add to result according to pattern type
        const value = internalData[pattern.name];
        switch (pattern.type) {
          case 'num':
            result += formatNum(value as number, pattern.size);
            break;
          case 'bool':
            result += formatBool(value as boolean);
            break;
          case 'list':
            result += formatList(value as string[], pattern.size);
            break;
          case 'nums':
            result += formatNums(value as number[], pattern.size);
            break;
          case 'pairs':
            result += formatPairs(value as string[][]);
            break;
          case 'numPairs':
            result += formatNumPairs(value as number[][]);
            break;
          case 'enum':
            if (!pattern.enumValues) {
              throw new Error(`Missing enum values for field "${pattern.name}"`);
            }
            result += formatEnum(value as string, pattern.enumValues);
            break;
          default: // text
            result += formatText(value, pattern.size);
            break;
        }

        // Add next static part (except for fixed header patterns)
        if (!pattern.isFixedHeader && i + 1 < staticParts.length) {
          result += staticParts[i + 1];
        }
      }

      // Add payload if present
      return addPayload(result, internalData.payload, hasFixedHeader, hasDollarDelimiter);
    },

    decode(input: string): CodecData<T> | null {
      // SETUP
      // Use internal type for dynamic property access
      const result = {} as InternalCodecData<T>;

      // Check input for fixed header patterns
      if (hasFixedHeader && !input.startsWith(staticParts[0])) {
        return null; // Return null instead of throwing error
      }

      // Split input into header and payload
      const { header, payload } = splitHeaderAndPayload(
        input,
        hasFixedHeader,
        fixedHeaderLength,
        staticParts[0].length,
      );

      // Store payload if found
      if (payload !== undefined && payload !== null && payload !== '') {
        result.payload = payload;
      }

      // MAIN LOOP: Process each pattern
      let pos = hasFixedHeader ? staticParts[0].length : 0;
      let remaining = header;
      let staticIndex = 0;

      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];

        // Extract value for this pattern
        const extractResult = extractPatternValue(
          pattern,
          input,
          pos,
          remaining,
          staticParts[staticIndex],
          staticParts[staticIndex + 1] || '',
        );

        // Return null if extraction failed
        if (extractResult === null) {
          return null;
        }

        const { value, newRemaining, newPosition, isLastField } = extractResult;

        // Parse according to pattern type
        switch (pattern.type) {
          case 'num':
            result[pattern.name] = parseNum(value);
            break;
          case 'bool':
            result[pattern.name] = parseBool(value);
            break;
          case 'list':
            result[pattern.name] = parseList(value, pattern.size);
            break;
          case 'nums':
            result[pattern.name] = parseNums(value, pattern.size);
            break;
          case 'pairs':
            result[pattern.name] = parsePairs(value);
            break;
          case 'numPairs':
            result[pattern.name] = parseNumPairs(value);
            break;
          case 'enum':
            if (!pattern.enumValues) {
              throw new Error(`Missing enum values for field "${pattern.name}"`);
            }
            result[pattern.name] = parseEnum(value, pattern.enumValues);
            break;
          default: // text
            result[pattern.name] = parseText(value, pattern.size);
            break;
        }

        // Update our state
        remaining = newRemaining;
        pos = newPosition;
        if (!pattern.isFixedHeader) staticIndex++;

        // Stop if this was the last field
        if (isLastField) break;
      }

      // Cast back to clean public interface
      return result as CodecData<T>;
    },
  } as Expand<StringCodec<T>>;
}

function extractPatternValue(
  pattern: Pattern,
  input: string,
  position: number,
  remaining: string,
  staticPart: string,
  nextStatic: string,
): ExtractResult | null {
  // Fixed width field handling
  if (pattern.isFixedHeader) {
    return {
      value: input.substring(position, position + pattern.size!),
      newRemaining: remaining,
      newPosition: position + pattern.size!,
      isLastField: false,
    };
  }

  // Variable width field handling
  if (!remaining.startsWith(staticPart)) {
    return null; // Return null instead of throwing error
  }

  // Skip the static prefix
  const afterPrefix = remaining.substring(staticPart.length);

  // Check for end markers
  if (nextStatic === DELIMITERS.PAYLOAD || nextStatic === DELIMITERS.FIXED_HEADER) {
    return {
      value: afterPrefix,
      newRemaining: '',
      newPosition: position,
      isLastField: true,
    };
  }

  // Find the end of this value (next delimiter)
  const endPos = nextStatic ? afterPrefix.indexOf(nextStatic) : afterPrefix.length;
  if (endPos === -1) {
    return null; // Return null instead of throwing error
  }

  // Extract value and update remaining text
  return {
    value: afterPrefix.substring(0, endPos),
    newRemaining: afterPrefix.substring(endPos),
    newPosition: position,
    isLastField: false,
  };
}

function splitHeaderAndPayload(
  input: string,
  hasFixedHeader: boolean,
  fixedHeaderLength: number,
  staticPrefixLength: number,
): HeaderPayload {
  const payloadStart = hasFixedHeader ? staticPrefixLength + fixedHeaderLength : input.indexOf(DELIMITERS.PAYLOAD);

  if (payloadStart < 0) {
    // No payload found
    return { header: input };
  }

  // For variable header, skip the $ delimiter
  const payloadOffset = hasFixedHeader ? 0 : 1;

  const header = input.substring(0, payloadStart);
  const payload =
    payloadStart + payloadOffset < input.length ? input.substring(payloadStart + payloadOffset) : undefined;

  return { header, payload };
}

/**
 * Adds payload to an encoded string, excluding it if empty/null/undefined
 */
function addPayload(encoded: string, payload?: string, hasFixedHeader = false, hasDollarDelimiter = false): string {
  // Return just the encoded string if payload is undefined, null, or empty string
  if (payload === undefined || payload === null || payload === '') {
    return encoded;
  }

  // Add delimiter if needed
  if (!hasFixedHeader && !hasDollarDelimiter) {
    return encoded + DELIMITERS.PAYLOAD + payload;
  }

  // Otherwise just append payload
  return encoded + payload;
}

// --- Parse functions (for decoding) ---

function parseText(text: string, size?: number): string {
  if (size !== undefined && text.length > size) {
    return text.substring(0, size);
  }
  return text;
}

function parseNum(text: string): number {
  return Number(text);
}

function parseBool(text: string): boolean {
  return text.toLowerCase() === 'true';
}

function parseList(text: string, size?: number): string[] {
  if (size !== undefined) {
    // Fixed width parsing
    const chunks = [];
    for (let j = 0; j < text.length; j += size) {
      if (j + size <= text.length) {
        chunks.push(text.substring(j, j + size));
      }
    }
    return chunks;
  }
  // Standard parsing
  return text ? text.split(DELIMITERS.LIST) : [];
}

function parseNums(text: string, size?: number): number[] {
  if (size !== undefined) {
    // Fixed width parsing
    const nums = [];
    for (let j = 0; j < text.length; j += size) {
      if (j + size <= text.length) {
        nums.push(parseInt(text.substring(j, j + size)));
      }
    }
    return nums;
  }
  // Standard parsing
  return text ? text.split(DELIMITERS.LIST).map(Number) : [];
}

function parsePairs(text: string): string[][] {
  if (!text) return [];
  const items = text.split(DELIMITERS.PAIRS_ITEM);
  const pairs = [];
  for (let j = 0; j < items.length; j += 2) {
    if (j + 1 < items.length) {
      pairs.push([items[j], items[j + 1]]);
    }
  }
  return pairs;
}

function parseNumPairs(text: string): number[][] {
  if (!text) return [];
  const items = text.split(DELIMITERS.PAIRS_ITEM);
  const pairs = [];
  for (let j = 0; j < items.length; j += 2) {
    if (j + 1 < items.length) {
      pairs.push([Number(items[j]), Number(items[j + 1])]);
    }
  }
  return pairs;
}

function parseEnum(text: string, enumValues: string[]): string {
  const index = text.charCodeAt(0) - 97; // 'a' starts at 97
  if (index < 0 || index >= enumValues.length) {
    throw new Error(`Invalid enum value "${text}". Must be one of: ${enumValues.join(', ')}`);
  }
  return enumValues[index];
}

interface TemplateInfo {
  staticParts: string[];
  patterns: Pattern[];
  hasFixedHeader: boolean;
  hasDollarDelimiter: boolean;
}

function parseTemplate(templateString: string): TemplateInfo {
  // Extract patterns
  const staticParts: string[] = [];
  const patterns: Pattern[] = [];
  const placeholderRegex = /<([^:>]+)(?::([^>]+))?>/g;
  let lastIndex = 0;
  let match;

  while ((match = placeholderRegex.exec(templateString)) !== null) {
    staticParts.push(templateString.substring(lastIndex, match.index));

    const [, name, typeAndSize = 'text'] = match;
    let type = typeAndSize;
    let size: number | undefined;
    let enumValues: string[] | undefined;

    // Handle enum type with values
    if (type.startsWith('enum[')) {
      const enumMatch = type.match(/enum\[(.*)\]/);
      if (!enumMatch) {
        throw new Error(`Invalid enum format. Expected [value1,value2,...] but got: ${typeAndSize}`);
      }
      type = 'enum';
      enumValues = enumMatch[1].split(',').filter((v) => v.trim().length > 0);
      // Check for empty enum values list
      if (enumValues.length === 0) {
        throw new Error('Empty enum values list');
      }
      // Check for duplicate enum values
      const seen = new Set<string>();
      for (const value of enumValues) {
        if (seen.has(value)) {
          throw new Error(`Duplicate enum value: ${value}`);
        }
        seen.add(value);
      }
    } else {
      // Handle size parameter for other types
      const sizeMatch = type.match(/^([^-]+)-(\d+)$/);
      if (sizeMatch) {
        type = sizeMatch[1];
        size = parseInt(sizeMatch[2]);
      }
    }

    patterns.push({ name, type: type as PatternType, size, enumValues });
    lastIndex = match.index + match[0].length;
  }

  staticParts.push(templateString.substring(lastIndex));

  // Detect special delimiters
  const hasFixedHeader = staticParts[staticParts.length - 1] === DELIMITERS.FIXED_HEADER;
  const hasDollarDelimiter = staticParts[staticParts.length - 1] === DELIMITERS.PAYLOAD;

  // Mark all patterns in a fixed header
  if (hasFixedHeader) {
    for (const pattern of patterns) {
      pattern.isFixedHeader = true;
      if (pattern.size === undefined) {
        throw new Error('Fixed-size encoding requires a size parameter for all fields');
      }
    }
  }

  return {
    staticParts,
    patterns,
    hasFixedHeader,
    hasDollarDelimiter,
  };
}

// --- Format functions (for encoding) ---

function formatText(value: any, size?: number): string {
  const str = String(value);
  if (size !== undefined) {
    if (str.length > size) {
      throw new Error(`Value "${str}" exceeds fixed width of ${size}`);
    }
    return str.padEnd(size, ' ');
  }
  return str;
}

function formatNum(value: number, size?: number): string {
  const str = String(value);
  if (size !== undefined) {
    if (str.length > size) {
      throw new Error(`Value "${str}" exceeds fixed width of ${size}`);
    }
    return str.padStart(size, '0');
  }
  return str;
}

function formatBool(value: boolean): string {
  return String(value);
}

function formatList(values: any[], size?: number): string {
  if (!Array.isArray(values)) return String(values);

  if (size !== undefined) {
    // Fixed width formatting
    return values
      .map((str) => {
        const s = String(str);
        if (s.length > size) {
          throw new Error(`Value "${s}" exceeds fixed width of ${size}`);
        }
        return s.padEnd(size, ' ');
      })
      .join('');
  }
  // Standard delimiter formatting
  return values.join(DELIMITERS.LIST);
}

function formatNums(values: number[], size?: number): string {
  if (!Array.isArray(values)) return String(values);

  if (size !== undefined) {
    // Fixed width formatting
    return values
      .map((num) => {
        const str = String(Math.floor(Number(num)));
        if (str.length > size) {
          throw new Error(`Value "${num}" exceeds fixed width of ${size}`);
        }
        return str.padStart(size, '0');
      })
      .join('');
  }
  // Standard delimiter formatting
  return values.map(String).join(DELIMITERS.LIST);
}

function formatPairs(pairs: string[][]): string {
  if (!Array.isArray(pairs)) return String(pairs);
  return pairs.flatMap((pair) => pair).join(DELIMITERS.PAIRS_ITEM);
}

function formatNumPairs(pairs: number[][]): string {
  if (!Array.isArray(pairs)) return String(pairs);
  return pairs.flatMap((pair) => pair.map(String)).join(DELIMITERS.PAIRS_ITEM);
}

function formatEnum(value: string, enumValues: string[]): string {
  const index = enumValues.indexOf(value);
  if (index === -1) {
    throw new Error(`Invalid enum value "${value}". Must be one of: ${enumValues.join(', ')}`);
  }
  return String.fromCharCode(97 + index); // Convert to a,b,c,etc
}

interface HeaderPayload {
  header: string;
  payload?: string;
}

interface ExtractResult {
  value: string;
  newRemaining: string;
  newPosition: number;
  isLastField: boolean;
}
