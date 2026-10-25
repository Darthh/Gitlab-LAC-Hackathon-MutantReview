import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateEvidence } from './evidence-validation.js';
import { footprintReceipt } from '../../../packages/review-core/src/footprint.js';

// A captured actual engine run makes these parser tests work before a fresh demo run.
// The application never serves this fixture; assertions mutate only trust boundaries.
const measured = JSON.parse(readFileSync(new URL('./fixtures/local-run.json', import.meta.url), 'utf8'));
const copy = () => structuredClone(measured);

describe('Front Desk evidence validation', () => {
  it('accepts real local execution and preserves exact measured counts', () => {
    const evidence = validateEvidence(measured, { source: 'local' });
    expect(evidence.mutation.counts.survived).toBeGreaterThan(0);
    expect(evidence.mutation.score).toBe(80);
    expect(evidence.findings[0]!.proposal.patchHash).toHaveLength(64);
  });
  it('strips unrecognized fields before the artifact reaches the browser', () => {
    expect(validateEvidence({ ...copy(), internalCredential: 'never-return-this' })).not.toHaveProperty('internalCredential');
  });
  it('rejects malformed nested structures with a safe, fixed error', () => {
    const value = copy(); value.mutation.counts = null;
    expect(() => validateEvidence(value)).toThrow('Evidence format is unsupported or malformed. Regenerate the run.');
  });
  it('explains validated failed attempts without accepting them as successful evidence', () => {
    const failure = { schemaVersion: 1, kind: 'review-error', status: 'inconclusive', createdAt: '2026-10-25T12:00:00Z', log: 'evidence/error.json' };
    expect(() => validateEvidence(failure)).toThrow('Evidence rejected: the last review did not complete. Check evidence/error.json on the server, then run the review again.');
    for (const invalid of [{ ...failure, status: 'passed' }, { ...failure, log: '../private.log' }, { ...failure, createdAt: 'yesterday' }, { ...failure, message: 'private detail' }, { ...failure, triage: measured.triage }]) {
      expect(() => validateEvidence(invalid)).toThrow('Evidence format is unsupported or malformed. Regenerate the run.');
    }
  });
  it('rejects another project, revision, MR, source, or job', () => {
    for (const expected of [{ projectId: '999' }, { headSha: 'f'.repeat(40) }, { mergeRequestIid: 99 }, { source: 'gitlab' as const }, { jobId: '999' }]) {
      expect(() => validateEvidence(measured, expected)).toThrow('Evidence rejected');
    }
  });
  it('rejects fabricated raw counts and scores', () => {
    const counts = copy(); counts.mutation.counts.killed += 100;
    expect(() => validateEvidence(counts)).toThrow('mutation counts');
    const score = copy(); score.mutation.score = 100;
    expect(() => validateEvidence(score)).toThrow('mutation score');
  });
  it('rejects cached out-of-scope mutants', () => {
    const value = copy(); value.mutation.mutants[0].location.start.line = 200; value.mutation.mutants[0].location.end.line = 201;
    expect(() => validateEvidence(value)).toThrow('outside the recorded source scope');
  });
  it('rejects unknown finding references and changed visible patches', () => {
    const unknown = copy(); unknown.findings[0].mutantFingerprint = 'f'.repeat(64);
    expect(() => validateEvidence(unknown)).toThrow('unknown mutation');
    const changed = copy(); changed.findings[0].proposal.patch += '\n';
    expect(() => validateEvidence(changed)).toThrow('visible proposal patch');
  });
  it('rejects a clean gate or complete analysis with a failed baseline', () => {
    const value = copy(); value.baseline.status = 'failed'; value.gate.status = 'passed';
    expect(() => validateEvidence(value)).toThrow('failed execution');
  });
  it('rejects a purported proof with missing assertion execution', () => {
    const value = copy(); value.verification.runs[0].assertionKilled = false;
    expect(() => validateEvidence(value)).toThrow('reproducible assertion-failure');
  });
});

