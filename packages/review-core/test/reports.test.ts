import { describe, expect, it } from 'vitest';
import { codeQualityReport, metricsReport, footprintReceipt, type NormalizedMutant } from '../src/index.js';

const location = (line: number) => ({ start: { line, column: 5 }, end: { line, column: 9 } });
const mutant = (fingerprint: string, status: NormalizedMutant['status'], line = 4, operator = 'EqualityOperator'): NormalizedMutant =>
  ({ id: fingerprint, fingerprint: fingerprint.repeat(64), path: 'src/shipping.ts', location: location(line), original: 'subtotal >= 10_000', replacement: 'subtotal > 10_000', operator, status, coveredBy: [], killedBy: [] });

describe('GitLab Code Quality report', () => {
  it('lists unnoticed changes on their line with a stable fingerprint, and skips killed and arid mutants', () => {
    const mutants = [mutant('a', 'Survived'), mutant('b', 'Killed'), mutant('c', 'Survived', 9, 'StringLiteral'), mutant('d', 'NoCoverage', 12)];
    const triage = { arid: [{ fingerprint: 'c'.repeat(64), path: 'src/shipping.ts', line: 9, reason: 'error message text' }], ranked: [{ fingerprint: 'a'.repeat(64), priority: 'high' as const }] };
    const issues = codeQualityReport(mutants, triage as never);
    expect(issues).toEqual([
      { description: 'Mutant Review: `subtotal >= 10_000` → `subtotal > 10_000` fails no test. Add a test that would notice this change.', check_name: 'mutant-review/EqualityOperator', fingerprint: 'a'.repeat(32), severity: 'major', location: { path: 'src/shipping.ts', lines: { begin: 4 } } },
      { description: 'Mutant Review: no test runs this changed line (`subtotal >= 10_000` → `subtotal > 10_000` goes unnoticed).', check_name: 'mutant-review/EqualityOperator', fingerprint: 'd'.repeat(32), severity: 'major', location: { path: 'src/shipping.ts', lines: { begin: 12 } } },
    ]);
  });
  it('marks survivors outside the ranked three as informational', () => {
    expect(codeQualityReport([mutant('e', 'Survived')], { arid: [], ranked: [] })[0]!.severity).toBe('info');
  });
  it('keeps one-line, bounded descriptions', () => {
    const long = { ...mutant('f', 'Survived'), original: 'a\n  '.repeat(60), replacement: '{}' };
    expect(codeQualityReport([long])[0]!.description).not.toContain('\n');
    expect(codeQualityReport([long])[0]!.description.length).toBeLessThan(200);
  });
});

describe('GitLab metrics report', () => {
  it('writes stable names and drops unknown values', () => {
    expect(metricsReport({ score: 75, survived: 1, noCoverage: 0, mutantsRun: 4, mutantsAvoided: null, aiCallsAvoided: 0 })).toBe(
      'mutant_review_changed_line_score_percent 75\nmutant_review_unnoticed_changes 1\nmutant_review_mutants_run 4\nmutant_review_ai_calls_avoided 0\n');
  });
  it('includes the measured footprint of the review', () => {
    const usage = { wallMs: 60_000, cpuMs: 60_000, vCpus: 2, memoryGb: 8 };
    const footprint = footprintReceipt({ review: [usage], changedLinesRun: null, wholeFileDryRun: null, changedMutants: 0, wholeFileMutants: null, env: {} });
    const text = metricsReport({ score: null, survived: 0, noCoverage: 0, mutantsRun: 0, mutantsAvoided: 0, aiCallsAvoided: 0, footprint });
    expect(text).not.toContain('score');
    expect(text).toMatch(/^mutant_review_review_cpu_seconds 60$/m);
    expect(text).toMatch(/^mutant_review_review_energy_mwh \d+(\.\d)?$/m);
    expect(text).toMatch(/^mutant_review_review_sci_mgco2e \d+(\.\d)?$/m);
  });
});
