import { Propagator } from './propagator';

/**
 * A function that processes the event and updates the target.
 * @param {EventTarget} source - The source that emitted the event
 * @param {EventTarget} target - The target that receives propagated changes
 * @param {Event} event - The event that triggered the propagation
 * @returns {any} - The result of the propagation
 */
export type PropagatorFunction = (source: EventTarget, target: EventTarget, event: Event) => any;

/**
 * A parser function that converts a string expression into a PropagatorFunction.
 * @param {string} body - The string expression to parse
 * @param {Propagator} [propagator] - The Propagator instance (optional)
 * @returns {PropagatorFunction | null} - The parsed PropagatorFunction or null if parsing fails
 */
export type PropagatorParser = (body: string, propagator?: Propagator) => PropagatorFunction | null;

export type PropagatorOptions = {
  source?: EventTarget | null;
  target?: EventTarget | null;
  event?: string | null;
  handler?: PropagatorFunction | string;
  parser?: PropagatorParser;
  onParseSuccess?: (body: string) => void;
  onParseError?: (error: Error) => void;
};
