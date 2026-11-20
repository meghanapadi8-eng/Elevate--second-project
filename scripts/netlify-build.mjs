import { cpSync, copyFileSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const publish = path.join(root, 'dist');

rmSync(publish, { recursive: true, force: true });
mkdirSync(publish, { recursive: true });

for (const name of readdirSync(root)) {
  if (/\.(html|css|js)$/i.test(name)) {
    copyFileSync(path.join(root, name), path.join(publish, name));
  }
}

cpSync(path.join(root, 'js'), path.join(publish, 'js'), { recursive: true });
