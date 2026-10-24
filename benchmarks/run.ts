/**
 * Historical changed-lines mutation benchmark.
 *
 *   node node_modules/tsx/dist/cli.mjs benchmarks/run.ts [--repo toss/es-toolkit] [--limit 25] [--only 2154] [--out path]
 *
 * For each merged PR (newest first, merged before the cutoff): diff M^..M, keep changed executable
 * lines under the library source dir, check out M in a disposable clone, install its own lockfile,
 * run StrykerJS 10.1.1 on just those lines, and record every result (including exclusions/failures).
 * Scope parsing and report normalisation reuse packages/review-core so the numbers match the product.
 */
import { execFileSync, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDiff, strykerRanges } from '../packages/review-core/src/scope.js';
import { mutationMetrics, normalizeStrykerReport, type StrykerReport } from '../packages/review-core/src/report.js';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = arg('repo', 'toss/es-toolkit')!;
const NAME = REPO.split('/')[1]!;
const SRC = arg('src', 'src/')!;
const CUTOFF = arg('cutoff', '2026-10-23T23:59:59Z')!;
const LIMIT = Number(arg('limit', '25'));
const ONLY = arg('only');
const STRYKER = '10.1.1';
const CONCURRENCY = 4;
const PR_TIMEOUT_MS = 10 * 60_000;
// ponytail: a short %TEMP% path, because the session scratchpad path is too long for Win32 tools.
const WORK = arg('workdir', join(tmpdir(), 'mrbench'))!;
const CLONE = join(WORK, NAME);
const OUT = resolve(arg('out', join(HERE, 'results', `${NAME}.json`))!);
const RAW_DIR = join(dirname(OUT), 'raw');

const git = (...args: string[]) => execFileSync('git', args, { cwd: CLONE, encoding: 'utf8', maxBuffer: 256 << 20 }).trim();
const sha256 = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const log = (msg: string) => console.log(`[${new Date().toISOString()}] ${msg}`);

interface RunResult { exitCode: number | null; timedOut: boolean; log: string; matched?: RegExpExecArray | null; ms: number }

/** Run a command with a hard timeout; optionally stop as soon as the output matches `stopOn`. */
function run(cmd: string, args: string[], opts: { cwd: string; timeoutMs: number; env?: NodeJS.ProcessEnv; stopOn?: RegExp; logFile?: string }): Promise<RunResult> {
  const started = Date.now();
  return new Promise(done => {
    const child = spawn(cmd, args, { cwd: opts.cwd, env: { ...process.env, ...opts.env }, windowsHide: true });
    let out = '';
    let matched: RegExpExecArray | null = null;
    let timedOut = false;
    const kill = () => {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { windowsHide: true });
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs);
    const onData = (chunk: Buffer) => {
      out += chunk.toString();
      if (opts.stopOn && !matched && (matched = opts.stopOn.exec(out))) kill();
    };
    child.stdout.on('data', onData);
    child.stderr.on('data', onData);
    child.on('close', exitCode => {
      clearTimeout(timer);
      if (opts.logFile) writeFileSync(opts.logFile, out);
      done({ exitCode, timedOut, log: out, matched, ms: Date.now() - started });
    });
  });
}

