/**
 * Protocol - A simplified string parsing and encoding library
 *
 * This library provides a DSL for defining string protocols using
 * tagged template literals. It handles basic parsing of structured text
 * formats into JavaScript objects and encoding objects back to strings.
 *
 * Basic usage:
 * const myProtocol = protocol`prefix <field:type> suffix`;
 * const result = myProtocol.decode("prefix value suffix");
 * const encoded = myProtocol.encode({ field: "value" });
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
 * You can specify a fixed width for a field by adding a size parameter:
 * <field:type(size)> - for example, <code:text(3)> for a 3-character code
 *
 * Special delimiters:
 * - $: Indicates that everything after this point is payload data
 * - !: Marks a fixed-size header where the header length is determined by the field sizes
 */

/**
 * Pattern interface representing a placeholder in the protocol template
 */
interface Pattern {
  name: string;
  type: string;
  size?: number;
  isFixedHeader?: boolean; // Flag to identify patterns in fixed headers
}

// Constants for protocol parsing
const DELIMITERS = {
  PAYLOAD: '$', // Separates header from payload
  FIXED_HEADER: '!', // Indicates a fixed-size header
  LIST: ',', // Default list delimiter
  PAIRS_ITEM: ';', // Default delimiter for pairs
};

// --- Parse functions (for decoding) ---

/**
 * Parse a text value
 */
function parseText(text: string, size?: number): string {
  if (size !== undefined && text.length > size) {
    return text.substring(0, size);
  }
  return text;
}

/**
 * Parse a numeric value
 */
function parseNum(text: string): number {
  return Number(text);
}

/**
 * Parse a boolean value
 */
function parseBool(text: string): boolean {
  return text.toLowerCase() === 'true';
}

/**
 * Parse a list value
 */
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

/**
 * Parse a list of numeric values
 */
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

/**
 * Parse a list of pairs
 */
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

/**
 * Parse a list of numeric pairs
 */
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

/**
 * Parse a template string into static parts and patterns
 */
