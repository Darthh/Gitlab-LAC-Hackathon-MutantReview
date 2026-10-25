/**
 * Energy benchmark: what changed-line scoping actually saves.
 *
 *   node node_modules/tsx/dist/cli.mjs benchmarks/energy.ts [--workdir dir] [--only 2154] [--concurrency 2]
 *
 * For every completed PR in results/es-toolkit.json (same merge commits and changed-line ranges as
 * RESULTS.md), on one Linux machine, three StrykerJS runs are executed and timed:
 *   1. scoped     the product's run: only the changed lines
 *   2. whole-dry  the same files without ranges, dry run only (instrument + initial test run)
 *   3. whole      the same files without ranges, every mutant executed
 * CPU time is the user+system time of each Stryker process tree (/proc/self/stat cutime+cstime),
 * so it counts every worker and test-runner process, not just wall time. Raw numbers only;
 * benchmarks/energy-report.ts turns them into energy and SCI with packages/review-core/src/footprint.ts.
 * Settings mirror benchmarks/run.ts except concurrency, which defaults to the machine's vCPUs.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { availableParallelism, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mutationMetrics, normalizeStrykerReport, type StrykerReport } from '../packages/review-core/src/report.js';
import type { MutationScope } from '../packages/review-core/src/types.js';
import { childrenCpuMs, machine } from '../packages/cli/src/cpu.js';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const SOURCE = resolve(arg('results', join(HERE, 'results', 'es-toolkit.json'))!);
const OUT = resolve(arg('out', join(HERE, 'energy', 'es-toolkit.json'))!);
const WORK = arg('workdir', join(tmpdir(), 'mrbench'))!;
const ONLY = arg('only');
const CONCURRENCY = Number(arg('concurrency', String(availableParallelism())));
const STRYKER = '10.1.1';
const RUN_TIMEOUT_MS = Number(arg('timeout-minutes', '40')) * 60_000;

const study = JSON.parse(readFileSync(SOURCE, 'utf8'));
const REPO = new URL(study.target.repository).pathname.slice(1);
const CLONE = join(WORK, REPO.split('/')[1]!);
const git = (...args: string[]) => execFileSync('git', args, { cwd: CLONE, encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

interface Timed { exitCode: number | null; timedOut: boolean; wallMs: number; cpuMs: number | null; log: string }

function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv; logFile?: string }): Promise<Timed> {
  const started = Date.now();
  const cpuBefore = childrenCpuMs();
  return new Promise(done => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, detached: true });
    let out = '';
    let timedOut = false;
    const timer = setTimeout(() => { timedOut = true; try { process.kill(-child.pid!, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }, opts.timeoutMs);
    const onData = (chunk: Buffer) => { if (out.length < 4_000_000) out += chunk.toString(); };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', exitCode => {
      clearTimeout(timer);
      const cpuAfter = childrenCpuMs();
      if (opts.logFile) writeFileSync(opts.logFile, out);
      done({ exitCode, timedOut, wallMs: Date.now() - started, cpuMs: cpuBefore === null || cpuAfter === null ? null : Math.round(cpuAfter - cpuBefore), log: out });
    });
  });
}

const yarnEnv = { YARN_NODE_LINKER: 'node-modules', YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_ENABLE_TELEMETRY: '0', YARN_ENABLE_PROGRESS_BARS: 'false' };
function yarnCmd(): string[] {
  const yarnPath = /^yarnPath:\s*['"]?([^'"\s]+)/m.exec(readFileSync(join(CLONE, '.yarnrc.yml'), 'utf8'))?.[1];
  if (!yarnPath) throw new Error('No yarnPath in .yarnrc.yml');
  return [process.execPath, join(CLONE, yarnPath)];
}

/** Same install procedure as benchmarks/run.ts: the commit's own lockfile, no build scripts, Stryker added then the manifest restored. */
async function ensureDeps(workDir: string): Promise<{ ok: boolean; reason?: string }> {
  const lockHash = sha256(['package.json', 'yarn.lock', '.yarnrc.yml'].map(f => readFileSync(join(CLONE, f), 'utf8')).join('\0'));
  const marker = join(WORK, 'energy.deps-hash');
  if (existsSync(marker) && readFileSync(marker, 'utf8') === lockHash && existsSync(join(CLONE, 'node_modules/@stryker-mutator/vitest-runner'))) return { ok: true };
  rmSync(marker, { force: true });
  const [node, yarn] = yarnCmd();
  const install = await run(node!, [yarn!, 'install', '--mode=skip-build'], { cwd: CLONE, timeoutMs: RUN_TIMEOUT_MS, env: yarnEnv, logFile: join(workDir, 'install.log') });
  if (install.exitCode !== 0) return { ok: false, reason: `yarn install failed (exit ${install.exitCode})` };
  const add = await run(node!, [yarn!, 'add', '-D', `@stryker-mutator/core@${STRYKER}`, `@stryker-mutator/vitest-runner@${STRYKER}`, '--mode=skip-build'], { cwd: CLONE, timeoutMs: RUN_TIMEOUT_MS, env: yarnEnv, logFile: join(workDir, 'stryker-install.log') });
  git('checkout', '--', 'package.json', 'yarn.lock');
  if (add.exitCode !== 0) return { ok: false, reason: `installing Stryker ${STRYKER} failed (exit ${add.exitCode})` };
  writeFileSync(marker, lockHash);
  return { ok: true };
}

