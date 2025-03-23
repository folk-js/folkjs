import { readdirSync, existsSync } from 'fs';
import { join, resolve } from 'path';

/**
 * Runs benchmarks in a specific directory
 * @param dirPath Directory containing benchmarks
 * @param extension Benchmark file extension
 */
async function runDirBenchmarks(dirPath, extension = '.bench.ts') {
  if (!existsSync(dirPath)) {
    console.error(`Directory not found: ${dirPath}`);
    return;
  }

  const benchFiles = readdirSync(dirPath).filter(file => file.endsWith(extension));
  
  if (benchFiles.length === 0) {
    console.log(`No benchmark files found in ${dirPath}`);
    return;
  }

  console.log(`\nRunning ${benchFiles.length} benchmark(s) in ${dirPath}`);
  console.log('='.repeat(50));
  
  for (const file of benchFiles) {
    console.log(`\n→ Running ${file}...`);
    try {
      await import(join(dirPath, file));
    } catch (error) {
      console.error(`Error running ${file}: ${error.message}`);
    }
  }
}

/**
 * Runs benchmarks in all packages or a specific directory
 */
async function main() {
  const targetDir = process.argv[2];
  
  // If a target directory is specified, just run benchmarks there
  if (targetDir) {
    const path = resolve(targetDir);
    const benchDir = join(path, '__benchmarks__');
    
    if (existsSync(benchDir)) {
      await runDirBenchmarks(benchDir);
    } else {
      // Maybe the target path itself is a benchmark directory
      await runDirBenchmarks(path);
    }
    return;
  }
  
  // Otherwise run benchmarks in all packages that have them
  const packagesDir = join(process.cwd(), 'packages');
  if (!existsSync(packagesDir)) {
    console.error("Packages directory not found");
    return;
  }
  
  const packages = readdirSync(packagesDir).filter(pkg => {
    const pkgPath = join(packagesDir, pkg);
    const pkgJsonPath = join(pkgPath, 'package.json');
    const benchDir = join(pkgPath, '__benchmarks__');
    
    return existsSync(pkgPath) && 
           existsSync(pkgJsonPath) && 
           existsSync(benchDir);
  });
  
  if (packages.length === 0) {
    console.log("No packages with benchmarks found");
    return;
  }
  
  console.log(`Found ${packages.length} package(s) with benchmarks`);
  
  for (const pkg of packages) {
    const benchDir = join(packagesDir, pkg, '__benchmarks__');
    console.log(`\nPackage: ${pkg}`);
    await runDirBenchmarks(benchDir);
  }
}

main().catch(err => console.error("Benchmark error:", err));
