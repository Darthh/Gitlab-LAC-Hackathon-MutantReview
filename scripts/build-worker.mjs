import { spawn, execFileSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';

const root = fileURLToPath(new URL('../', import.meta.url));
const revision = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', windowsHide: true }).trim();
const listener = createServer();
listener.listen(0, '127.0.0.1');
await once(listener, 'listening');
const { port } = listener.address();
await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()));

// Snapshot through Express so the deployment uses the same validation, stripping,
// optional-data statuses and summaries as the existing Cloud Run console.
const server = spawn(process.execPath, ['--import', 'tsx', 'apps/front-desk/server/index.ts', '--production'], {
  cwd: root,
  env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), REVISION: revision },
  windowsHide: true,
  stdio: ['ignore', 'pipe', 'pipe'],
});
let serverFailure;
let output = '';
server.stdout.on('data', chunk => { output += chunk; });
server.stderr.on('data', chunk => { output += chunk; });
server.on('error', error => { serverFailure = error; });
const closed = once(server, 'close').catch(() => {});
const base = `http://127.0.0.1:${port}`;

try {
  const deadline = Date.now() + 30_000;
  while (true) {
    if (serverFailure || server.exitCode !== null) throw new Error(`Snapshot server failed: ${serverFailure?.message ?? output}`);
    try {
      const response = await fetch(`${base}/api/health`, { signal: AbortSignal.timeout(1000) });
      if (response.ok) break;
    } catch { /* Wait for the existing server to start. */ }
    if (Date.now() > deadline) throw new Error(`Snapshot server did not start: ${output}`);
    await delay(100);
  }

  const endpoints = {};
  for (const name of ['config', 'health', 'evidence', 'ledger', 'benchmark', 'energy']) {
    const path = `/api/${name}`;
    const response = await fetch(`${base}${path}`, { signal: AbortSignal.timeout(15_000) });
    const body = await response.json();
    const optional = name === 'benchmark' || name === 'energy';
    if (response.status !== 200 && !(optional && response.status === 404)) {
      throw new Error(`Cannot deploy ${path}: HTTP ${response.status}: ${JSON.stringify(body)}`);
    }
    endpoints[path] = { status: response.status, body };
  }
  await mkdir(new URL('../dist/', import.meta.url), { recursive: true });
  await writeFile(new URL('../dist/worker-api.json', import.meta.url), JSON.stringify({
    generatedAt: new Date().toISOString(), revision, endpoints,
  }));
  console.log(`Worker API snapshot ready for ${revision}: ${Object.keys(endpoints).join(', ')}`);
} finally {
  server.kill();
  await closed;
}
