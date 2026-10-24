import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

export interface Execution {
  exitCode: number | null;
  durationMs: number;
  timedOut: boolean;
  log: string;
}

/** Arguments are passed directly to the executable. No repository text enters a shell. */
export function executionEnvironment(environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const names = new Set(['path', 'systemroot', 'windir', 'comspec', 'temp', 'tmp', 'home', 'userprofile', 'appdata', 'localappdata', 'programfiles', 'number_of_processors', 'pathext']);
  return { ...Object.fromEntries(Object.entries(environment).filter(([name]) => names.has(name.toLowerCase()))), CI: 'true', NO_COLOR: '1' };
}

export async function execute(args: string[], log: string, timeoutMs = 180_000): Promise<Execution> {
  const started = Date.now();
  await mkdir(dirname(resolve(log)), { recursive: true });
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), shell: false, windowsHide: true, env: executionEnvironment() });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; child.kill('SIGKILL'); }, timeoutMs);
    const collect = (chunk: Buffer) => { if (output.length < 2_000_000) output += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', async (exitCode) => {
      clearTimeout(timer);
      await writeFile(log, output.replace(/\x1b\[[0-9;]*m/g, ''));
      resolvePromise({ exitCode, durationMs: Date.now() - started, timedOut, log });
    });
  });
}
