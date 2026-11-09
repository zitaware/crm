import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const node = process.execPath;
const children = [];
let stopping = false;

function start(args) {
  const child = spawn(node, args, { cwd: root, stdio: 'inherit', env: process.env });
  child.on('exit', (code, signal) => {
    if (stopping || signal) return;
    stop(code ?? 1);
  });
  children.push(child);
}

function stop(code) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill('SIGINT');
  setTimeout(() => process.exit(code), 400);
}

process.on('SIGINT', () => stop(0));
process.on('SIGTERM', () => stop(0));

// One compiler watches every shared package and writes dist as you save.
start([path.join(root, 'node_modules/typescript/bin/tsc'), '-b', 'tsconfig.packages.json', '--watch', '--preserveWatchOutput']);
start([path.join(root, 'node_modules/turbo/bin/turbo'), 'run', 'dev', '--filter=web', '--filter=api', '--filter=worker']);

const reloadFile = path.join(root, 'apps/api/src/package-reload.ts');
await mkdir(path.dirname(reloadFile), { recursive: true });
let reloadTimer;
function scheduleApiReload() {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(() => {
    void writeFile(reloadFile, `// Regenerated when a shared package rebuilds.\nexport const packageReload = ${Date.now()};\n`);
  }, 300);
}
watch(path.join(root, 'packages'), { recursive: true }, (_event, filename) => {
  if (!filename) return;
  const normalized = filename.split(path.sep).join('/');
  if (!normalized.includes('/dist/') || !normalized.endsWith('.js')) return;
  scheduleApiReload();
});
