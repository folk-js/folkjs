/**
 * Header - A utility for encoding/decoding compact text headers
 *
 * This utility provides a DSL for defining structured text headers using
 * tagged template literals. It handles basic parsing of structured text
 * formats into JavaScript objects and encoding objects back to strings.
 *
 * Basic usage:
 * const myHeader = header`prefix <field:type> suffix`;
 * const result = myHeader.decode("prefix value suffix");
 * const encoded = myHeader.encode({ field: "value" });
 *
 * Example:
 * const myHeader = header`QRTPB<index:num>:<hash:text-16><payload>`;
 *
 * Supported types:
 * - text: Default type, represents a text string
 * - num: Numeric value
 * - bool: Boolean value (true/false)
 * - list: A comma-separated list of values
 * - nums: A list of numeric values
 * - pairs: A list of tuple arrays where each tuple is [key, value] (format is 'key;value;key;value')
 * - numPairs: A list of number tuple arrays where each tuple is [number, number] (format is 'num;num;num;num')
 *
 * Fixed-width fields:
 * You can specify a fixed width for a field using dash notation:
 * <field:type-size> - for example, <code:text-3> for a 3-character code
 * or <id:num-5> for a 5-digit number (padded with leading zeros)
 *
 * End markers:
 * - $: Indicates that everything after this point is payload data
 * - !: Marks a fixed-size header where the header length is determined by the field sizes
 */

// Type definitions for template string parsing
type PatternType = 'text' | 'num' | 'bool' | 'list' | 'nums' | 'pairs' | 'numPairs';

// Parse basic types
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
                : string;

// Extract field definitions from template
type ExtractFields<T extends string> = T extends `${string}<${infer Field}:${infer Type}>${infer Rest}`
  ? { [K in Field]: ParseType<Type> } & ExtractFields<Rest>
  : T extends `${string}<${infer Field}>${infer Rest}`
    ? { [K in Field]: string } & ExtractFields<Rest>
    : {};

// Main type that produces the decode return type and encode input type from a template string
type HeaderData<T extends string> = ExtractFields<T> & {
  payload?: string;
  [key: string]: any; // Add index signature to allow string indexing
};

// Type helper to expose the underlying type in IDE tooltips
type HeaderDataType<T> = T extends Header<infer U> ? HeaderData<U> : never;

interface Pattern {
  name: string;
  type: PatternType;
  size?: number;
  isFixedHeader?: boolean;
}

type ParseResult = Record<string, any>;

const DELIMITERS = {
  PAYLOAD: '$',
  FIXED_HEADER: '!',
  LIST: ',',
  PAIRS_ITEM: ';',
};

interface Header<T extends string> {
  decode: (input: string) => HeaderData<T>;
  encode: (data: HeaderData<T>) => string;
}

export function header<T extends string>(strings: TemplateStringsArray, ...values: any[]): Header<T> {
  const templateString = strings.join('');
  const { staticParts, patterns, hasFixedHeader, hasDollarDelimiter } = parseTemplate(strings);

  // Calculate fixed header length if needed
  const fixedHeaderLength = hasFixedHeader ? patterns.reduce((sum, p) => sum + (p.size || 0), 0) : 0;

  return {
    encode(data: HeaderData<T>): string {
      // SETUP
      let result = staticParts[0];

      // MAIN LOOP: Format each pattern
      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];

        // Verify required field exists
        if (data[pattern.name] === undefined) {
          throw new Error(`Missing required field "${pattern.name}"`);
        }

        // Format value and add to result according to pattern type
        switch (pattern.type) {
          case 'num':
            result += formatNum(data[pattern.name] as number, pattern.size);
            break;
          case 'bool':
            result += formatBool(data[pattern.name] as boolean);
            break;
          case 'list':
            result += formatList(data[pattern.name] as string[], pattern.size);
            break;
          case 'nums':
            result += formatNums(data[pattern.name] as number[], pattern.size);
            break;
          case 'pairs':
            result += formatPairs(data[pattern.name] as string[][]);
            break;
          case 'numPairs':
            result += formatNumPairs(data[pattern.name] as number[][]);
            break;
          default: // text
            result += formatText(data[pattern.name], pattern.size);
            break;
        }

        // Add next static part (except for fixed header patterns)
        if (!pattern.isFixedHeader && i + 1 < staticParts.length) {
          result += staticParts[i + 1];
        }
      }

      // Add payload if present
      return addPayload(result, data.payload, hasFixedHeader, hasDollarDelimiter);
    },

    decode(input: string): HeaderData<T> {
      // SETUP
      const result = {} as HeaderData<T>;

      // Check input for fixed header patterns
      if (hasFixedHeader && !input.startsWith(staticParts[0])) {
        throw new Error(`Input doesn't match pattern at "${staticParts[0]}"`);
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
        const { value, newRemaining, newPosition, isLastField } = extractPatternValue(
          pattern,
          input,
          pos,
          remaining,
          staticParts[staticIndex],
          staticParts[staticIndex + 1] || '',
        );

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

      return result;
    },
  };
}

