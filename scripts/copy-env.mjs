import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const root = process.cwd();
const envPath = resolve(root, '.env');
const examplePath = resolve(root, '.example.env');

if (!existsSync(envPath) && existsSync(examplePath)) {
  copyFileSync(examplePath, envPath);
  console.log('.example.env has been copied to .env');
} else if (existsSync(envPath)) {
  console.log('.env already exists; leaving it unchanged');
} else {
  console.log('No .example.env found; skipping .env creation');
}
