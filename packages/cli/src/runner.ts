import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { childrenCpuMs } from './cpu.js';

export interface Execution {
  exitCode: number | null;
  durationMs: number;
  /** User+system CPU time of the whole child process tree (Linux); null where it cannot be measured. */
  cpuMs: number | null;
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
  // Executions are sequential, so the delta of reaped-children CPU time belongs to this child alone.
  const cpuBefore = childrenCpuMs();
  return await new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), shell: false, windowsHide: true, env: executionEnvironment(), detached: process.platform !== 'win32' });
    let output = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      if (!child.pid) return;
      if (process.platform === 'win32') {
        // Numeric PID arguments only. Stop runner descendants as well as the parent.
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { shell: false, windowsHide: true, env: executionEnvironment() });
        killer.on('error', () => child.kill('SIGKILL'));
        killer.on('exit', (code) => { if (code !== 0) child.kill('SIGKILL'); });
      } else {
        try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
      }
    }, timeoutMs);
    const collect = (chunk: Buffer) => { if (output.length < 2_000_000) output += chunk.toString(); };
    child.stdout.on('data', collect);
    child.stderr.on('data', collect);
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', async (exitCode) => {
      clearTimeout(timer);
      const cpuAfter = childrenCpuMs();
      await writeFile(log, output.replace(/\x1b\[[0-9;]*m/g, ''));
      resolvePromise({ exitCode, durationMs: Date.now() - started, cpuMs: cpuBefore === null || cpuAfter === null ? null : Math.round(cpuAfter - cpuBefore), timedOut, log });
    });
  });
}