describe('triage and savings', () => {
  it('passes triage and savings through, and still accepts older runs without them', () => {
    const evidence = validateEvidence(measured);
    expect(evidence.triage!.ranked[0]!.fingerprint).toBe(evidence.findings[0]!.mutantFingerprint);
    expect(evidence.savings!.mutantsAvoided).toBeNull();
    const older = copy(); delete older.triage; delete older.savings;
    expect(validateEvidence(older)).not.toHaveProperty('triage');
  });
  it('accepts measured whole-file savings that add up', () => {
    const value = copy(); value.savings.mutantsWholeFiles = 40; value.savings.mutantsAvoided = 35;
    expect(validateEvidence(value).savings!.mutantsAvoided).toBe(35);
  });
  it('rejects negative counts and more than three ranked findings', () => {
    const negative = copy(); negative.savings.aridFiltered = -1;
    expect(() => validateEvidence(negative)).toThrow('Evidence format');
    const four = copy(); four.triage.ranked = [1, 2, 3, 4].map(rank => ({ ...four.triage.ranked[0], rank: Math.min(rank, 3) }));
    expect(() => validateEvidence(four)).toThrow('Evidence format');
  });
  it('rejects triage that points at unknown, killed, or misplaced mutants', () => {
    const unknown = copy(); unknown.triage.ranked[0].fingerprint = 'f'.repeat(64);
    expect(() => validateEvidence(unknown)).toThrow('triage references');
    const killed = copy(); killed.triage.arid.push({ fingerprint: killed.mutation.mutants[0].fingerprint, path: killed.mutation.mutants[0].path, line: 3, reason: 'log string' });
    expect(() => validateEvidence(killed)).toThrow('triage references');
    const moved = copy(); moved.triage.ranked[0].line = 5;
    expect(() => validateEvidence(moved)).toThrow('triage references');
    const status = copy(); status.triage.ranked[0].status = 'NoCoverage';
    expect(() => validateEvidence(status)).toThrow('ranked findings');
  });
  it('rejects triage counts larger than the surviving inventory', () => {
    const value = copy(); value.triage.overflow = 5;
    expect(() => validateEvidence(value)).toThrow('triage counts');
  });
  it('rejects savings that do not add up or contradict the triage record', () => {
    const halfMeasured = copy(); halfMeasured.savings.mutantsWholeFiles = 40;
    expect(() => validateEvidence(halfMeasured)).toThrow('avoided mutants');
    const inflated = copy(); inflated.savings.mutantsWholeFiles = 40; inflated.savings.mutantsAvoided = 40;
    expect(() => validateEvidence(inflated)).toThrow('avoided mutants');
    const calls = copy(); calls.savings.aiCallsAvoided = 7;
    expect(() => validateEvidence(calls)).toThrow('savings do not match');
  });
  it('accepts measured model-input savings and rejects ones that do not add up', () => {
    const input = { findingsSent: 1, findingsOpen: 1, charsSent: 600, charsOpen: 600, charsAvoided: 0, tokensAvoidedApprox: 0 };
    const value = copy(); value.savings.modelInput = input;
    expect(validateEvidence(value).savings!.modelInput).toEqual(input);
    const inflated = copy(); inflated.savings.modelInput = { ...input, charsOpen: 4000, charsAvoided: 3400, tokensAvoidedApprox: 9000 };
    expect(() => validateEvidence(inflated)).toThrow('model input');
    const phantom = copy(); phantom.savings.modelInput = { ...input, findingsOpen: 40 };
    expect(() => validateEvidence(phantom)).toThrow('model input');
  });
});

