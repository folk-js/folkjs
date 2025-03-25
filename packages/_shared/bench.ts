import { execSync } from 'child_process';
import { run as mitataRun } from 'mitata';

const OUTPUT_FILE = './website/benchmark-history.json';

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

export async function run() {
  // If not in GitHub Actions, just run normally and return
  // if (!process.env.GITHUB_ACTIONS) {
  //   const results = await mitataRun();
  //   return results;
  // }

  const { benchmarks } = await mitataRun();

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
    const { readFileSync, writeFileSync } = await import('fs');
    const { join } = await import('path');

    const resultsPath = join(process.cwd(), OUTPUT_FILE);
    let history: BenchmarkHistory = {};

    try {
      history = JSON.parse(readFileSync(resultsPath, 'utf8'));
    } catch {
      // File doesn't exist or is invalid, start fresh
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

    writeFileSync(resultsPath, JSON.stringify(history, null, 2));
  } catch (error) {
    console.error('Failed to save benchmark results:', error);
  }

  return benchmarks;
}
