// Re-export everything from mitata except 'run'
export { B, bench, do_not_optimize, group, measure } from 'mitata';

// Export our custom run function
export { runBenchmarks as run } from './runMitataBenchmark.js';