function strykerConfig(mutate: string[], reportFile: string, extra: Record<string, unknown> = {}) {
  const vitestConfig = ['vitest.config.mts', 'vitest.config.ts', 'vitest.config.mjs', 'vitest.config.js'].find(f => existsSync(join(CLONE, f)));
  return {
    testRunner: 'vitest',
    plugins: ['@stryker-mutator/vitest-runner'],
    ...(vitestConfig ? { vitest: { configFile: vitestConfig } } : {}),
    coverageAnalysis: 'perTest',
    mutate,
    reporters: ['json', 'progress-append-only'],
    jsonReporter: { fileName: reportFile },
    concurrency: CONCURRENCY,
    incremental: false,
    thresholds: { high: 80, low: 60, break: null },
    dryRunTimeoutMinutes: 5,
    tempDirName: '.stryker-tmp',
    cleanTempDir: 'always',
    ignorePatterns: ['docs', 'benchmarks', '.yarn', '.github', 'dist', 'coverage', 'tests/browser-compat', 'tests/types'],
    ...extra,
  };
}

const INSTRUMENTED = /Instrumented (\d+) source file\(s\) with (\d+) mutant\(s\)/;

async function stryker(name: string, mutate: string[], workDir: string, scope: MutationScope[], extra: Record<string, unknown> = {}) {
  const reportFile = join(workDir, `${name}.json`);
  rmSync(reportFile, { force: true });
  rmSync(join(CLONE, '.stryker-tmp'), { recursive: true, force: true });
  const cfg = join(workDir, `stryker.${name}.json`);
  writeFileSync(cfg, JSON.stringify(strykerConfig(mutate, reportFile, extra), null, 2));
  const res = await run(process.execPath, [join(CLONE, 'node_modules/@stryker-mutator/core/bin/stryker.js'), 'run', cfg], { cwd: CLONE, timeoutMs: RUN_TIMEOUT_MS, logFile: join(workDir, `${name}.log`) });
  const instrumented = INSTRUMENTED.exec(res.log);
  const noMutants = /mutant-free world|No files marked to be mutated/i.test(res.log);
  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) as StrykerReport : null;
  const metrics = report ? mutationMetrics(normalizeStrykerReport(report, scope)) : noMutants ? mutationMetrics([]) : null;
  const ok = !res.timedOut && (res.exitCode === 0 || noMutants);
  return {
    status: ok ? 'completed' : res.timedOut ? 'timed out' : `failed (exit ${res.exitCode})`,
    wallMs: res.wallMs,
    cpuMs: res.cpuMs,
    instrumentedMutants: instrumented ? Number(instrumented[2]) : noMutants ? 0 : null,
    initialTests: Number(/Initial test run succeeded\. Ran (\d+) tests/.exec(res.log)?.[1]) || null,
    metrics,
  };
}

