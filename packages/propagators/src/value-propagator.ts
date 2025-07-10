// Types specific to ValuePropagator
type ValuePropagatorFunction = (source: any, target: any) => any;
type ValuePropagatorParser = (body: string, propagator?: ValuePropagator) => ValuePropagatorFunction | null;

type ValuePropagatorOptions = {
  source?: any;
  target?: any;
  handler?: ValuePropagatorFunction | string;
  parser?: ValuePropagatorParser;
  onParseSuccess?: (body: string) => void;
  onParseError?: (error: Error) => void;
};

/**
 * A propagator that observes property changes on the source and propagates to the target.
 * Uses property watching and MutationObserver for robust change detection.
 */
export class ValuePropagator {
  #source: any = null;
  #target: any = null;
  #handler: ValuePropagatorFunction | null = null;
  #observedProperties = new Set<string>();
  #mutationObserver: MutationObserver | null = null;
  #propertyValues = new Map<string, any>();

  #parser: ValuePropagatorParser | null = null;
  #onParse: ((body: string) => void) | null = null;
  #onError: ((error: Error) => void) | null = null;

  /**
   * Creates a new ValuePropagator instance.
   */
  constructor(options: ValuePropagatorOptions = {}) {
    console.log('🔧 ValuePropagator constructor', options);
    const {
      source = null,
      target = null,
      handler = null,
      onParseSuccess: onParse = null,
      onParseError: onError = null,
      parser = null,
    } = options;

    this.#onParse = onParse;
    this.#onError = onError;
    this.#parser = parser;
    this.target = target;
    this.source = source;
    if (handler) this.handler = handler;
  }

  /**
   * The source object to observe properties on.
   */
  get source(): any {
    return this.#source;
  }

  set source(obj: any) {
    console.log('📥 Setting source:', obj);
    this.#stopObserving();
    this.#source = obj;
    this.#startObserving();
  }

  /**
   * The target object that receives propagated changes.
   */
  get target(): any {
    return this.#target;
  }

  set target(obj: any) {
    console.log('🎯 Setting target:', obj);
    this.#target = obj;
  }

  /**
   * The handler function that processes property changes and updates the target.
   * Can be set using either a function or a string expression.
   */
  get handler(): ValuePropagatorFunction | null {
    return this.#handler;
  }

  set handler(value: ValuePropagatorFunction | string | null) {
    console.log('⚙️ Setting handler:', typeof value, value);
    if (typeof value === 'string') {
      try {
        this.#handler = this.#parser ? this.#parser(value, this) : this.#defaultParser(value);
        if (this.#handler) {
          console.log('✅ Handler parsed successfully');
          this.#detectObservedProperties(value);
          this.#onParse?.(value);
        } else {
          console.log('❌ Handler parsing failed');
        }
      } catch (error) {
        console.log('💥 Handler parsing error:', error);
        this.#handler = null;
        this.#onError?.(error as Error);
      }
    } else {
      this.#handler = value;
    }

    this.#startObserving();
  }

  /**
   * Manually triggers the propagation.
   */
  propagate(): void {
    console.log('🚀 Manual propagate called');
    if (!this.#source || !this.#target || !this.#handler) {
      console.log('❌ Propagate failed - missing pieces:', {
        source: !!this.#source,
        target: !!this.#target,
        handler: !!this.#handler,
      });
      return;
    }

    try {
      console.log('✨ Executing handler');
      this.#handler(this.#source, this.#target);
    } catch (error) {
      console.error('💥 Error in value propagator handler:', error);
    }
  }

  /**
   * Cleans up the propagator by stopping observations and clearing references.
   * Should be called when the propagator is no longer needed.
   */
  dispose(): void {
    console.log('🗑️ Disposing ValuePropagator');
    this.#stopObserving();
    this.#source = null;
    this.#target = null;
    this.#handler = null;
  }

  #detectObservedProperties(expression: string): void {
    this.#observedProperties.clear();

    // Simple regex to find property accesses like "from.propertyName"
    const propertyRegex = /from\.([a-zA-Z_$][a-zA-Z0-9_$]*)/g;
    let match;

    while ((match = propertyRegex.exec(expression)) !== null) {
      this.#observedProperties.add(match[1]);
    }

    console.log('🔍 Detected observed properties:', Array.from(this.#observedProperties));
  }

  #startObserving(): void {
    this.#stopObserving();

    if (!this.#source || !this.#handler || this.#observedProperties.size === 0) {
      console.log('⏸️ Not starting observation - missing pieces');
      return;
    }

    console.log('👁️ Starting property observation');

    // Store initial property values
    this.#updatePropertyValues();

    // Set up MutationObserver to watch for attribute changes
    this.#mutationObserver = new MutationObserver((mutations) => {
      let hasRelevantChange = false;

      for (const mutation of mutations) {
        if (mutation.type === 'attributes') {
          const attributeName = mutation.attributeName;
          if (attributeName && this.#observedProperties.has(attributeName)) {
            hasRelevantChange = true;
            break;
          }
        }
      }

      if (hasRelevantChange) {
        console.log('🔄 Relevant attribute change detected');
        this.#checkPropertyChanges();
      }
    });

    this.#mutationObserver.observe(this.#source, {
      attributes: true,
      attributeFilter: Array.from(this.#observedProperties),
    });

    // Also set up property polling as fallback
    this.#startPropertyPolling();

    // Trigger initial propagation
    this.propagate();
  }

  #stopObserving(): void {
    if (this.#mutationObserver) {
      console.log('🛑 Stopping observation');
      this.#mutationObserver.disconnect();
      this.#mutationObserver = null;
    }
    this.#stopPropertyPolling();
  }

  #pollingInterval: number | null = null;

  #startPropertyPolling(): void {
    this.#stopPropertyPolling();

    // Poll for property changes every 100ms as fallback
    this.#pollingInterval = window.setInterval(() => {
      this.#checkPropertyChanges();
    }, 100);
  }

  #stopPropertyPolling(): void {
    if (this.#pollingInterval !== null) {
      clearInterval(this.#pollingInterval);
      this.#pollingInterval = null;
    }
  }

  #updatePropertyValues(): void {
    for (const prop of this.#observedProperties) {
      const value = this.#source[prop];
      this.#propertyValues.set(prop, value);
    }
  }

  #checkPropertyChanges(): void {
    let hasChanges = false;

    for (const prop of this.#observedProperties) {
      const currentValue = this.#source[prop];
      const previousValue = this.#propertyValues.get(prop);

      if (currentValue !== previousValue) {
        console.log(`🔄 Property '${prop}' changed:`, previousValue, '→', currentValue);
        this.#propertyValues.set(prop, currentValue);
        hasChanges = true;
      }
    }

    if (hasChanges) {
      console.log('⚡ Property changes detected - triggering propagation');
      this.propagate();
    }
  }

  #defaultParser = (body: string): ValuePropagatorFunction | null => {
    console.log('📝 Parsing expression:', body);
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
        } else if (key.endsWith('()')) {
          const methodName = key.slice(0, -2);
          statements.push(`if (typeof to.${methodName} === 'function' && (${value})) to.${methodName}();`);
        } else {
          statements.push(`to.${key} = ${value};`);
        }
      }

      const functionBody = statements.join('\n');
      console.log('📋 Generated function body:', functionBody);
      const handler = new Function('from', 'to', functionBody) as ValuePropagatorFunction;
      return handler;
    } catch (error) {
      console.log('💥 Parsing error:', error);
      this.#onError?.(error as Error);
      return null;
    }
  };
}