const yarnEnv = { YARN_NODE_LINKER: 'node-modules', YARN_ENABLE_IMMUTABLE_INSTALLS: 'false', YARN_ENABLE_TELEMETRY: '0', YARN_ENABLE_PROGRESS_BARS: 'false' };
function yarnCmd(): string[] {
  const yarnPath = /^yarnPath:\s*['"]?([^'"\s]+)/m.exec(readFileSync(join(CLONE, '.yarnrc.yml'), 'utf8'))?.[1];
  if (!yarnPath) throw new Error('No yarnPath in .yarnrc.yml');
  return [process.execPath, join(CLONE, yarnPath)];
}

/** Install the checkout's own lockfile (node-modules linker, no build scripts) only when it changed, then add Stryker and restore the manifest. */
async function ensureDeps(workDir: string): Promise<{ ok: boolean; reason?: string; lockHash: string; installed: boolean }> {
  const lockHash = sha256(['package.json', 'yarn.lock', '.yarnrc.yml'].map(f => readFileSync(join(CLONE, f), 'utf8')).join('\0'));
  const marker = join(WORK, `${NAME}.deps-hash`);
  if (existsSync(marker) && readFileSync(marker, 'utf8') === lockHash && existsSync(join(CLONE, 'node_modules/@stryker-mutator/vitest-runner'))) return { ok: true, lockHash, installed: false };
  rmSync(marker, { force: true });
  const [node, yarn] = yarnCmd();
  const install = await run(node!, [yarn!, 'install', '--mode=skip-build'], { cwd: CLONE, timeoutMs: PR_TIMEOUT_MS, env: yarnEnv, logFile: join(workDir, 'install.log') });
  if (install.exitCode !== 0) return { ok: false, reason: `yarn install failed (exit ${install.exitCode}${install.timedOut ? ', timed out' : ''})`, lockHash, installed: true };
  const add = await run(node!, [yarn!, 'add', '-D', `@stryker-mutator/core@${STRYKER}`, `@stryker-mutator/vitest-runner@${STRYKER}`, '--mode=skip-build'], { cwd: CLONE, timeoutMs: PR_TIMEOUT_MS, env: yarnEnv, logFile: join(workDir, 'stryker-install.log') });
  git('checkout', '--', 'package.json', 'yarn.lock');
  if (add.exitCode !== 0) return { ok: false, reason: `installing Stryker ${STRYKER} failed (exit ${add.exitCode})`, lockHash, installed: true };
  writeFileSync(marker, lockHash);
  return { ok: true, lockHash, installed: true };
}

const INSTRUMENTED = /Instrumented (\d+) source file\(s\) with (\d+) mutant\(s\)/;

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

type Rec = Record<string, unknown> & { number: number; status: string; mergeSha?: string };

function classify(files: string[]): string {
  const kinds = new Set(files.map(f =>
    /^src\/.*\.(spec|test)\.tsx?$/.test(f) || /^tests?\//.test(f) ? 'tests'
      : f.startsWith(SRC) ? 'source'
      : /^docs\/|\.md$/.test(f) ? 'docs'
      : /^\.github\//.test(f) ? 'ci'
      : /^benchmarks\//.test(f) ? 'benchmarks'
      : 'other'));
  if (kinds.has('source')) return 'source changes contain no executable lines (types, imports, comments or re-exports only)';
  if (!files.length) return 'empty diff (the merge commit changed no files)';
  return `${[...kinds].sort().join('/')} only; no library source changes`;
}

async function analyse(pr: { number: number; title: string; url: string; mergedAt: string; mergeCommit?: { oid: string } }): Promise<Rec> {
  const rec: Rec = { number: pr.number, title: pr.title, url: pr.url, mergedAt: pr.mergedAt, status: 'failed' };
  const mergeSha = pr.mergeCommit?.oid;
  if (!mergeSha) return { ...rec, status: 'excluded', reason: 'no merge commit recorded by GitHub' };
  try { git('cat-file', '-e', `${mergeSha}^{commit}`); } catch { git('fetch', '-q', 'origin', mergeSha); }
  const parents = git('rev-list', '--parents', '-n', '1', mergeSha).split(' ').slice(1);
  const baseSha = parents[0]!;
  Object.assign(rec, { mergeSha, baseSha, mergeParents: parents.length });
  const changedFiles = git('diff', '--no-ext-diff', '--name-only', baseSha, mergeSha).split('\n').filter(Boolean);
  const scope = parseDiff(git('diff', '--no-ext-diff', '--unified=0', baseSha, mergeSha)).filter(f => f.path.startsWith(SRC));
  rec.changedFiles = changedFiles;
  if (!scope.length) return { ...rec, status: 'excluded', reason: classify(changedFiles) };
  const ranges = strykerRanges(scope);
  Object.assign(rec, { scope, ranges, changedLines: scope.reduce((n, f) => n + f.lines.reduce((m, l) => m + l.end - l.start + 1, 0), 0) });

  const workDir = join(WORK, 'work', String(pr.number));
  mkdirSync(workDir, { recursive: true });
  const started = Date.now();
  git('checkout', '-f', '-q', mergeSha);
  rmSync(join(CLONE, '.stryker-tmp'), { recursive: true, force: true });
  const deps = await ensureDeps(workDir);
  rec.lockHash = deps.lockHash;
  rec.reinstalled = deps.installed;
  if (!deps.ok) return { ...rec, reason: deps.reason, durationMs: Date.now() - started };
  if (git('status', '--porcelain', '--untracked-files=no')) git('checkout', '-f', '-q', mergeSha); // keep the tree identical to M
  const vitest = JSON.parse(readFileSync(join(CLONE, 'node_modules/vitest/package.json'), 'utf8')).version as string;
  rec.toolchain = { node: process.version, stryker: STRYKER, vitestRunner: STRYKER, vitest };

  // 1) Changed-lines mutation run (the product's gate).
  const reportFile = join(workDir, 'mutation.json');
  rmSync(reportFile, { force: true });
  const cfg = join(workDir, 'stryker.scoped.json');
  writeFileSync(cfg, JSON.stringify(strykerConfig(ranges, reportFile), null, 2));
  const stryker = join(CLONE, 'node_modules/@stryker-mutator/core/bin/stryker.js');
  const res = await run(process.execPath, [stryker, 'run', cfg], { cwd: CLONE, timeoutMs: PR_TIMEOUT_MS, logFile: join(workDir, 'stryker.log') });
  rec.durationMs = res.ms;
  const scoped = INSTRUMENTED.exec(res.log);
  rec.scopedInstrumented = scoped ? Number(scoped[2]) : null;
  rec.dryRunTests = Number(/Initial test run succeeded\. Ran (\d+) tests/.exec(res.log)?.[1]) || null;

  // 2) Whole-file mutant count for the same files: instrument only, stop as soon as Stryker logs the count.
  const wholeCfg = join(workDir, 'stryker.whole.json');
  writeFileSync(wholeCfg, JSON.stringify(strykerConfig(scope.map(f => f.path), join(workDir, 'whole.json'), { dryRunOnly: true, reporters: ['progress-append-only'] }), null, 2));
  const whole = await run(process.execPath, [stryker, 'run', wholeCfg], { cwd: CLONE, timeoutMs: 5 * 60_000, stopOn: INSTRUMENTED, logFile: join(workDir, 'stryker.whole.log') });
  rec.wholeFileMutants = whole.matched ? Number(whole.matched[2]) : null;
  rmSync(join(CLONE, '.stryker-tmp'), { recursive: true, force: true });

  const report = existsSync(reportFile) ? JSON.parse(readFileSync(reportFile, 'utf8')) as StrykerReport : null;
  if (res.timedOut) return { ...rec, reason: `Stryker exceeded the ${PR_TIMEOUT_MS / 60000}-minute per-PR budget` };
  if (res.exitCode !== 0 || !report) {
    if (/mutant-free world|No files marked to be mutated/i.test(res.log)) {
      return { ...rec, status: 'completed', note: 'Stryker generated no mutants on the changed lines', metrics: mutationMetrics([]), nonKilled: [] };
    }
    const tail = res.log.split('\n').filter(l => /ERROR|error|failed|Failed/.test(l)).slice(-3).join(' | ').slice(0, 600);
    return { ...rec, reason: `Stryker exit ${res.exitCode}${report ? '' : ', no report'}: ${tail || res.log.slice(-400)}` };
  }
  const mutants = normalizeStrykerReport(report, scope, { headSha: mergeSha, baseSha, toolchain: rec.toolchain as Record<string, string> });
  const metrics = mutationMetrics(mutants);
  const raw = readFileSync(reportFile);
  if (raw.length < 300 * 1024) { mkdirSync(RAW_DIR, { recursive: true }); writeFileSync(join(RAW_DIR, `${pr.number}.json`), raw); rec.rawReport = `raw/${pr.number}.json`; }
  return {
    ...rec,
    status: 'completed',
    metrics,
    nonKilled: mutants.filter(m => m.status === 'Survived' || m.status === 'NoCoverage').map(m => ({
      fingerprint: m.fingerprint, path: m.path, line: m.location.start.line, column: m.location.start.column,
      operator: m.operator, original: m.original, replacement: m.replacement, status: m.status,
    })),
  };
}

async function main() {
  mkdirSync(WORK, { recursive: true });
  if (!existsSync(CLONE)) execFileSync('git', ['clone', '-q', `https://github.com/${REPO}.git`, CLONE], { stdio: 'inherit' });
  else git('fetch', '-q', 'origin');
  const prs = (JSON.parse(execFileSync('gh', ['pr', 'list', '--repo', REPO, '--state', 'merged', '--limit', '80', '--json', 'number,title,url,mergedAt,mergeCommit'], { encoding: 'utf8' })) as Parameters<typeof analyse>[0][])
    .filter(p => p.mergedAt <= CUTOFF)
    .sort((a, b) => b.mergedAt.localeCompare(a.mergedAt))
    .filter(p => !ONLY || String(p.number) === ONLY);
  const previous = existsSync(OUT) ? (JSON.parse(readFileSync(OUT, 'utf8')).pullRequests as Rec[]) : [];
  const records: Rec[] = [];
  const save = () => {
    mkdirSync(dirname(OUT), { recursive: true });
    const attempted = records.filter(r => r.status !== 'excluded');
    writeFileSync(OUT, JSON.stringify({
      schemaVersion: 1,
      target: { repository: `https://github.com/${REPO}`, license: 'MIT', sourceDir: SRC },
      cutoff: CUTOFF,
      generatedAt: new Date().toISOString(),
      settings: { stryker: STRYKER, testRunner: 'vitest', coverageAnalysis: 'perTest', concurrency: CONCURRENCY, perPrTimeoutMs: PR_TIMEOUT_MS, eligibleLimit: LIMIT, platform: `${process.platform} ${process.arch}`, node: process.version },
      counts: { considered: records.length, excluded: records.length - attempted.length, attempted: attempted.length, completed: attempted.filter(r => r.status === 'completed').length, failed: attempted.filter(r => r.status === 'failed').length },
      pullRequests: records,
    }, null, 2) + '\n');
  };
  for (const pr of prs) {
    if (records.filter(r => r.status !== 'excluded').length >= LIMIT) break;
    const prior = previous.find(r => r.number === pr.number && r.mergeSha === pr.mergeCommit?.oid && (r.status === 'completed' || r.status === 'excluded'));
    let rec: Rec;
    if (prior) rec = prior;
    else {
      log(`PR #${pr.number}: ${pr.title}`);
      try { rec = await analyse(pr); }
      catch (error) { rec = { number: pr.number, title: pr.title, url: pr.url, mergedAt: pr.mergedAt, mergeSha: pr.mergeCommit?.oid, status: 'failed', reason: `harness error: ${(error as Error).message.slice(0, 400)}` }; }
    }
    records.push(rec);
    const m = rec.metrics as { total: number; survived: number; noCoverage: number; score: number | null } | undefined;
    log(`PR #${pr.number}: ${rec.status}${rec.reason ? ` (${rec.reason})` : ''}${m ? ` mutants=${m.total} survived=${m.survived} noCoverage=${m.noCoverage} score=${m.score?.toFixed(1) ?? 'n/a'}` : ''}`);
    save();
  }
  save();
  log(`done: ${OUT}`);
}

main().catch(error => { console.error(error); process.exit(1); });