describe('footprint', () => {
  const dry = { wallMs: 4_000, cpuMs: 3_000, vCpus: 2, memoryGb: 8 };
  const scoped = { wallMs: 6_000, cpuMs: 7_000, vCpus: 2, memoryGb: 8 };
  const withFootprint = (wholeFileMutants = 40) => {
    const value = copy();
    value.savings.mutantsWholeFiles = wholeFileMutants; value.savings.mutantsAvoided = wholeFileMutants - 5;
    value.footprint = footprintReceipt({ review: [{ ...scoped, step: 'Stryker on changed lines' }, { ...dry, step: 'Whole-file mutant count' }], changedLinesRun: scoped, wholeFileDryRun: dry, changedMutants: 5, wholeFileMutants, env: {} });
    return value;
  };
  it('passes a measured receipt through, and accepts runs without one', () => {
    const evidence = validateEvidence(withFootprint());
    expect(evidence.footprint!.functionalUnit).toBe('one merge-request review');
    expect(evidence.footprint!.projectedWholeFile!.mutants).toBe(40);
    expect(evidence.footprint!.savedPercent).toBeGreaterThan(0);
    expect(validateEvidence(measured)).not.toHaveProperty('footprint');
  });
  it('rejects receipts that do not add up or disagree with the inventory', () => {
    const sum = withFootprint(); sum.footprint.actual.sciG += 1;
    expect(() => validateEvidence(sum)).toThrow(/footprint (steps )?do(es)? not add up/);
    const parts = withFootprint(); delete parts.footprint.steps; parts.footprint.actual.embodiedG += 1;
    expect(() => validateEvidence(parts)).toThrow('footprint does not add up');
    const count = withFootprint(); count.footprint.changedLinesRun.mutants = 4;
    expect(() => validateEvidence(count)).toThrow('footprint mutant count');
    const whole = withFootprint(); whole.footprint.projectedWholeFile.mutants = 80;
    expect(() => validateEvidence(whole)).toThrow('footprint projection');
    const claim = withFootprint(); claim.footprint.projectedWholeFile = null;
    expect(() => validateEvidence(claim)).toThrow('saving has no projection');
    const steps = withFootprint(); steps.footprint.steps[0].sciG += 1;
    expect(() => validateEvidence(steps)).toThrow('footprint steps');
    const calls = withFootprint(); calls.footprint.modelCalls.avoided = 3;
    expect(() => validateEvidence(calls)).toThrow('model calls');
  });
  it('rejects a saving larger than the projection', () => {
    const value = withFootprint(); value.footprint.savedPercent = 140;
    expect(() => validateEvidence(value)).toThrow('Evidence format');
  });
});

describe('lost protection', () => {
  const lost = {
    fingerprint: 'a'.repeat(64), path: 'packages/demo-domain/src/shipping.ts', line: 4, baseLine: 4,
    location: { start: { line: 4, column: 10 }, end: { line: 4, column: 33 } }, operator: 'EqualityOperator',
    original: 'subtotalCents >= 10_000', replacement: 'subtotalCents > 10_000', status: 'Survived',
    caughtBy: [{ id: '2', name: 'ships free at exactly $100 (SHIPPING-001)', file: 'packages/demo-domain/src/shipping.test.ts', line: 14, failure: 'expected 500 to be +0', fate: 'weakened' }],
    testDiff: { file: 'packages/demo-domain/src/shipping.test.ts', name: 'ships free at exactly $100 (SHIPPING-001)', lines: [{ kind: '-', text: '  expect(shippingFee(10_000)).toBe(0);' }, { kind: '+', text: '  expect(shippingFee(10_000)).toBeLessThanOrEqual(500);' }] },
    why: 'On the target branch, the test failed when >= became >.',
  };
  const scenario = () => ({ status: 'lost', reason: '1 change', scenario: 'Demonstration fixture', changedTests: [{ path: 'packages/demo-domain/src/shipping.test.ts', change: 'modified', headPath: 'packages/demo-domain/src/shipping.test.ts' }],
    testsInRun: ['packages/demo-domain/src/shipping.test.ts'], subjects: ['packages/demo-domain/src/shipping.ts'], baseMutants: 5, guarded: 5, onChangedLines: 0, rechecked: 5, held: 4, unknown: 0, lost: [lost], cost: { cpuSeconds: 12.4, energyWh: 0.03, sciG: 0.02 } });
  it('accepts the demo scenario and keeps the before/after test', () => {
    const value = copy(); value.protection = scenario();
    expect(validateEvidence(value).protection!.lost[0]!.testDiff!.lines).toHaveLength(2);
  });
  it('rejects a verdict that does not match its counts', () => {
    const held = copy(); held.protection = { ...scenario(), status: 'held' };
    expect(() => validateEvidence(held)).toThrow('protection verdict');
    const short = copy(); short.protection = { ...scenario(), held: 2 };
    expect(() => validateEvidence(short)).toThrow('protection verdict');
  });
  it('rejects a passing gate over lost protection, and a demo scenario passed off as a merge request', () => {
    const passing = copy(); passing.protection = { ...scenario(), scenario: undefined }; passing.gate = { status: 'passed', reasons: [] };
    expect(() => validateEvidence(passing)).toThrow('ignores lost protection');
    const gitlab = copy(); gitlab.protection = scenario(); gitlab.source = 'gitlab';
    Object.assign(gitlab.provenance, { projectId: '1', mrIid: 1, baseSha: 'b'.repeat(40), pipelineId: '1', jobId: '1' });
    expect(() => validateEvidence(gitlab)).toThrow('demonstration scenario');
  });
});
