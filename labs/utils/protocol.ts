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
 * - list: A comma-separated list of values (default delimiter is ',')
 * - nums: A list of numeric values
 * - pairs: A list of key-value pairs (default format is 'key=value;')
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

/**
 * KeyValuePair interface for 'pairs' type
 */
interface KeyValuePair {
  key: string;
  value: string;
}

// Constants for protocol parsing
const DELIMITERS = {
  PAYLOAD: '$', // Separates header from payload
  FIXED_HEADER: '!', // Indicates a fixed-size header
  LIST: ',', // Default list delimiter
  PAIRS_ITEM: ';', // Default delimiter between key-value pairs
  PAIRS_KV: '=', // Default separator between keys and values
};

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
  const staticParts: string[] = [...strings];
  const patterns: Pattern[] = [];

  // Extract patterns from template
  if (placeholders.length === 0 && strings.length === 1) {
    // Template has no interpolations, parse it directly
    const templateStr = strings[0];
    const placeholderRegex = /<([^:>]+)(?::([^>(]+)(?:\(([^)]*)\))?)?>/g;
    let lastIndex = 0;
    let match;
    let newStatics: string[] = [];

    while ((match = placeholderRegex.exec(templateStr)) !== null) {
      newStatics.push(templateStr.substring(lastIndex, match.index));

      const [, name, type = 'text', sizeStr] = match;
      const size = sizeStr ? parseInt(sizeStr) : undefined;

      patterns.push({ name, type, size });
      lastIndex = match.index + match[0].length;
    }

    newStatics.push(templateStr.substring(lastIndex));
    staticParts.splice(0, staticParts.length, ...newStatics);
  } else {
    // Process interpolated placeholders
    for (const ph of placeholders) {
      const match = ph.match(/^<([^:>]+)(?::([^>(]+)(?:\(([^)]*)\))?)?>/);
      if (match) {
        const [, name, type = 'text', sizeStr] = match;
        const size = sizeStr ? parseInt(sizeStr) : undefined;
        patterns.push({ name, type, size });
      }
    }
  }

  // Check for special delimiter markers in the template
  const hasFixedSizeHeader = staticParts[staticParts.length - 1] === DELIMITERS.FIXED_HEADER;
  const hasDollarDelimiter = staticParts[staticParts.length - 1] === DELIMITERS.PAYLOAD;

  return {
    /**
     * Decode a string according to the protocol template
     */
    decode(input: string): Record<string, any> {
      let result: Record<string, any> = {};
      let payload = '';
      let remaining = input;

      if (hasFixedSizeHeader) {
        // For fixed-size headers, use a simpler approach
        // First, skip the static prefix
        if (!input.startsWith(staticParts[0])) {
          throw new Error(`Input doesn't match pattern at "${staticParts[0]}"`);
        }

        let pos = staticParts[0].length;

        // For a fixed-size header, we know there's only one pattern before the !
        // Extract the field with the specified size
        const pattern = patterns[0];

        if (pattern && pattern.size !== undefined) {
          // For a fixed-width field, extract exactly pattern.size characters
          const value = input.substring(pos, pos + pattern.size);
          result[pattern.name] = value;

          // Everything after the fixed-size header is the payload
          payload = input.substring(pos + pattern.size);

          // Create a new result object to make sure we're not keeping references to modified objects
          result = { [pattern.name]: value };

          // Add payload separately
          if (payload) {
            result.payload = payload;
          }

          return result;
        } else {
          // If no size is specified, this is an error for fixed-size headers
          throw new Error('Fixed-size header requires a size parameter');
        }
      } else if (hasDollarDelimiter) {
        // Template ends with $, which marks the start of payload
        // We need to find where the actual $ is in the input
        const dollarPos = input.indexOf(DELIMITERS.PAYLOAD);

        if (dollarPos >= 0) {
          // Extract everything before the $ as the remaining input to parse
          remaining = input.substring(0, dollarPos);
          // Extract everything after the $ as the payload
          payload = input.substring(dollarPos + 1);
        }
      } else {
        // Standard variable-length header with $ delimiter
        const dollarPos = input.indexOf(DELIMITERS.PAYLOAD);
        if (dollarPos >= 0) {
          payload = input.substring(dollarPos + 1);
          remaining = input.substring(0, dollarPos);
        }
      }

      // Process each segment of the template
      for (let i = 0; i < staticParts.length - 1; i++) {
        const staticPart = staticParts[i];
        if (i < patterns.length) {
          const pattern = patterns[i];

          // Skip the static prefix
          if (!remaining.startsWith(staticPart)) {
            throw new Error(`Input doesn't match pattern at "${staticPart}"`);
          }
          remaining = remaining.substring(staticPart.length);

          // Special case for $ delimiter - if this static part is $, we've reached the end
          const nextStatic = staticParts[i + 1];
          if (nextStatic === DELIMITERS.PAYLOAD || nextStatic === DELIMITERS.FIXED_HEADER) {
            // We've reached the end of the header
            result[pattern.name] = remaining;
            remaining = '';
            break;
          }

          // Find where the next static part begins
          const endPos = nextStatic ? remaining.indexOf(nextStatic) : remaining.length;

          if (endPos === -1) {
            throw new Error(`Couldn't find delimiter "${nextStatic}" in remaining input`);
          }

          // Extract the value
          const valueText = remaining.substring(0, endPos);

          // Parse according to type
          if (pattern.size !== undefined) {
            // Fixed width parsing
            switch (pattern.type) {
              case 'nums':
                // Parse fixed-width numbers
                const nums = [];
                for (let j = 0; j < valueText.length; j += pattern.size) {
                  if (j + pattern.size <= valueText.length) {
                    nums.push(parseInt(valueText.substring(j, j + pattern.size)));
                  }
                }
                result[pattern.name] = nums;
                break;

              case 'list':
                // Parse fixed-width text chunks
                const chunks = [];
                for (let j = 0; j < valueText.length; j += pattern.size) {
                  if (j + pattern.size <= valueText.length) {
                    chunks.push(valueText.substring(j, j + pattern.size));
                  }
                }
                result[pattern.name] = chunks;
                break;

              default:
                // Default to treating as text with fixed width
                // Trim the value to the exact size
                if (valueText.length > pattern.size) {
                  result[pattern.name] = valueText.substring(0, pattern.size);
                } else {
                  result[pattern.name] = valueText;
                }
            }
          } else {
            // Standard type parsing
            switch (pattern.type) {
              case 'num':
                result[pattern.name] = Number(valueText);
                break;

              case 'bool':
                result[pattern.name] = valueText.toLowerCase() === 'true';
                break;

              case 'list':
                result[pattern.name] = valueText ? valueText.split(DELIMITERS.LIST) : [];
                break;

              case 'pairs':
                if (!valueText) {
                  result[pattern.name] = [];
                } else {
                  result[pattern.name] = valueText.split(DELIMITERS.PAIRS_ITEM).map((pair) => {
                    const [key, value = ''] = pair.split(DELIMITERS.PAIRS_KV, 2);
                    return { key, value };
                  });
                }
                break;

              default: // text
                result[pattern.name] = valueText;
            }
          }

          // Continue with remainder
          remaining = remaining.substring(endPos);
        }
      }

      // Check for final static part (if not special delimiter)
      const finalPart = staticParts[staticParts.length - 1];
      if (!hasFixedSizeHeader && !hasDollarDelimiter && finalPart && !remaining.startsWith(finalPart)) {
        throw new Error(`Input doesn't match pattern at "${finalPart}"`);
      }

      // Add payload to result if it exists
      if (payload) {
        result.payload = payload;
      }

      return result;
    },

    /**
     * Encode an object into a string according to the protocol template
     */
    encode(data: Record<string, any>): string {
      let result = staticParts[0];

      for (let i = 0; i < patterns.length; i++) {
        const pattern = patterns[i];

        // Verify required field exists
        if (data[pattern.name] === undefined) {
          throw new Error(`Missing required field "${pattern.name}"`);
        }

        // Format according to type
        let formattedValue = '';

        if (pattern.size !== undefined) {
          // Fixed width formatting
          switch (pattern.type) {
            case 'nums':
              // Format fixed-width numbers
              if (Array.isArray(data[pattern.name])) {
                formattedValue = data[pattern.name]
                  .map((num: number) => {
                    const str = String(Math.floor(Number(num)));
                    return str.padStart(pattern.size!, '0');
                  })
                  .join('');
              }
              break;

            case 'list':
              // Format fixed-width text chunks
              if (Array.isArray(data[pattern.name])) {
                formattedValue = data[pattern.name]
                  .map((str: string) => {
                    const s = String(str);
                    return s.padEnd(pattern.size!, ' ');
                  })
                  .join('');
              }
              break;

            default:
              // Default to text with fixed width
              formattedValue = String(data[pattern.name]);
              // Pad or truncate to exact size
              if (formattedValue.length > pattern.size) {
                formattedValue = formattedValue.substring(0, pattern.size);
              } else if (formattedValue.length < pattern.size) {
                formattedValue = formattedValue.padEnd(pattern.size, ' ');
              }
          }
        } else {
          // Standard type formatting
          switch (pattern.type) {
            case 'num':
            case 'bool':
              formattedValue = String(data[pattern.name]);
              break;

            case 'list':
              if (Array.isArray(data[pattern.name])) {
                formattedValue = data[pattern.name].join(DELIMITERS.LIST);
              } else {
                formattedValue = String(data[pattern.name]);
              }
              break;

            case 'pairs':
              if (Array.isArray(data[pattern.name])) {
                formattedValue = data[pattern.name]
                  .map((pair: KeyValuePair) => `${pair.key}${DELIMITERS.PAIRS_KV}${pair.value}`)
                  .join(DELIMITERS.PAIRS_ITEM);
              } else {
                formattedValue = String(data[pattern.name]);
              }
              break;

            default: // text
              formattedValue = String(data[pattern.name]);
          }
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
