interface InterfaceConstraint<T> {}

export type InterfaceKey<T> = symbol & InterfaceConstraint<T>;

export function interfaceKey<T>(name: string): InterfaceKey<T> {
  return Symbol(name);
}

/**
 * Checks if an object implements a specific interface ("implements" keyword is reserved...)
 * @param obj The object to check
 * @param key The symbol representing the interface
 * @returns True if the object implements the interface
 */
export function satisfies<T>(obj: any, key: InterfaceKey<T>): obj is T {
  return obj !== null && typeof obj === 'object' && key in obj;
}
