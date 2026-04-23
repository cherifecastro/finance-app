import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');
const requiredFiles = ['index.html', '_headers', '_redirects', 'robots.txt', '404.html', 'favicon.svg', 'site.webmanifest'];

async function ensureExists(relativePath) {
  await stat(path.join(root, relativePath));
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

for (const file of requiredFiles) {
  await ensureExists(file);
  await cp(path.join(root, file), path.join(dist, file));
}

await ensureExists('assets');
await cp(path.join(root, 'assets'), path.join(dist, 'assets'), { recursive: true });

console.log('Cloudflare Pages build ready in dist/');
