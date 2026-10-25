/**
 * Renders benchmarks/ENERGY.md from benchmarks/energy/es-toolkit.json.
 *   node node_modules/tsx/dist/cli.mjs benchmarks/energy-report.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatGrams, GRID_REGIONS, POWER_MODELS } from '../packages/review-core/src/footprint.js';
import { summarizeEnergy } from './energy-summary.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const raw = JSON.parse(readFileSync(join(HERE, 'energy', 'es-toolkit.json'), 'utf8'));
const summary = summarizeEnergy(raw);
if (!summary) throw new Error('No completed energy measurements to report.');
const c = POWER_MODELS.central;
const wh = (value: number) => (value >= 1 ? `${value.toFixed(2)} Wh` : `${(value * 1000).toFixed(1)} mWh`);
const failed = (raw.pullRequests as { number: number; status: string; reason?: string }[]).filter((pr) => pr.status !== 'completed');
// Optional: prompt context triage keeps out on the same PRs (benchmarks/model-input.ts).
const modelInputFile = join(HERE, 'results', 'es-toolkit-model-input.json');
const modelInput = existsSync(modelInputFile) ? JSON.parse(readFileSync(modelInputFile, 'utf8')) as { reports: string; summary: { prs: number; withOpenMutants: number; findingsSent: number; findingsOpen: number; aridFiltered: number; charsOpen: number; charsAvoided: number; tokensAvoidedApprox: number; avoidedPercent: number } } : null;

const lines = [
  `# Energy: changed-line vs whole-file mutation testing on ${summary.repository}`,
  '',
  `Generated ${new Date().toISOString().slice(0, 10)} from [\`energy/es-toolkit.json\`](energy/es-toolkit.json) by \`benchmarks/energy.ts\` + \`benchmarks/energy-report.ts\`. Same merged PRs, merge commits and changed-line ranges as [RESULTS.md](RESULTS.md).`,
  '',
  `**Mutating only the changed lines used ${summary.savedPercent.toFixed(0)}% less energy than mutating the whole changed files** across ${summary.measured} PRs: ${wh(summary.changedLines.energyWh)} instead of ${wh(summary.wholeFile.energyWh)}, ${summary.changedLines.cpuSeconds} instead of ${summary.wholeFile.cpuSeconds} CPU-seconds. Both runs were executed and timed on the same machine; nothing here is projected.`,
  '',
  '## Aggregate (SCI, R = one merge-request review)',
  '',
  '| | Changed lines (Mutant Review) | Whole changed files |',
  '|---|---:|---:|',
  `| Mutants executed | ${summary.changedLines.mutants} | ${summary.wholeFile.mutants} |`,
  `| CPU time | ${summary.changedLines.cpuSeconds} s | ${summary.wholeFile.cpuSeconds} s |`,
  `| Energy (CPU + memory, PUE ${c.pue}) | ${wh(summary.changedLines.energyWh)} | ${wh(summary.wholeFile.energyWh)} |`,
  `| SCI, all PRs, ${summary.region} (${GRID_REGIONS[summary.region]!.gridIntensity} gCO2e/kWh) | ${formatGrams(summary.changedLines.sciG)} | ${formatGrams(summary.wholeFile.sciG)} |`,
  `| SCI per review (mean) | ${formatGrams(summary.changedLines.sciG / summary.measured)} | ${formatGrams(summary.wholeFile.sciG / summary.measured)} |`,
  '',
  `Machine: ${summary.machine}. GitLab's default hosted runner (\`saas-linux-small-amd64\`) is also 2 vCPU / 8 GB.${summary.environment ? ` ${summary.environment}` : ''}`,
  '',
  summary.projectionErrorPercent === null ? '' : `**Per-MR projection check.** Every MR review projects the whole-file cost from two runs it already makes (the changed-line run and a whole-file dry run). Against the executed whole-file runs here, that projection's median absolute error on CPU time is **${summary.projectionErrorPercent.toFixed(0)}%**.`,
  '',
  ...(modelInput ? [
    '## Model input kept out of the drafting prompt',
    '',
    `The second saving is model input. On ${modelInput.summary.prs} of these PRs (${modelInput.summary.withOpenMutants} with surviving or uncovered mutants), an agent asked to write a test for every surviving mutant would receive **${modelInput.summary.findingsOpen}** findings. Mutant Review's deterministic triage (arid filter, one finding per line, at most three per MR) sends **${modelInput.summary.findingsSent}**, keeping **${modelInput.summary.avoidedPercent.toFixed(0)}%** of the per-finding brief context out of the prompt: ${modelInput.summary.charsAvoided.toLocaleString('en-US')} characters, roughly ${modelInput.summary.tokensAvoidedApprox.toLocaleString('en-US')} tokens at 4 characters per token. Characters are measured by building the brief both ways with the product's own \`findingContext\`; the shared preamble, requirement docs and test-file excerpts are left out of both sides, so the real difference is larger. Source: [\`results/es-toolkit-model-input.json\`](results/es-toolkit-model-input.json) (${modelInput.reports}).`,
    '',
  ] : []),
  '## Per PR',
  '',
  '| PR | Changed lines | Mutants (changed / whole) | CPU-s (changed / whole) | Energy (changed / whole) | Projected whole CPU-s |',
  '|---|---:|---:|---:|---:|---:|',
  ...summary.rows.map((row) => `| [#${row.number}](https://github.com/${summary.repository}/pull/${row.number}) ${row.title.slice(0, 50)} | ${row.changedLines} | ${row.mutants.changed} / ${row.mutants.whole} | ${row.cpuSeconds.changed} / ${row.cpuSeconds.whole} | ${wh(row.energyWh.changed)} / ${wh(row.energyWh.whole)} | ${row.projectedWholeCpuSeconds ?? 'n/a'} |`),
  '',
  failed.length ? `Not measured (${failed.length}): ${failed.map((pr) => `#${pr.number} (${pr.reason ?? pr.status})`).join(', ')}.` : 'Every PR from RESULTS.md was measured.',
  '',
  '## Method',
  '',
  '- **Runs.** Per PR, StrykerJS 10.1.1 with the repository\'s own Vitest config, `coverageAnalysis: perTest`, no incremental cache: (1) the changed-line ranges, (2) the whole changed files as a dry run, (3) the whole changed files with every mutant executed.',
  '- **CPU time** is the user+system time of each Stryker process tree (`cutime + cstime` of `/proc/self/stat` around the run), so it includes every worker and test-runner process.',
  `- **Energy** uses the product's footprint model (\`packages/review-core/src/footprint.ts\`): Cloud Carbon Footprint GCP coefficients, ${c.cpuWattsIdle} W idle to ${c.cpuWattsMax} W busy per vCPU over the reserved vCPUs, ${c.memoryWattsPerGb} W per GB of reserved memory, PUE ${c.pue}. Embodied: ${c.embodiedHostKg} kgCO2e per ${c.hostVcpus}-vCPU host over ${c.lifespanYears} years.`,
  '- **Carbon intensity**: Google Cloud\'s published 2025 location-based grid intensity for us-east1, where GitLab\'s hosted x86 runners run. The SCI specification prefers marginal rates, which are not published for this region.',
  '- **Not included**: dependency installs (identical in both arms), network and storage.',
  '- One run per arm, no repetition; CPU frequency and noisy neighbours add variance.',
];
writeFileSync(join(HERE, 'ENERGY.md'), lines.filter((line, index, all) => line !== '' || all[index - 1] !== '').join('\n') + '\n');
console.log(`ENERGY.md: ${summary.savedPercent}% energy avoided across ${summary.measured} PRs`);
