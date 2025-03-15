import type { PropagatorFunction, PropagatorOptions, PropagatorParser } from './types.ts';

/**
 * A propagator takes a source and target element and listens for events on both.
 * When an event is detected on one, it will execute a handler and update the other element.
 */
export class SymmetricPropagator {
  #source: EventTarget | null = null;
  #target: EventTarget | null = null;
  #eventName: string | null = null;
  #handler: PropagatorFunction | null = null;

  #parser: PropagatorParser | null = null;
  #onParse: ((body: string) => void) | null = null;
  #onError: ((error: Error) => void) | null = null;
  #isPropagationLocked = false;

  /**
   * Creates a new BiPropagator instance.
   * @param {PropagatorOptions} options - Configuration options for the propagator
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
   * The source element that emits events.
   * Setting a new source will automatically update event listeners.
   */
  get source() {
    return this.#source;
  }

  set source(element) {
    // Remove listener from old source
    if (this.#source && this.#eventName) {
      this.#source.removeEventListener(this.#eventName, this.#handleSourceEvent);
    }

    this.#source = element;

    // Add listener to new source
    if (this.#source && this.#eventName) {
      this.#source.addEventListener(this.#eventName, this.#handleSourceEvent);
    }
  }

  /**
   * The target element that receives propagated changes.
   * Setting a new target will automatically update event listeners.
   */
  get target() {
    return this.#target;
  }

  set target(element) {
    // Remove listener from old target
    if (this.#target && this.#eventName) {
      this.#target.removeEventListener(this.#eventName, this.#handleTargetEvent);
    }

    this.#target = element;

    // Add listener to new target
    if (this.#target && this.#eventName) {
      this.#target.addEventListener(this.#eventName, this.#handleTargetEvent);
    }
  }

  /**
   * The name of the event to listen for on both the source and target elements.
   */
  get event(): string | null {
    return this.#eventName;
  }

  set event(name: string | null) {
    // Remove old listeners
    if (this.#source && this.#eventName) {
      this.#source.removeEventListener(this.#eventName, this.#handleSourceEvent);
    }
    if (this.#target && this.#eventName) {
      this.#target.removeEventListener(this.#eventName, this.#handleTargetEvent);
    }

    this.#eventName = name;

    // Add new listeners
    if (this.#source && this.#eventName) {
      this.#source.addEventListener(this.#eventName, this.#handleSourceEvent);
    }
    if (this.#target && this.#eventName) {
      this.#target.addEventListener(this.#eventName, this.#handleTargetEvent);
    }
  }

  /**
   * The handler function that processes the event and updates the other element.
   * Can be set using either a function or a string expression.
   */
  get handler(): PropagatorFunction | null {
    return this.#handler;
  }

  set handler(value: PropagatorFunction | string | null) {
    if (typeof value === 'string') {
      try {
        this.#handler = this.#parser ? this.#parser(value) : this.#defaultParser(value);
      } catch (error) {
        this.#handler = null;
      }
    } else {
      this.#handler = value;
    }
  }

  /**
   * Manually triggers the propagation from the source with an optional event.
   * If no event is provided and an event name is set, creates a new event.
   * @param {Event} [event] - Optional event to propagate
   */
  propagate(event?: Event): void {
    if (!event && this.#eventName) {
      event = new Event(this.#eventName);
    }
    if (!event) return;
    this.#handleSourceEvent(event);
  }

  /**
   * Cleans up the propagator by removing event listeners and clearing references.
   * Should be called when the propagator is no longer needed.
   */
  dispose(): void {
    if (this.#source && this.#eventName) {
      this.#source.removeEventListener(this.#eventName, this.#handleSourceEvent);
    }
    if (this.#target && this.#eventName) {
      this.#target.removeEventListener(this.#eventName, this.#handleTargetEvent);
    }
    this.#source = null;
    this.#target = null;
    this.#handler = null;
  }

  #handleSourceEvent = async (event: Event) => {
    if (this.#isPropagationLocked) return;
    if (!this.#source || !this.#target || !this.#handler) return;

    this.#isPropagationLocked = true;

    try {
      // Update the target element
      this.#handler(this.#source, this.#target, event);

      // Wait for microtasks to complete
      await Promise.resolve();
    } finally {
      this.#isPropagationLocked = false;
    }
  };

  #handleTargetEvent = async (event: Event) => {
    if (this.#isPropagationLocked) return;
    if (!this.#source || !this.#target || !this.#handler) return;

    this.#isPropagationLocked = true;

    try {
      // Update the source element
      this.#handler(this.#target, this.#source, event);

      // Wait for microtasks to complete
      await Promise.resolve();
    } finally {
      this.#isPropagationLocked = false;
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
  if (typeof to.${methodName} !== 'function') throw new Error(\`Method '${methodName}' does not exist on target element.\`);
  else if (${value}) to.${methodName}();`);
      } else {
        // For property assignments, assign the value directly
        codeLines.push(`
  if (!('${key}' in to)) throw new Error(\`Property '${key}' does not exist on target element.\`);
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
