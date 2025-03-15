import type { PropagatorFunction, PropagatorOptions, PropagatorParser } from './types';

/**
 * A propagator takes in a source and target and listens for events on the source.
 * When an event is detected, it will execute a handler and update the target.
 */
export class Propagator {
  #source: EventTarget | null = null;
  #target: EventTarget | null = null;
  #eventName: string | null = null;
  #handler: PropagatorFunction | null = null;

  #parser: PropagatorParser | null = null;
  #onParse: ((body: string) => void) | null = null;
  #onError: ((error: Error) => void) | null = null;

  /**
   * Creates a new Propagator instance.
   * @param {PropagatorOptions} options - Configuration options for the propagator
   * @param {EventTarget} [options.source] - Source that emits events
   * @param {EventTarget} [options.target] - Target that receives propagated changes
   * @param {string} [options.event] - Event name to listen for on the source
   * @param {PropagatorFunction|string} [options.handler] - Event handler function or string expression
   * @param {PropagatorParser} [options.parser] - Custom parser for string handlers
   * @param {Function} [options.onParse] - Callback fired when a string handler is parsed
   * @param {Function} [options.onError] - Callback fired when an error occurs during parsing
   */
  constructor(options: PropagatorOptions = {}) {
    const {
      source = null,
      target = null,
      event = null,
      handler = null,
      onParseSuccess: onParse = null,
      onParseError: onError = null,
      parser = null,
    } = options;

    this.#onParse = onParse;
    this.#onError = onError;
    this.#parser = parser;
    this.source = source;
    this.target = target;
    if (event) this.event = event;
    if (handler) this.handler = handler;
  }

  /**
   * The source that emits events.
   * Setting a new source will automatically update event listeners.
   */
  get source(): EventTarget | null {
    return this.#source;
  }

  set source(eventTarget: EventTarget | null) {
    // Remove listener from old source
    if (this.#source && this.#eventName) {
      this.#source.removeEventListener(this.#eventName, this.#handleEvent);
    }

    this.#source = eventTarget;

    // Add listener to new source
    if (this.#source && this.#eventName) {
      this.#source.addEventListener(this.#eventName, this.#handleEvent);
    }
  }

  /**
   * The target that receives propagated changes.
   */
  get target(): EventTarget | null {
    return this.#target;
  }

  set target(eventTarget: EventTarget | null) {
    this.#target = eventTarget;
  }

  /**
   * The name of the event to listen for on the source.
   * Setting a new event name will automatically update event listeners.
   */
  get event(): string | null {
    return this.#eventName;
  }

  set event(name: string) {
    // Remove old listener
    if (this.#source && this.#eventName) {
      this.#source.removeEventListener(this.#eventName, this.#handleEvent);
    }

    this.#eventName = name;

    // Add new listener
    if (this.#source && this.#eventName) {
      this.#source.addEventListener(this.#eventName, this.#handleEvent);
    }
  }

  /**
   * The handler function that processes the event and updates the target.
   * Can be set using either a function or a string expression.
   */
  get handler(): PropagatorFunction | null {
    return this.#handler;
  }

  set handler(value: PropagatorFunction | string | null) {
    if (typeof value === 'string') {
      try {
        this.#handler = this.#parser ? this.#parser(value, this) : this.#defaultParser(value);
      } catch (error) {
        this.#handler = null;
      }
    } else {
      this.#handler = value;
    }
  }

  /**
   * Manually triggers the propagation with an optional event.
   * If no event is provided and an event name is set, creates a new event.
   * @param {Event} [event] - Optional event to propagate
   */
  propagate(event?: Event): void {
    if (!event && this.#eventName) {
      event = new Event(this.#eventName);
    }
    if (!event) return;
    this.#handleEvent(event);
  }

  /**
   * Cleans up the propagator by removing event listeners and clearing references.
   * Should be called when the propagator is no longer needed.
   */
  dispose(): void {
    if (this.#source && this.#eventName) {
      this.#source.removeEventListener(this.#eventName, this.#handleEvent);
    }
    this.#source = null;
    this.#target = null;
    this.#handler = null;
  }

  #handleEvent = (event: Event) => {
    if (!this.#source || !this.#target || !this.#handler) return;

    try {
      this.#handler(this.#source, this.#target, event);
    } catch (error) {
      console.error('Error in propagator handler:', error);
    }
  };

  // This approach turns object syntax into imperative code.
  // We could alternatively use a parser (i.e. Babel) to statically analyse the code
  // and check on keystrokes if the code is valid.
  // We should try a few different things to figure out how this class could work best.
  #defaultParser = (body: string): PropagatorFunction | null => {
    const processedExp = body.trim();

    const codeLines: string[] = [];

    // Split the expression into lines, handling different line endings
    const lines = processedExp.split(/\r?\n/);

    for (const line of lines) {
      let line_trimmed = line.trim();
      if (!line_trimmed) continue;

      // Remove trailing comma if it exists (only if it's at the very end of the line)
      if (line_trimmed.endsWith(',')) {
        line_trimmed = line_trimmed.slice(0, -1).trim();
      }

      // Find the first colon index, which separates the key and value.
      // Colons can still be used in ternary operators or other expressions,
      const colonIndex = line_trimmed.indexOf(':');
      if (colonIndex === -1) {
        continue;
      }

      const key = line_trimmed.slice(0, colonIndex).trim();
      const value = line_trimmed.slice(colonIndex + 1).trim();

      if (key === '()') {
        // Anonymous function: directly evaluate the value
        codeLines.push(`${value};`);
      } else if (key.endsWith('()')) {
        // If the key is a method, execute it if the condition is true
        const methodName = key.slice(0, -2);
        codeLines.push(`
  if (typeof to.${methodName} !== 'function') throw new Error(\`Method '${methodName}' does not exist on the target.\`);
  else if (${value}) to.${methodName}();`);
      } else {
        // For property assignments, assign the value directly
        codeLines.push(`
  if (!('${key}' in to)) throw new Error(\`Property '${key}' does not exist on the target.\`);
  to.${key} = ${value};`);
      }
    }

    const functionBody = codeLines.join('\n');

    try {
      const handler = new Function('from', 'to', 'event', functionBody) as PropagatorFunction;
      this.#onParse?.(functionBody);
      return handler;
    } catch (error) {
      this.#onError?.(error as Error);
      return null;
    }
  };
}
