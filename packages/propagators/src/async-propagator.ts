import type { PropagatorFunction, PropagatorOptions } from './types.ts';

/**
 * Custom type definitions for AsyncPropagator
 */
export type AsyncPropagatorFunction = (source: EventTarget, target: EventTarget, event: Event) => any;
export type AsyncPropagatorParser = (body: string, propagator?: AsyncPropagator) => PropagatorFunction | null;

/**
 * AsyncPropagator extends the concept of propagation to support asynchronous operations.
 * It can handle awaiting promises within expressions before applying updates to the target.
 */
export class AsyncPropagator {
  #source: EventTarget | null = null;
  #target: EventTarget | null = null;
  #eventName: string | null = null;
  #handler: PropagatorFunction | null = null;

  #parser: AsyncPropagatorParser | null = null;
  #onParse: ((body: string) => void) | null = null;
  #onError: ((error: Error) => void) | null = null;

  /**
   * Creates a new AsyncPropagator instance.
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
    this.#parser = parser as AsyncPropagatorParser;
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
        this.#handler = this.#parser ? this.#parser(value, this) : this.#asyncParser(value);
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

  /**
   * Parses a string expression into an async handler function.
   * @param {string} body - The expression to parse
   * @returns {PropagatorFunction} - An async handler function
   */
  #asyncParser = (body: string): PropagatorFunction | null => {
    try {
      const lines = body.trim().split(/\r?\n/);
      const updates: Array<{
        prop: string;
        expr: string;
        type?: 'direct' | 'method' | 'property';
        method?: string;
        property?: string;
      }> = [];

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

        // Handle special cases like function calls
        if (key === '()') {
          updates.push({ prop: '()', expr: value, type: 'direct' });
        } else if (key.endsWith('()')) {
          const methodName = key.slice(0, -2);
          updates.push({ prop: key, expr: value, type: 'method', method: methodName });
        } else {
          updates.push({ prop: key, expr: value, type: 'property', property: key });
        }
      }

      // Create the async handler function
      const handler = async (from: EventTarget, to: EventTarget, event: Event) => {
        const pendingUpdates = updates.map(({ prop, expr, type, method, property }) => {
          // Force all expressions to be evaluated in the same tick of the event loop
          // by wrapping them in a microtask (Promise)
          const evalFn = new Function(
            'from',
            'to',
            'event',
            `
              return (async function() {
                // Force a microtask delay even for non-async expressions
                await Promise.resolve();
                // Now evaluate the expression in this async context
                return ${expr}; 
              })();
            `,
          );

          return {
            type,
            method,
            property,
            promise: evalFn(from, to, event),
          };
        });

        try {
          // First, wait for all promises to resolve and collect results
          const results = await Promise.all(pendingUpdates.map((update) => update.promise));

          // Then apply all updates in order using the resolved values
          for (let i = 0; i < pendingUpdates.length; i++) {
            const update = pendingUpdates[i]!;
            const result = results[i];

            if (update.type === 'direct') {
              // Direct execution already happened
            } else if (update.type === 'method' && update.method) {
              const target = to as any;
              if (typeof target[update.method] === 'function' && result) {
                target[update.method]();
              }
            } else if (update.type === 'property' && update.property) {
              (to as any)[update.property] = result;
            }
          }
        } catch (error) {
          console.error('Error in async propagator handler:', error);
        }
      };

      const functionBody = `Async handler with ${updates.length} updates`;
      this.#onParse?.(functionBody);
      return handler;
    } catch (error) {
      this.#onError?.(error as Error);
      return null;
    }
  };

  /**
   * The event handler that processes events from the source.
   */
  #handleEvent = (event: Event) => {
    if (!this.#source || !this.#target || !this.#handler) return;

    // Execute the handler
    try {
      this.#handler(this.#source, this.#target, event);
    } catch (error) {
      console.error('Error in async propagator handler:', error);
    }
  };
}
