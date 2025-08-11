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

  #defaultParser = (body: string): PropagatorFunction | null => {
    try {
      const lines = body.trim().split(/\r?\n/);
      const statements = [];

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        const colonIndex = trimmed.indexOf(':');
        if (colonIndex === -1) continue;

        const key = trimmed.slice(0, colonIndex).trim();
        const value = trimmed
          .slice(colonIndex + 1)
          .trim()
          .replace(/,\s*$/, '');

        if (key === '()') {
          statements.push(`${value};`);
        } else if (key.endsWith(')')) {
          const [methodName, args] = key.replace(')', '').split('(');
          statements.push(
            `console.log(to.${methodName}, typeof to.${methodName} === 'function', (${value})); if (typeof to.${methodName} === 'function' && (${value})) to.${methodName}(${args});`,
          );
        } else {
          statements.push(`to.${key} = ${value};`);
        }
      }

      const functionBody = statements.join('\n');
      const handler = new Function('from', 'to', 'event', functionBody) as PropagatorFunction;
      this.#onParse?.(functionBody);
      return handler;
    } catch (error) {
      this.#onError?.(error as Error);
      return null;
    }
  };
}
