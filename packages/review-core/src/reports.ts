/**
 * GitLab-native report artifacts, so findings appear in the merge request without opening a comment:
 *   - Code Quality (artifacts:reports:codequality): each surviving mutant on a changed line becomes a
 *     finding in the MR widget and the diff. Stable fingerprints let GitLab mark it "fixed" once a test kills it.
 *   - Metrics (artifacts:reports:metrics): score, survivors, mutants avoided and footprint, compared with the
 *     target branch in the MR widget.
 * Pure functions; the CLI writes the files.
 */
import type { FootprintReceipt } from './footprint.js';
import type { MutantTriage } from './triage.js';
import type { NormalizedMutant } from './types.js';

export interface CodeQualityIssue {
  description: string;
  check_name: string;
  fingerprint: string;
  severity: 'info' | 'minor' | 'major' | 'critical' | 'blocker';
  location: { path: string; lines: { begin: number } };
}

const oneLine = (code: string, max = 80) => {
  const flat = code.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

/** Surviving and uncovered mutants on changed lines, minus the arid noise triage already dropped. */
export function codeQualityReport(mutants: Pick<NormalizedMutant, 'fingerprint' | 'path' | 'location' | 'original' | 'replacement' | 'operator' | 'status'>[], triage?: Pick<MutantTriage, 'arid' | 'ranked'> | null): CodeQualityIssue[] {
  const arid = new Set(triage?.arid.map((item) => item.fingerprint) ?? []);
  const priority = new Map(triage?.ranked.map((item) => [item.fingerprint, item.priority]) ?? []);
  return mutants
    .filter((mutant) => (mutant.status === 'Survived' || mutant.status === 'NoCoverage') && !arid.has(mutant.fingerprint))
    .map((mutant) => {
      const ranked = priority.get(mutant.fingerprint);
      const severity: CodeQualityIssue['severity'] = mutant.status === 'NoCoverage' || ranked === 'high' ? 'major' : ranked ? 'minor' : 'info';
      const change = `\`${oneLine(mutant.original)}\` → \`${oneLine(mutant.replacement)}\``;
      return {
        description: mutant.status === 'NoCoverage'
          ? `Mutant Review: no test runs this changed line (${change} goes unnoticed).`
          : `Mutant Review: ${change} fails no test. Add a test that would notice this change.`,
        check_name: `mutant-review/${mutant.operator}`,
        fingerprint: mutant.fingerprint.slice(0, 32),
        severity,
        location: { path: mutant.path, lines: { begin: mutant.location.start.line } },
      };
    });
}

export interface MetricsInput {
  score: number | null;
  survived: number;
  noCoverage: number;
  mutantsRun: number;
  mutantsAvoided: number | null;
  aiCallsAvoided: number;
  modelInputTokensAvoided?: number | null;
  footprint?: FootprintReceipt | null;
}

/** GitLab metrics report: one `name value` per line. Names stay stable so the MR widget can diff them. */
export function metricsReport(input: MetricsInput): string {
  const lines: [string, number | null][] = [
    ['mutant_review_changed_line_score_percent', input.score === null ? null : Number(input.score.toFixed(1))],
    ['mutant_review_unnoticed_changes', input.survived + input.noCoverage],
    ['mutant_review_mutants_run', input.mutantsRun],
    ['mutant_review_mutants_avoided', input.mutantsAvoided],
    ['mutant_review_ai_calls_avoided', input.aiCallsAvoided],
    ['mutant_review_model_input_tokens_avoided_approx', input.modelInputTokensAvoided ?? null],
    ['mutant_review_review_cpu_seconds', input.footprint?.actual.cpuSeconds ?? null],
    ['mutant_review_review_energy_mwh', input.footprint ? Number((input.footprint.actual.energyWh * 1000).toFixed(1)) : null],
    ['mutant_review_review_sci_mgco2e', input.footprint ? Number((input.footprint.actual.sciG * 1000).toFixed(1)) : null],
  ];
  return lines.filter(([, value]) => value !== null).map(([name, value]) => `${name} ${value}`).join('\n') + '\n';
}
