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

        // Handle all patterns before the !
        let headerLength = 0;

        for (let i = 0; i < patterns.length; i++) {
          const pattern = patterns[i];

          if (pattern.size === undefined) {
            throw new Error('Fixed-size header requires a size parameter for all fields');
          }

          // For a fixed-width field, extract exactly pattern.size characters
          const value = input.substring(pos, pos + pattern.size);

          // Convert to appropriate type
          if (pattern.type === 'num') {
            result[pattern.name] = Number(value);
          } else {
            result[pattern.name] = value;
          }

          // Move position forward
          pos += pattern.size;
          headerLength += pattern.size;
        }

        // Everything after the fixed-size header is the payload
        payload = input.substring(staticParts[0].length + headerLength);

        // Add payload separately
        if (payload) {
          result.payload = payload;
        }

        return result;
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

          // Parse according to type - combined approach
          switch (pattern.type) {
            case 'num':
              result[pattern.name] = Number(valueText);
              break;

            case 'bool':
              result[pattern.name] = valueText.toLowerCase() === 'true';
              break;

            case 'list':
              if (pattern.size !== undefined) {
                // Fixed width: Split by size
                const chunks = [];
                for (let j = 0; j < valueText.length; j += pattern.size) {
                  if (j + pattern.size <= valueText.length) {
                    chunks.push(valueText.substring(j, j + pattern.size));
                  }
                }
                result[pattern.name] = chunks;
              } else {
                // Standard: Split by delimiter
                result[pattern.name] = valueText ? valueText.split(DELIMITERS.LIST) : [];
              }
              break;

            case 'nums':
              if (pattern.size !== undefined) {
                // Fixed width: Split by size
                const nums = [];
                for (let j = 0; j < valueText.length; j += pattern.size) {
                  if (j + pattern.size <= valueText.length) {
                    nums.push(parseInt(valueText.substring(j, j + pattern.size)));
                  }
                }
                result[pattern.name] = nums;
              } else {
                // Standard: Split by delimiter
                result[pattern.name] = valueText ? valueText.split(DELIMITERS.LIST).map(Number) : [];
              }
              break;

            case 'pairs':
              if (!valueText) {
                result[pattern.name] = [];
              } else {
                // Parse as flat list of alternating keys and values
                const items = valueText.split(DELIMITERS.PAIRS_ITEM);
                const pairs = [];

                // Group items into pairs
                for (let j = 0; j < items.length; j += 2) {
                  if (j + 1 < items.length) {
                    pairs.push([items[j], items[j + 1]]);
                  }
                }

                result[pattern.name] = pairs;
              }
              break;

            case 'numPairs':
              if (!valueText) {
                result[pattern.name] = [];
              } else {
                // Parse as flat list of alternating numbers
                const items = valueText.split(DELIMITERS.PAIRS_ITEM);
                const pairs = [];

                // Group items into pairs and convert to numbers
                for (let j = 0; j < items.length; j += 2) {
                  if (j + 1 < items.length) {
                    pairs.push([Number(items[j]), Number(items[j + 1])]);
                  }
                }

                result[pattern.name] = pairs;
              }
              break;

            default: // text
              if (pattern.size !== undefined && valueText.length > pattern.size) {
                // If fixed width and value exceeds, trim it
                result[pattern.name] = valueText.substring(0, pattern.size);
              } else {
                result[pattern.name] = valueText;
              }
              break;
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

        // Format according to type - combined approach
        let formattedValue = '';

        switch (pattern.type) {
          case 'num':
            formattedValue = String(data[pattern.name]);
            // If fixed width, pad with zeros
            if (pattern.size !== undefined) {
              if (formattedValue.length > pattern.size) {
                throw new Error(
                  `Value "${formattedValue}" exceeds fixed width of ${pattern.size} for field "${pattern.name}"`,
                );
              }
              formattedValue = formattedValue.padStart(pattern.size, '0');
            }
            break;

          case 'bool':
            formattedValue = String(data[pattern.name]);
            break;

          case 'list':
            if (Array.isArray(data[pattern.name])) {
              if (pattern.size !== undefined) {
                // Fixed width formatting
                formattedValue = data[pattern.name]
                  .map((str: string) => {
                    const s = String(str);
                    if (s.length > pattern.size!) {
                      throw new Error(
                        `Value "${s}" exceeds fixed width of ${pattern.size} for item in "${pattern.name}"`,
                      );
                    }
                    return s.padEnd(pattern.size!, ' ');
                  })
                  .join('');
              } else {
                // Standard delimiter formatting
                formattedValue = data[pattern.name].join(DELIMITERS.LIST);
              }
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;

          case 'nums':
            if (Array.isArray(data[pattern.name])) {
              if (pattern.size !== undefined) {
                // Fixed width formatting
                formattedValue = data[pattern.name]
                  .map((num: number) => {
                    const str = String(Math.floor(Number(num)));
                    if (str.length > pattern.size!) {
                      throw new Error(
                        `Value "${num}" exceeds fixed width of ${pattern.size} for item in "${pattern.name}"`,
                      );
                    }
                    return str.padStart(pattern.size!, '0');
                  })
                  .join('');
              } else {
                // Standard delimiter formatting
                formattedValue = data[pattern.name].map(String).join(DELIMITERS.LIST);
              }
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;

          case 'pairs':
            if (Array.isArray(data[pattern.name])) {
              // For pairs type, we use the same format regardless of fixed width
              formattedValue = data[pattern.name].flatMap((pair: string[]) => pair).join(DELIMITERS.PAIRS_ITEM);
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;

          case 'numPairs':
            if (Array.isArray(data[pattern.name])) {
              // For numPairs type, we use the same format regardless of fixed width
              formattedValue = data[pattern.name]
                .flatMap((pair: number[]) => pair.map(String))
                .join(DELIMITERS.PAIRS_ITEM);
            } else {
              formattedValue = String(data[pattern.name]);
            }
            break;

          default: // text
            formattedValue = String(data[pattern.name]);
            // If fixed width, pad with spaces
            if (pattern.size !== undefined) {
              if (formattedValue.length > pattern.size) {
                throw new Error(
                  `Value "${formattedValue}" exceeds fixed width of ${pattern.size} for field "${pattern.name}"`,
                );
              }
              formattedValue = formattedValue.padEnd(pattern.size, ' ');
            }
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
