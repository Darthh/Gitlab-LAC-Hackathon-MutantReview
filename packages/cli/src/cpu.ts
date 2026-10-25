import { execFileSync } from 'node:child_process';
import { availableParallelism, cpus, totalmem } from 'node:os';
import { readFileSync } from 'node:fs';

let clockTicksPerSecond: number | undefined;
function clockTicks(): number {
  if (clockTicksPerSecond === undefined) {
    try { clockTicksPerSecond = Number(execFileSync('getconf', ['CLK_TCK'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()) || 100; }
    catch { clockTicksPerSecond = 100; }
  }
  return clockTicksPerSecond;
}

/**
 * CPU time (user + system, ms) used by every child process this process has already reaped,
 * including their own reaped descendants: fields cutime and cstime of /proc/self/stat.
 * Measure a child by reading this before spawning it and after its `close` event.
 * Linux only (GitLab runners and Cloud Run); null elsewhere, so callers fall back to an upper bound.
 */
export function childrenCpuMs(): number | null {
  if (process.platform !== 'linux') return null;
  try {
    const stat = readFileSync('/proc/self/stat', 'utf8');
    // The command name is in parentheses and may contain spaces; fields after it start at "state".
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const cutime = Number(fields[13]);
    const cstime = Number(fields[14]);
    if (!Number.isFinite(cutime) || !Number.isFinite(cstime)) return null;
    return (cutime + cstime) * 1000 / clockTicks();
  } catch {
    return null;
  }
}

/** The machine a measurement was taken on, recorded next to every footprint. */
export function machine() {
  return {
    platform: `${process.platform} ${process.arch}`,
    cpuModel: cpus()[0]?.model?.trim() ?? 'unknown',
    vCpus: availableParallelism(),
    memoryGb: Math.round(totalmem() / 2 ** 30 * 10) / 10,
    node: process.version,
  };
}
