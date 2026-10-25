/**
 * Model input that deterministic triage keeps out of the drafting prompt, on the es-toolkit PRs.
 *
 *   node node_modules/tsx/dist/cli.mjs benchmarks/model-input.ts [--reports <dir>]
 *
 * For every completed PR in results/es-toolkit.json with a Stryker JSON report (by default the committed
 * reports in results/raw/; the energy benchmark's changed-line runs leave one per PR in
 * <workdir>/energy/<PR>/scoped.json), this normalises the report with the PR's changed-line scope, runs the
 * product's triage, and measures the per-finding brief context the Duo flow would send (at most three findings)
 * against what an agent asked to "write a test for every surviving mutant" would receive.
 * Uses packages/review-core only; reads the source text Stryker stored in each report. Writes results/es-toolkit-model-input.json.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { normalizeStrykerReport, type StrykerReport } from '../packages/review-core/src/report.js';
import { modelInputSavings, triageMutants } from '../packages/review-core/src/triage.js';
import type { MutationScope } from '../packages/review-core/src/types.js';

const arg = (name: string, fallback?: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1]! : fallback;
};
const HERE = dirname(fileURLToPath(import.meta.url));
const REPORTS = resolve(arg('reports', join(HERE, 'results', 'raw'))!);
const OUT = resolve(arg('out', join(HERE, 'results', 'es-toolkit-model-input.json'))!);
const study = JSON.parse(readFileSync(join(HERE, 'results', 'es-toolkit.json'), 'utf8')) as { pullRequests: { number: number; status: string; scope?: MutationScope[]; mergeSha?: string }[] };

const reportFor = (pr: number) => [join(REPORTS, `${pr}.json`), join(REPORTS, String(pr), 'scoped.json')].find(existsSync) ?? null;

const rows = [];
const missing: number[] = [];
for (const pr of study.pullRequests.filter((item) => item.status === 'completed' && item.scope)) {
  const file = reportFor(pr.number);
  if (!file) { missing.push(pr.number); continue; }
  const report = JSON.parse(readFileSync(file, 'utf8')) as StrykerReport;
  const sources = Object.fromEntries(Object.entries(report.files).map(([path, value]) => [path.replaceAll('\\', '/').replace(/^\.\//, ''), value.source]));
  const mutants = normalizeStrykerReport(report, pr.scope!);
  const triage = triageMutants(mutants, sources);
  rows.push({ number: pr.number, arid: triage.arid.length, overflow: triage.overflow, ...modelInputSavings(mutants, sources, triage) });
}
const total = (key: 'findingsSent' | 'findingsOpen' | 'charsSent' | 'charsOpen' | 'charsAvoided' | 'tokensAvoidedApprox' | 'arid') => rows.reduce((sum, row) => sum + row[key], 0);
const summary = {
  prs: rows.length,
  withOpenMutants: rows.filter((row) => row.findingsOpen > 0).length,
  findingsSent: total('findingsSent'),
  findingsOpen: total('findingsOpen'),
  aridFiltered: total('arid'),
  charsSent: total('charsSent'),
  charsOpen: total('charsOpen'),
  charsAvoided: total('charsAvoided'),
  tokensAvoidedApprox: total('tokensAvoidedApprox'),
  avoidedPercent: total('charsOpen') ? Number((100 * total('charsAvoided') / total('charsOpen')).toFixed(1)) : 0,
};
writeFileSync(OUT, JSON.stringify({
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  reports: REPORTS.startsWith(HERE) ? `benchmarks/${REPORTS.slice(HERE.length + 1).replaceAll('\\', '/')}` : 'changed-line Stryker reports of benchmarks/energy.ts (same merge commits and ranges)',
  method: 'Per-finding drafting-brief context (packages/review-core findingContext) for the ranked findings (at most 3, after arid triage and one per line) versus every Survived/NoCoverage mutant. Characters are measured; tokens = characters / 4, an approximation. Shared preamble, requirement docs and test-file excerpts are excluded from both sides.',
  summary,
  missingReports: missing,
  pullRequests: rows,
}, null, 2) + '\n');
console.log(`${summary.prs} PRs: ${summary.findingsSent} of ${summary.findingsOpen} open mutants reach a drafting prompt; ${summary.charsAvoided} characters (≈${summary.tokensAvoidedApprox} tokens, ${summary.avoidedPercent}%) kept out.${missing.length ? ` No report for #${missing.join(', #')}.` : ''}`);
