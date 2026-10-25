import { createHash } from 'node:crypto';
import { filterMutantsToScope, normalizePath } from './scope.js';
import type { Location, MutationMetrics, MutationScope, MutantStatus, NormalizedMutant, Provenance } from './types.js';

export interface StrykerMutant {
  id: string; mutatorName: string; replacement: string; status: string; location: Location;
  coveredBy?: string[]; killedBy?: string[];
}
export interface StrykerReport { files: Record<string, { source: string; mutants: StrykerMutant[] }> }

function sourceSlice(source: string, location: Location): string {
  const lines = source.split('\n');
  // mutation-testing-elements locations use 1-based lines AND columns.
  const start = lines.slice(0, location.start.line - 1).reduce((n, line) => n + line.length + 1, 0) + Math.max(0, location.start.column - 1);
  const end = lines.slice(0, location.end.line - 1).reduce((n, line) => n + line.length + 1, 0) + Math.max(0, location.end.column - 1);
  return source.slice(start, end);
}

export function normalizeStrykerReport(report: StrykerReport, scope: MutationScope[], provenance?: Provenance): NormalizedMutant[] {
  const validStatuses = new Set<MutantStatus>(['Killed', 'Survived', 'NoCoverage', 'Timeout', 'CompileError', 'RuntimeError', 'Ignored', 'Pending']);
  const mutants = Object.entries(report.files).flatMap(([rawPath, file]) => {
    const path = normalizePath(rawPath);
    return file.mutants.map(mutant => {
      const original = sourceSlice(file.source, mutant.location);
      const context = file.source.split('\n').slice(Math.max(0, mutant.location.start.line - 2), mutant.location.end.line + 1).map(s => s.trim()).join('\n');
      const fingerprint = createHash('sha256').update(JSON.stringify({ path, context, original, operator: mutant.mutatorName, replacement: mutant.replacement })).digest('hex');
      return {
        id: String(mutant.id), fingerprint, path, location: mutant.location, original,
        replacement: mutant.replacement, operator: mutant.mutatorName,
        status: validStatuses.has(mutant.status as MutantStatus) ? mutant.status as MutantStatus : 'RuntimeError' as MutantStatus,
        coveredBy: mutant.coveredBy ?? [], killedBy: mutant.killedBy ?? [], provenance,
      };
    });
  });
  // Incremental reports can contain old, out-of-scope mutants. Filter before scoring.
  return filterMutantsToScope(mutants, scope);
}

export function mutationMetrics(mutants: Pick<NormalizedMutant, 'status' | 'assertionKilled'>[]): MutationMetrics {
  const count = (status: MutantStatus) => mutants.filter(m => m.status === status).length;
  const killed = count('Killed'), timedOut = count('Timeout'), survived = count('Survived'), noCoverage = count('NoCoverage');
  const denominator = killed + timedOut + survived + noCoverage;
  return {
    score: denominator ? 100 * (killed + timedOut) / denominator : null,
    killed,
    // Stryker Killed identifies a failing test, not necessarily an assertion failure.
    // Preserve unavailable rather than inventing an assertion-only count.
    assertionKills: mutants.every(mutant => mutant.status !== 'Killed' || typeof mutant.assertionKilled === 'boolean')
      ? mutants.filter(mutant => mutant.status === 'Killed' && mutant.assertionKilled === true).length : null,
    survived, noCoverage, timedOut,
    invalid: count('CompileError') + count('RuntimeError'), ignored: count('Ignored'), pending: count('Pending'), total: mutants.length,
  };
}

export interface GateInput {
  baselinePassed: boolean;
  complete: boolean;
  expectedHeadSha: string;
  evidenceHeadSha: string;
  metrics: MutationMetrics;
  threshold: number;
  actionableSurvivors?: number;
  protectedFilesChanged?: boolean;
  maintainerApprovedPolicy?: boolean;
  /** Changes the target branch's tests noticed that this MR's test changes stopped noticing (protection.ts). */
  lostProtection?: number;
  /** Target-branch kills re-checked at the head. With no changed source, all of them still killed is a real pass. */
  protectionRechecked?: number;
  /** Why the lost-protection check could not finish, when it could not. Fails closed. */
  protectionInconclusive?: string | null;
}
export interface GateDecision { status: 'passed' | 'failed' | 'inconclusive' | 'no-applicable-scope'; reasons: string[] }

export function evaluateGate(input: GateInput): GateDecision {
  const inconclusive: string[] = [];
  if (!input.baselinePassed) inconclusive.push('Inconclusive: the unmodified test suite failed.');
  if (!input.complete) inconclusive.push('Mutation analysis is incomplete.');
  if (!input.evidenceHeadSha || input.expectedHeadSha !== input.evidenceHeadSha) inconclusive.push('Evidence does not match the current source head.');
  if (input.metrics.invalid || input.metrics.pending) inconclusive.push('Mutation execution contains invalid, error, or pending results.');
  if (input.protectedFilesChanged && !input.maintainerApprovedPolicy) inconclusive.push('Authoritative policy or evaluator changed; explicit maintainer review is required.');
  if (!Number.isFinite(input.threshold) || input.threshold < 0 || input.threshold > 100) inconclusive.push('Mutation threshold is invalid.');
  if (input.protectionInconclusive) inconclusive.push(`Lost-protection check: ${input.protectionInconclusive}`);
  if (inconclusive.length) return { status: 'inconclusive', reasons: inconclusive };
  const reasons: string[] = [];
  if (input.lostProtection) reasons.push(`${input.lostProtection} change(s) the target branch's tests noticed are no longer noticed after this MR's test changes (lost protection).`);
  if (input.metrics.score === null) {
    if (reasons.length) return { status: 'failed', reasons };
    if (input.protectionRechecked) return { status: 'passed', reasons: [] };
    return { status: 'no-applicable-scope', reasons: ['No applicable mutants. This is not a passing changed-source assessment.'] };
  }
  if (input.metrics.score < input.threshold) reasons.push(`Mutation score ${input.metrics.score.toFixed(1)}% is below the ${input.threshold}% project policy.`);
  if (input.actionableSurvivors) reasons.push(`${input.actionableSurvivors} actionable surviving finding(s) require repair or an explicit human waiver.`);
  return { status: reasons.length ? 'failed' : 'passed', reasons };
}

export interface GateOverride { actor: string; accessLevel: number; reason: string; noteUrl: string; approvedAt: string; headSha: string }
export interface OverriddenGate { status: 'overridden'; reasons: string[]; override: GateOverride }

/** Only a measured, complete failure can be waived, only by a Maintainer, only with a written reason at this exact head. */
export function applyOverride(decision: GateDecision, override: GateOverride | null, headSha: string): GateDecision | OverriddenGate {
  if (decision.status !== 'failed' || !override) return decision;
  if (override.accessLevel < 40 || override.reason.trim().length < 10 || override.headSha !== headSha) return decision;
  return { status: 'overridden', reasons: [...decision.reasons, `Overridden by @${override.actor}: ${override.reason.trim()}`], override };
}
