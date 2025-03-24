import type { FolkShape } from './folk-shape';

/**
 * Coordinates effects between multiple systems, integrating their proposals into a single result.
 * Systems register, yield effects, and await integration when all systems are ready.
 */
export class EffectIntegrator<E extends Element, T> {
  #pending = new Map<E, T[] | T>();
  #systems = new Set<string>();
  #waiting = new Set<string>();
  #resolvers: ((value: Map<E, T>) => void)[] = [];

  /** Register a system to participate in effect integration */
  register(id: string) {
    this.#systems.add(id);
    return {
      yield: (element: E, effect: T) => {
        if (!this.#pending.has(element)) {
          this.#pending.set(element, []);
        }
        (this.#pending.get(element)! as T[]).push(effect);
      },

      /** Wait for all systems to submit effects, then receive integrated results */
      integrate: async (): Promise<Map<E, T>> => {
        this.#waiting.add(id);

        if (this.#waiting.size === this.#systems.size) {
          // Last system to call integrate - do integration
          for (const [element, effects] of this.#pending) {
            this.#pending.set(
              element,
              (this.constructor as typeof EffectIntegrator).integrate(element, effects as T[]),
            );
          }
          const results = this.#pending as Map<E, T>;

          // Reset for next frame
          this.#pending = new Map();
          this.#waiting.clear();

          // Resolve all waiting systems
          this.#resolvers.forEach((resolve) => resolve(results));
          this.#resolvers = [];

          return results;
        }

        // Not all systems ready - wait for integration
        return new Promise((resolve) => {
          this.#resolvers.push(resolve);
        });
      },
    };
  }

  /** Integrate multiple effects into a single result. Must be implemented by derived classes. */
  protected static integrate(element: Element, effects: any[]): any {
    throw new Error('Derived class must implement static integrate');
  }
}

// Transform-specific integrator
interface TransformEffect {
  x: number;
  y: number;
  rotation: number;
  width: number;
  height: number;
}

export class TransformIntegrator extends EffectIntegrator<FolkShape, TransformEffect> {
  static #instance: TransformIntegrator;

  static register(id: string) {
    if (!TransformIntegrator.#instance) {
      TransformIntegrator.#instance = new TransformIntegrator();
    }
    return TransformIntegrator.#instance.register(id);
  }

  /** If the element is focused, return the elements rect, otherwise average the effects */
  protected static override integrate(element: FolkShape, effects: TransformEffect[]): TransformEffect {
    if (element === document.activeElement) {
      // If the element is focused, we don't want to apply any effects and just return the current state
      const rect = element.getTransformDOMRect();
      return {
        x: rect.x,
        y: rect.y,
        rotation: rect.rotation,
        width: rect.width,
        height: rect.height,
      };
    }

    // Accumulate all effects
    const result = effects.reduce(
      (acc, effect) => ({
        x: acc.x + effect.x,
        y: acc.y + effect.y,
        rotation: acc.rotation + effect.rotation,
        width: effect.width,
        height: effect.height,
      }),
      {
        x: 0,
        y: 0,
        rotation: 0,
        width: effects[0]?.width ?? 0,
        height: effects[0]?.height ?? 0,
      },
    );

    // Average all effects
    const count = effects.length;
    result.x /= count;
    result.y /= count;
    result.rotation /= count;

    // Apply averaged results to element
    element.x = result.x;
    element.y = result.y;
    element.rotation = result.rotation;

    // Return averaged result
    return result;
  }
}