function extractPatternValue(
  pattern: Pattern,
  input: string,
  position: number,
  remaining: string,
  staticPart: string,
  nextStatic: string,
): ExtractResult {
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
    throw new Error(`Input doesn't match pattern at "${staticPart}"`);
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
    throw new Error(`Couldn't find delimiter "${nextStatic}" in remaining input`);
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

interface TemplateInfo {
  staticParts: string[];
  patterns: Pattern[];
  hasFixedHeader: boolean;
  hasDollarDelimiter: boolean;
}

function parseTemplate(strings: TemplateStringsArray): TemplateInfo {
  // Create a full template string
  let fullTemplate = strings[0];

  // Extract patterns
  const staticParts: string[] = [];
  const patterns: Pattern[] = [];
  const placeholderRegex = /<([^:>]+)(?::([^>-]+)(?:-([0-9]+))?)?>/g;
  let lastIndex = 0;
  let match;

  while ((match = placeholderRegex.exec(fullTemplate)) !== null) {
    staticParts.push(fullTemplate.substring(lastIndex, match.index));

    const [, name, type = 'text', sizeStr] = match;
    const size = sizeStr ? parseInt(sizeStr) : undefined;

    patterns.push({ name, type: type as PatternType, size });
    lastIndex = match.index + match[0].length;
  }

  staticParts.push(fullTemplate.substring(lastIndex));

  // Detect special delimiters
  const hasFixedHeader = staticParts[staticParts.length - 1] === DELIMITERS.FIXED_HEADER;
  const hasDollarDelimiter = staticParts[staticParts.length - 1] === DELIMITERS.PAYLOAD;

  // Mark all patterns in a fixed header
  if (hasFixedHeader) {
    for (const pattern of patterns) {
      pattern.isFixedHeader = true;
      if (pattern.size === undefined) {
        throw new Error('Fixed-size header requires a size parameter for all fields');
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

// Example usage to demonstrate type safety
/*
// This shows how TypeScript will infer the correct types from the template
const userHeader = header`USER<id:num>:<name:text>:<active:bool>:<tags:list>:<scores:nums>:<metadata:pairs>:<points:numPairs>`;

// TypeScript automatically infers the full type from the template - no need to specify it!
// To get proper IDE tooltips, use the HeaderDataType helper:
type UserData = HeaderDataType<typeof userHeader>;
// This will expand to:
// {
//   id: number;
//   name: string;
//   active: boolean;
//   tags: string[];
//   scores: number[];
//   metadata: Array<[string, string]>;
//   points: Array<[number, number]>;
//   payload?: string;
// }

// Type safety in action:
const userData = userHeader.decode("USER123:John:true:tag1,tag2:10,20:key;value:1;2");
// userData.id is typed as number
// userData.name is typed as string
// userData.active is typed as boolean
// userData.tags is typed as string[]
// userData.scores is typed as number[]
// userData.metadata is typed as Array<[string, string]>
// userData.points is typed as Array<[number, number]>

// With type checking on encode
userHeader.encode({
  id: 123,
  name: "John",
  active: true,
  tags: ["tag1", "tag2"],
  scores: [10, 20],
  metadata: [["key", "value"]],
  points: [[1, 2]]
});

// Another example with a simpler header:
const qrtpHeader = header`QRTPB<index:num>:<hash:text-16><payload>`;
// Use the type helper to see the actual type in IDE tooltips:
type QRTPData = HeaderDataType<typeof qrtpHeader>;
// Shows as: { index: number; hash: string; payload?: string; }
*/
