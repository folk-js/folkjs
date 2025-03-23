// A unique symbol to identify reaction rules
export const REACTION_RULE_TYPE = Symbol('reactionRule');

// A more refined type definition for Solution
type Solution<T> = Map<T | ReactionRule<T>, number>;

// A reaction rule matches elements from the solution and transforms them
interface ReactionRule<T> {
  // Symbol property to identify reaction rules
  [REACTION_RULE_TYPE]: true;

  // What this rule consumes (elements and/or other rules)
  consumes: Map<T | ReactionRule<T>, number>;

  // What this rule produces (elements and/or other rules)
  produces: Map<T | ReactionRule<T>, number>;
}

export class ChemicalMachine<T> {
  #solution: Solution<T> = new Map();

  // Add elements or rules to the solution
  add(element: T | ReactionRule<T>, count: number = 1): void {
    // Prevent negative counts
    if (count <= 0) {
      throw new Error('Cannot add a non-positive count of an element');
    }

    const currentCount = this.#solution.get(element) || 0;
    this.#solution.set(element, currentCount + count);
  }

  // Type guard for reaction rules
  #isReactionRule(element: any): element is ReactionRule<T> {
    return element && typeof element === 'object' && REACTION_RULE_TYPE in element;
  }

  // Try to apply a single rule
  #applyRule(rule: ReactionRule<T>): boolean {
    // Check if we have all the required elements
    for (const [element, count] of rule.consumes.entries()) {
      if ((this.#solution.get(element) || 0) < count) {
        return false;
      }
    }

    // Consume the elements
    for (const [element, count] of rule.consumes.entries()) {
      const currentCount = this.#solution.get(element) as number;

      if (currentCount === count) {
        this.#solution.delete(element);
      } else {
        this.#solution.set(element, currentCount - count);
      }
    }

    // Produce new elements (which can include rules)
    for (const [element, count] of rule.produces.entries()) {
      // Ensure we're not adding negative counts
      if (count <= 0) continue;

      const currentCount = this.#solution.get(element) || 0;
      this.#solution.set(element, currentCount + count);
    }

    return true;
  }

  // Step the system forward
  step(): boolean {
    // Find all rules in the solution
    const rules: ReactionRule<T>[] = [];
    for (const [element, count] of this.#solution.entries()) {
      if (this.#isReactionRule(element)) {
        rules.push(element);
      }
    }

    // Try to apply each rule
    for (const rule of rules) {
      if (this.#applyRule(rule)) {
        return true;
      }
    }

    return false;
  }

  // Run the system until no more rules can be applied
  run(maxSteps: number = 1000): number {
    let steps = 0;

    while (steps < maxSteps) {
      if (!this.step()) break;
      steps++;
    }

    return steps;
  }

  // Get the current state
  getSolution(): Solution<T> {
    return new Map(this.#solution);
  }
}