function parseTemplate(
  strings: TemplateStringsArray,
  placeholders: string[],
): {
  staticParts: string[];
  patterns: Pattern[];
  hasFixedHeader: boolean;
  hasDollarDelimiter: boolean;
} {
  // Create a full template string
  let fullTemplate = strings[0];
  for (let i = 0; i < placeholders.length; i++) {
    fullTemplate += placeholders[i] + strings[i + 1];
  }

  // Extract patterns
  const staticParts: string[] = [];
  const patterns: Pattern[] = [];
  const placeholderRegex = /<([^:>]+)(?::([^>(]+)(?:\(([^)]*)\))?)?>/g;
  let lastIndex = 0;
  let match;

  while ((match = placeholderRegex.exec(fullTemplate)) !== null) {
    staticParts.push(fullTemplate.substring(lastIndex, match.index));

    const [, name, type = 'text', sizeStr] = match;
    const size = sizeStr ? parseInt(sizeStr) : undefined;

    patterns.push({ name, type, size });
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

/**
 * Format a text value for encoding
 */
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

/**
 * Format a numeric value for encoding
 */
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

/**
 * Format a boolean value for encoding
 */
function formatBool(value: boolean): string {
  return String(value);
}

/**
 * Format a list of values for encoding
 */
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

/**
 * Format a list of numeric values for encoding
 */
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

/**
 * Format pairs as a flat list
 */
function formatPairs(pairs: string[][]): string {
  if (!Array.isArray(pairs)) return String(pairs);
  return pairs.flatMap((pair) => pair).join(DELIMITERS.PAIRS_ITEM);
}

/**
 * Format numeric pairs as a flat list
 */
function formatNumPairs(pairs: number[][]): string {
  if (!Array.isArray(pairs)) return String(pairs);
  return pairs.flatMap((pair) => pair.map(String)).join(DELIMITERS.PAIRS_ITEM);
}

/**
 * Splits an input string into header and payload parts
 */
function splitHeaderAndPayload(
  input: string,
  hasFixedHeader: boolean,
  fixedHeaderLength: number,
  staticPrefixLength: number,
): { header: string; payload: string | undefined } {
  const payloadStart = hasFixedHeader ? staticPrefixLength + fixedHeaderLength : input.indexOf(DELIMITERS.PAYLOAD);

  if (payloadStart < 0) {
    // No payload found
    return { header: input, payload: undefined };
  }

  // For variable header, skip the $ delimiter
  const payloadOffset = hasFixedHeader ? 0 : 1;

  const header = input.substring(0, payloadStart);
  const payload =
    payloadStart + payloadOffset < input.length ? input.substring(payloadStart + payloadOffset) : undefined;

  return { header, payload };
}

/**
 * Adds payload to an encoded string
 */
function addPayload(
  encoded: string,
  payload: string | undefined,
  hasFixedHeader: boolean,
  hasDollarDelimiter: boolean,
): string {
  if (payload === undefined) {
    return encoded;
  }

  // Add delimiter if needed
  if (!hasFixedHeader && !hasDollarDelimiter) {
    return encoded + DELIMITERS.PAYLOAD + payload;
  }

  // Otherwise just append payload
  return encoded + payload;
}

/**
 * Creates a protocol parser/encoder from a template string
 */
export function protocol(
  strings: TemplateStringsArray,
  ...placeholders: string[]
): {
  decode: (input: string) => Record<string, any>;
  encode: (data: Record<string, any>) => string;
} {
  const { staticParts, patterns, hasFixedHeader, hasDollarDelimiter } = parseTemplate(strings, placeholders);

  // Calculate fixed header length if needed
  const fixedHeaderLength = hasFixedHeader ? patterns.reduce((sum, p) => sum + (p.size || 0), 0) : 0;

  return {
    /**
     * Decode a string according to the protocol template
     */
    decode(input: string): Record<string, any> {
      // SETUP
      const result: Record<string, any> = {};

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
      if (payload) {
        result.payload = payload;
      }

      // MAIN LOOP: Process each pattern
      let pos = hasFixedHeader ? staticParts[0].length : 0;
      let i = 0;
      let remaining = header;

      for (const pattern of patterns) {
        let valueText: string;

        if (pattern.isFixedHeader) {
          // Fixed width fields: extract directly from position
          valueText = input.substring(pos, pos + pattern.size!);
          pos += pattern.size!;
        } else {
          // Variable width fields: use delimiters
          const staticPart = staticParts[i];
          if (!remaining.startsWith(staticPart)) {
            throw new Error(`Input doesn't match pattern at "${staticPart}"`);
          }
          remaining = remaining.substring(staticPart.length);

          // Check for end of input
          const nextStatic = staticParts[i + 1] || '';
          if (nextStatic === DELIMITERS.PAYLOAD || nextStatic === DELIMITERS.FIXED_HEADER) {
            result[pattern.name] = remaining;
            break;
          }

          // Find next delimiter
          const endPos = nextStatic ? remaining.indexOf(nextStatic) : remaining.length;
          if (endPos === -1) {
            throw new Error(`Couldn't find delimiter "${nextStatic}" in remaining input`);
          }

          valueText = remaining.substring(0, endPos);
          remaining = remaining.substring(endPos);
          i++;
        }

        // CASE STATEMENT: Parse value based on type
        switch (pattern.type) {
          case 'num':
            result[pattern.name] = parseNum(valueText);
            break;
          case 'bool':
            result[pattern.name] = parseBool(valueText);
            break;
          case 'list':
            result[pattern.name] = parseList(valueText, pattern.size);
            break;
          case 'nums':
            result[pattern.name] = parseNums(valueText, pattern.size);
            break;
          case 'pairs':
            result[pattern.name] = parsePairs(valueText);
            break;
          case 'numPairs':
            result[pattern.name] = parseNumPairs(valueText);
            break;
          default: // text
            result[pattern.name] = parseText(valueText, pattern.size);
            break;
        }
      }

      return result;
    },

    /**
     * Encode an object into a string according to the protocol template
     */
    encode(data: Record<string, any>): string {
      // SETUP
      let result = staticParts[0];
      let i = 0;

      // MAIN LOOP: Format each pattern
      for (const pattern of patterns) {
        // Verify required field exists
        if (data[pattern.name] === undefined) {
          throw new Error(`Missing required field "${pattern.name}"`);
        }

        // CASE STATEMENT: Format value based on type
        let formattedValue: string;
        switch (pattern.type) {
          case 'num':
            formattedValue = formatNum(data[pattern.name], pattern.size);
            break;
          case 'bool':
            formattedValue = formatBool(data[pattern.name]);
            break;
          case 'list':
            formattedValue = formatList(data[pattern.name], pattern.size);
            break;
          case 'nums':
            formattedValue = formatNums(data[pattern.name], pattern.size);
            break;
          case 'pairs':
            formattedValue = formatPairs(data[pattern.name]);
            break;
          case 'numPairs':
            formattedValue = formatNumPairs(data[pattern.name]);
            break;
          default: // text
            formattedValue = formatText(data[pattern.name], pattern.size);
            break;
        }

        // Add formatted value to result
        result += formattedValue;

        // Add next static part (except for fixed header patterns)
        if (!pattern.isFixedHeader && i + 1 < staticParts.length) {
          result += staticParts[i + 1];
        }

        i++;
      }

      // Add payload if present
      return addPayload(result, data.payload, hasFixedHeader, hasDollarDelimiter);
    },
  };
}
