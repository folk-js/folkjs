import { readdirSync } from 'fs';
import { dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get all .bench.ts files in the __tests__ directory
const benchFiles = readdirSync(__dirname).filter((file) => file.endsWith('.bench.ts'));

// Run each benchmark file
for (const file of benchFiles) {
  console.log(`\nRunning ${file}...`);
  console.log('='.repeat(50));
  await import(`./${file}`);
}
