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
}

// Constants for protocol parsing
const DELIMITERS = {
  PAYLOAD: '$', // Separates header from payload
  FIXED_HEADER: '!', // Indicates a fixed-size header
  LIST: ',', // Default list delimiter
  PAIRS_ITEM: ';', // Default delimiter for pairs
};

/**
 * Parse a template string into static parts and patterns
 */
function parseTemplate(
  strings: TemplateStringsArray,
  placeholders: string[],
): { staticParts: string[]; patterns: Pattern[] } {
  const staticParts: string[] = [];
  const patterns: Pattern[] = [];

  // Combine all strings and placeholders into a single template string
  let fullTemplate = strings[0];
  for (let i = 0; i < placeholders.length; i++) {
    fullTemplate += placeholders[i] + strings[i + 1];
  }

  // Extract patterns using regex
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

  return { staticParts, patterns };
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
  // Parse the template into static parts and patterns
  const { staticParts, patterns } = parseTemplate(strings, placeholders);

  // Check for special delimiter markers in the template
  const hasFixedSizeHeader = staticParts[staticParts.length - 1] === DELIMITERS.FIXED_HEADER;
  const hasDollarDelimiter = staticParts[staticParts.length - 1] === DELIMITERS.PAYLOAD;

  /**
   * Special case handler for fixed-size headers
   */
  function decodeFixedHeader(input: string): Record<string, any> {
    if (!input.startsWith(staticParts[0])) {
      throw new Error(`Input doesn't match pattern at "${staticParts[0]}"`);
    }

    const result: Record<string, any> = {};
    let pos = staticParts[0].length;

    // Calculate total fixed header length
    const headerLength = patterns.reduce((sum, p) => sum + (p.size || 0), 0);

    // Extract header and payload
    const headerPart = input.substring(pos, pos + headerLength);
    const payload = input.substring(pos + headerLength);

    // Parse each pattern in sequence
    let headerPos = 0;
    for (const pattern of patterns) {
      if (pattern.size === undefined) {
        throw new Error('Fixed-size header requires a size parameter for all fields');
      }

      const value = headerPart.substring(headerPos, headerPos + pattern.size);
      result[pattern.name] = pattern.type === 'num' ? parseNum(value) : value;

      headerPos += pattern.size;
    }

    if (payload) {
      result.payload = payload;
    }

    return result;
  }

  /**
   * Extract payload from input string if present
   */
  function extractPayload(input: string): { remaining: string; payload: string } {
    const dollarPos = input.indexOf(DELIMITERS.PAYLOAD);
    if (dollarPos >= 0) {
      return {
        remaining: input.substring(0, dollarPos),
        payload: input.substring(dollarPos + 1),
      };
    }
    return { remaining: input, payload: '' };
  }

  return {
    /**
     * Decode a string according to the protocol template
     */
    decode(input: string): Record<string, any> {
      // Handle special case: fixed-size headers
      if (hasFixedSizeHeader) {
        return decodeFixedHeader(input);
      }

      const result: Record<string, any> = {};

      // Extract payload if present
      const { remaining: initialRemaining, payload } = extractPayload(input);
      if (payload) {
        result.payload = payload;
      }

      let remaining = initialRemaining;

      // Process each segment of the template
      for (let i = 0; i < patterns.length; i++) {
        const staticPart = staticParts[i];
        const pattern = patterns[i];
        const nextStatic = staticParts[i + 1] || '';

        // Skip the static prefix
        if (!remaining.startsWith(staticPart)) {
          throw new Error(`Input doesn't match pattern at "${staticPart}"`);
        }
        remaining = remaining.substring(staticPart.length);

        // Special case for end delimiters
        if (nextStatic === DELIMITERS.PAYLOAD || nextStatic === DELIMITERS.FIXED_HEADER) {
          result[pattern.name] = remaining;
          break;
        }

        // Find where the next static part begins
        const endPos = nextStatic ? remaining.indexOf(nextStatic) : remaining.length;
        if (endPos === -1) {
          throw new Error(`Couldn't find delimiter "${nextStatic}" in remaining input`);
        }

        // Extract and parse the value
        const valueText = remaining.substring(0, endPos);

        // Parse according to type using the appropriate parse function
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

        // Continue with remainder
        remaining = remaining.substring(endPos);
      }

      // Check for final static part
      const finalPart = staticParts[staticParts.length - 1];
      if (!hasFixedSizeHeader && !hasDollarDelimiter && finalPart && !remaining.startsWith(finalPart)) {
        throw new Error(`Input doesn't match pattern at "${finalPart}"`);
      }

      return result;
    },

    /**
     * Encode an object into a string according to the protocol template
     */
    encode(data: Record<string, any>): string {
      let result = staticParts[0];

      // Process each pattern in the template
      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];

        // Verify required field exists
        if (data[pattern.name] === undefined) {
          throw new Error(`Missing required field "${pattern.name}"`);
        }

        // Format according to type using the appropriate format function
        let formattedValue = '';

        switch (pattern.type) {
          case 'num':
            formattedValue = formatNum(data[pattern.name], pattern.size);
            break;
          case 'bool':
            formattedValue = formatBool(data[pattern.name]);
            break;
          case 'list':
            if (Array.isArray(data[pattern.name])) {
              formattedValue = formatList(data[pattern.name], pattern.size);
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;
          case 'nums':
            if (Array.isArray(data[pattern.name])) {
              formattedValue = formatNums(data[pattern.name], pattern.size);
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;
          case 'pairs':
            if (Array.isArray(data[pattern.name])) {
              formattedValue = formatPairs(data[pattern.name]);
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;
          case 'numPairs':
            if (Array.isArray(data[pattern.name])) {
              formattedValue = formatNumPairs(data[pattern.name]);
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;
          default: // text
            formattedValue = formatText(data[pattern.name], pattern.size);
            break;
        }

        result += formattedValue;

        // Add the next static part
        if (i + 1 < staticParts.length) {
          result += staticParts[i + 1];
        }
      }

      // Add payload
      if (data.payload !== undefined) {
        if (hasFixedSizeHeader) {
          // For fixed size headers, remove the ! and append payload directly
          result = result.substring(0, result.length - 1) + data.payload;
        } else if (hasDollarDelimiter) {
          // The template already ends with $, just append payload
          result += data.payload;
        } else {
          // For variable size header without $ in template
          result += DELIMITERS.PAYLOAD + data.payload;
        }
      }

      return result;
    },
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
  return pairs.flatMap((pair) => pair).join(DELIMITERS.PAIRS_ITEM);
}

/**
 * Format numeric pairs as a flat list
 */
function formatNumPairs(pairs: number[][]): string {
  return pairs.flatMap((pair) => pair.map(String)).join(DELIMITERS.PAIRS_ITEM);
}

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
