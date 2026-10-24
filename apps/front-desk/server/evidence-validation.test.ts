import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { gitlabOrigin, readBoundedText, validateEvidence } from './evidence-validation.js';

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
  it('does not count unapproved or unverified lesson suggestions', () => {
    const value = copy(); value.lessons.push({ id: 'suggestion', status: 'draft' });
    expect(() => validateEvidence(value)).toThrow('Evidence format');
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
});

describe('configured GitLab links', () => {
  it('accepts a plain HTTPS origin', () => expect(gitlabOrigin('https://gitlab.com/')).toBe('https://gitlab.com'));
  it.each(['http://gitlab.com', 'https://token@gitlab.com', 'https://gitlab.com/group', 'https://gitlab.com/?token=secret', 'https://gitlab.com/#fragment'])('rejects URL settings that can disclose credentials or change the API target: %s', value => expect(() => gitlabOrigin(value)).toThrow());
});

describe('artifact transfer budget', () => {
  it('decodes a bounded UTF-8 body and rejects oversized declared or streamed bytes', async () => {
    expect(await readBoundedText(new Response('execution evidence'), 100)).toBe('execution evidence');
    await expect(readBoundedText(new Response('x', { headers: { 'content-length': '1000' } }), 100)).rejects.toThrow('Evidence exceeds');
    await expect(readBoundedText(new Response('x'.repeat(101)), 100)).rejects.toThrow('Evidence exceeds');
  });
});