async function measure(pr: { number: number; title: string; mergeSha: string; ranges: string[]; scope: MutationScope[] }) {
  const workDir = join(WORK, 'energy', String(pr.number));
  mkdirSync(workDir, { recursive: true });
  try { git('cat-file', '-e', `${pr.mergeSha}^{commit}`); } catch { git('fetch', '-q', 'origin', pr.mergeSha); }
  git('checkout', '-f', '-q', pr.mergeSha);
  const deps = await ensureDeps(workDir);
  if (!deps.ok) return { number: pr.number, status: 'failed', reason: deps.reason };
  if (git('status', '--porcelain', '--untracked-files=no')) git('checkout', '-f', '-q', pr.mergeSha);
  const files = pr.scope.map(f => f.path);
  const wholeScope: MutationScope[] = files.map(path => ({ path, lines: [{ start: 1, end: Number.MAX_SAFE_INTEGER }], change: 'modified' }));
  const scoped = await stryker('scoped', pr.ranges, workDir, pr.scope);
  log(`  #${pr.number} scoped: ${scoped.status} ${scoped.instrumentedMutants} mutants, ${(scoped.wallMs / 1000).toFixed(1)} s wall, ${((scoped.cpuMs ?? 0) / 1000).toFixed(1)} CPU-s`);
  const wholeDry = await stryker('whole-dry', files, workDir, wholeScope, { dryRunOnly: true, reporters: ['progress-append-only'] });
  log(`  #${pr.number} whole-dry: ${wholeDry.status} ${(wholeDry.wallMs / 1000).toFixed(1)} s wall, ${((wholeDry.cpuMs ?? 0) / 1000).toFixed(1)} CPU-s`);
  const whole = await stryker('whole', files, workDir, wholeScope);
  log(`  #${pr.number} whole: ${whole.status} ${whole.instrumentedMutants} mutants, ${(whole.wallMs / 1000).toFixed(1)} s wall, ${((whole.cpuMs ?? 0) / 1000).toFixed(1)} CPU-s`);
  rmSync(join(CLONE, '.stryker-tmp'), { recursive: true, force: true });
  const status = [scoped, wholeDry, whole].every(r => r.status === 'completed') ? 'completed' : 'failed';
  return { number: pr.number, title: pr.title, mergeSha: pr.mergeSha, files: files.length, changedLines: pr.scope.reduce((n, f) => n + f.lines.reduce((m, l) => m + l.end - l.start + 1, 0), 0), status, scoped, wholeDry, whole };
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  if (!existsSync(CLONE)) execFileSync('git', ['clone', '-q', '--filter=blob:none', `https://github.com/${REPO}.git`, CLONE], { stdio: 'inherit' });
  const prs = (study.pullRequests as Array<{ status: string; number: number; title: string; mergeSha: string; ranges: string[]; scope: MutationScope[] }>)
    .filter(p => p.status === 'completed' && (!ONLY || String(p.number) === ONLY));
  const previous = existsSync(OUT) ? JSON.parse(readFileSync(OUT, 'utf8')).pullRequests as Array<{ number: number; mergeSha: string; status: string }> : [];
  const records: unknown[] = [];
  const save = () => {
    mkdirSync(dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify({
      schemaVersion: 1,
      source: 'benchmarks/results/es-toolkit.json (same PRs, merge commits and changed-line ranges)',
      repository: study.target.repository,
      generatedAt: new Date().toISOString(),
      settings: { stryker: STRYKER, testRunner: 'vitest', coverageAnalysis: 'perTest', concurrency: CONCURRENCY, incremental: false, runTimeoutMs: RUN_TIMEOUT_MS },
      machine: machine(),
      cpuMeasurement: 'user+system CPU time of each Stryker process tree from /proc/self/stat (cutime+cstime) around the run',
      pullRequests: records,
    }, null, 2) + '\n');
  };
  for (const pr of prs) {
    const prior = previous.find(r => r.number === pr.number && r.mergeSha === pr.mergeSha && r.status === 'completed');
    if (prior) { records.push(prior); continue; }
    log(`PR #${pr.number}: ${pr.title}`);
    try { records.push(await measure(pr)); }
    catch (error) { records.push({ number: pr.number, mergeSha: pr.mergeSha, status: 'failed', reason: `harness error: ${(error as Error).message.slice(0, 300)}` }); }
    save();
  }
  save();
  log(`done: ${OUT}`);
}

main().catch(error => { console.error(error); process.exit(1); });
