/**
 * Checks if an object implements a specific interface ("implements" keyword is reserved...)
 * @param obj The object to check
 * @param interfaceSymbol The symbol representing the interface
 * @returns True if the object implements the interface
 */
export function satisfies<T>(obj: any, interfaceSymbol: symbol): obj is T {
  return obj && typeof obj === 'object' && interfaceSymbol in obj;
}
