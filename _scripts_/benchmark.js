import { existsSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

/**
 * Runs benchmarks in a specific directory
 * @param dirPath Directory containing benchmarks
 * @param packageName Name of the package
 * @param extension Benchmark file extension
 */
async function runDirBenchmarks(dirPath, packageName, extension = '.bench.ts') {
  if (!existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    return;
  }

  const benchFiles = readdirSync(dirPath).filter((file) => file.endsWith(extension));

  if (benchFiles.length === 0) {
    console.log(`No benchmark files found in ${dirPath}`);
    return;
  }

  for (const file of benchFiles) {
    console.log(`→ ${file}`);
    try {
      process.env.BENCHMARK_PACKAGE = packageName;
      process.env.BENCHMARK_FILE = file;
      await import(join(dirPath, file));
    } catch (error) {
      console.error(`Error running ${file}: ${error.message}`);
    }
  }
}

async function main() {
  const targetDir = process.argv[2];

  // If a target directory is specified, just run benchmarks there
  if (targetDir) {
    const path = resolve(targetDir);
    const benchDir = join(path, '__benchmarks__');

    if (existsSync(benchDir)) {
      await runDirBenchmarks(benchDir, targetDir);
    } else {
      // Maybe the target path itself is a benchmark directory
      await runDirBenchmarks(path, targetDir);
    }
    return;
  }

  // Otherwise run benchmarks in all packages that have them
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) {
    console.error('Packages directory not found');
    return;
  }

  const packages = readdirSync(packagesDir).filter((pkg) => {
    const pkgPath = join(packagesDir, pkg);
    const pkgJsonPath = join(pkgPath, 'package.json');
    const benchDir = join(pkgPath, '__benchmarks__');
    
    return existsSync(pkgPath) && existsSync(pkgJsonPath) && existsSync(benchDir);
  });

  if (packages.length === 0) {
    console.log('No packages with benchmarks found');
    return;
  }

  console.log(`Found ${packages.length} package(s) with benchmarks`);

  for (const pkg of packages) {
    const benchDir = join(packagesDir, pkg, '__benchmarks__');
    console.log(`\nPackage: ${pkg}`);
    await runDirBenchmarks(benchDir, pkg);
  }
}

main().catch((err) => console.error('Benchmark error:', err));
