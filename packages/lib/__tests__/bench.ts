import { readdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Get all .bench.ts files in the __tests__ directory
const benchFiles = readdirSync(__dirname)
  .filter((file) => file.endsWith('.bench.ts'))
  .filter((file) => file !== 'bench.ts'); // Exclude this runner file

// Run each benchmark file
for (const file of benchFiles) {
  console.log(`\nRunning ${file}...`);
  console.log('='.repeat(50));
  await import(`./${file}`);
}
