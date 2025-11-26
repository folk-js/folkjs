/// <reference types="node" />

import { execSync } from 'child_process';
import { run as mitataRun } from 'mitata';

// Get path from environment or use default
const OUTPUT_FILE = process.env.BENCHMARK_HISTORY_PATH || './mitata_benchmarks.json';

interface BenchmarkHistory {
  [commit: string]: {
    timestamp: string;
    packages: {
      [packageName: string]: {
        [benchmarkFile: string]: {
          results: Array<{
            name: string;
            runs: number;
            kind: 'fn' | 'iter' | 'yield';
            avg: number;
            min: number;
            max: number;
            p25: number;
            p50: number;
            p75: number;
            p99: number;
            p999: number;
            heap?: {
              total: number;
              avg: number;
              min: number;
              max: number;
            };
          }>;
        };
      };
    };
  };
}

// Get current git commit hash (for local runs)
function getCurrentCommit() {
  try {
    return execSync('git rev-parse HEAD').toString().trim();
  } catch (error) {
    console.error('Failed to get git commit:', error);
    return 'unknown';
  }
}

// Check if we're running in CI
function isInGithubAction() {
  return Boolean(
    process.env.CI || // Standard CI environment variable
      process.env.GITHUB_ACTIONS || // GitHub Actions specific
      process.env.GITHUB_WORKFLOW, // Also GitHub Actions specific
  );
}

export async function runBenchmarks() {
  const inGithubAction = isInGithubAction();

  // If not in a github action, run normally
  if (!inGithubAction) {
    const results = await mitataRun();
    return results;
  }

  const { benchmarks } = await mitataRun();
  console.log(`Completed ${benchmarks.length} benchmarks`);

  const cleanResults = benchmarks
    .map((bench) => {
      const stats = bench.runs[0]?.stats;
      if (!stats) return null;

      return {
        name: bench.alias,
        runs: bench.runs.length,
        kind: stats.kind as 'fn' | 'iter' | 'yield',
        avg: stats.avg,
        min: stats.min,
        max: stats.max,
        p25: stats.p25,
        p50: stats.p50,
        p75: stats.p75,
        p99: stats.p99,
        p999: stats.p999,
        heap: stats.heap
          ? {
              total: stats.heap.total,
              avg: stats.heap.avg,
              min: stats.heap.min,
              max: stats.heap.max,
            }
          : undefined,
      };
    })
    .filter((result): result is NonNullable<typeof result> => result !== null);

  const benchmarkFile = process.env.BENCHMARK_FILE || 'unknown';
  const packageName = process.env.BENCHMARK_PACKAGE || 'unknown';
  const commit = process.env.GITHUB_SHA || getCurrentCommit();

  try {
    const { readFileSync, writeFileSync, mkdirSync } = await import('fs');
    const { join, dirname } = await import('path');

    const resultsPath = join(process.cwd(), OUTPUT_FILE);
    let history: BenchmarkHistory = {};

    try {
      // Try to read existing history from the benchmark repo
      history = JSON.parse(readFileSync(resultsPath, 'utf8'));
      console.log(`Loaded existing benchmark history from ${resultsPath}`);
    } catch (error: any) {
      if (error.code === 'ENOENT') {
        console.log(`Creating new benchmark history at ${resultsPath}`);
      } else {
        console.error(`Error reading benchmark history: ${error.message}`);
        console.log('Starting fresh benchmark history');
      }
    }

    // Initialize structure if needed
    if (!history[commit]) {
      history[commit] = {
        timestamp: new Date().toISOString(),
        packages: {},
      };
    }
    if (!history[commit].packages[packageName]) {
      history[commit].packages[packageName] = {};
    }

    // Set (not append) the results for this specific benchmark file
    history[commit].packages[packageName][benchmarkFile] = {
      results: cleanResults,
    };

    // Ensure the directory exists before writing
    mkdirSync(dirname(resultsPath), { recursive: true });
    writeFileSync(resultsPath, JSON.stringify(history, null, 2));
    console.log(`Successfully wrote benchmark results for ${packageName}/${benchmarkFile} to ${resultsPath}`);
  } catch (error) {
    console.error('Failed to save benchmark results:', error);
    // In CI, we want to fail the build if we can't save results
    console.error('Failing CI build due to error saving benchmark results');
    process.exit(1);
  }

  return benchmarks;
}
