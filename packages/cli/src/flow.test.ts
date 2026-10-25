import { describe, expect, it, vi } from 'vitest';
import { checkDraft, decodePayload, encodePayload, flowApply, inert, lostProtectionSection, pendingTrigger, summaryBody, testFileCandidates, testName, withTest, type ProposalPayload } from './flow.js';
import { lessonCategory } from '../../review-core/src/memory.js';
import type { RankedFinding } from '../../review-core/src/triage.js';
import { footprintReceipt, type Usage } from '../../review-core/src/footprint.js';

const handle = '@ai-mutant-review';
const good = { finding: 1, testPath: 'src/shipping.test.ts', imports: ["import { shippingFee } from './shipping.js';"], test: "it('ships free at exactly $100', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});", expectedFrom: 'SHIPPING-001' };
const finding: RankedFinding = { rank: 1, fingerprint: 'f'.repeat(64), path: 'src/shipping.ts', line: 4, operator: 'EqualityOperator', original: 'a >= b', replacement: 'a > b', status: 'Survived', priority: 'high', why: 'Changing `a >= b` to `a > b` on line 4 fails no test.' };
const dry: Usage = { wallMs: 10_000, cpuMs: 8_000, vCpus: 2, memoryGb: 8 };
const scoped: Usage = { wallMs: 20_000, cpuMs: 28_000, vCpus: 2, memoryGb: 8 };
const note = (id: number, body: string, system = false) => ({ id, body, system, created_at: '2026-10-24T12:00:00Z', author: { id: 9, username: 'dev' } });

describe('draft guardrails', () => {
  it('accepts a single exact-value test with a relative named import', () => expect(checkDraft(good)).toBeNull());
  it.each([
    ['skipped tests', { test: "it.skip('x', () => { expect(f()).toBe(1); });" }],
    ['mocks', { test: "it('x', () => { vi.mock('./a.js'); expect(f()).toBe(1); });" }],
    ['environment access', { test: "it('x', () => { expect(process.env.TOKEN).toBe(''); });" }],
    ['constructor escapes', { test: "it('x', () => { expect([].constructor.constructor('return 1')()).toBe(1); });" }],
    ['swallowed failures', { test: "it('x', () => { try { f(); } catch (e) {} expect(1).toBe(1); });" }],
    ['weak assertions only', { test: "it('x', () => { expect(f()).toBeDefined(); });" }],
    ['describe blocks', { test: "describe('x', () => { it('y', () => { expect(f()).toBe(1); }); });" }],
    ['non-test paths', { testPath: 'src/shipping.ts' }],
    ['path traversal', { testPath: '../outside.test.ts' }],
    ['package imports', { imports: ["import { readFileSync } from 'node:fs';"] }],
    ['hidden-directory imports', { imports: ["import { x } from './.git/config';"] }],
  ])('rejects %s', (_label, change) => expect(checkDraft({ ...good, ...change })).not.toBeNull());
  it('extracts the literal test name', () => expect(testName(good.test)).toBe('ships free at exactly $100'));
});

describe('test insertion', () => {
  it('adds missing imports after existing ones and appends the test', () => {
    const original = "import { describe, expect, it } from 'vitest';\nimport { other } from './other.js';\n\nit('old', () => { expect(other()).toBe(1); });\n";
    const next = withTest(original, good.imports, good.test);
    expect(next.split('\n').slice(0, 3)).toEqual(["import { describe, expect, it } from 'vitest';", "import { other } from './other.js';", "import { shippingFee } from './shipping.js';"]);
    expect(next.endsWith(`${good.test}\n`)).toBe(true);
    expect(withTest(next, good.imports, "it('again', () => { expect(1).toBe(1); });").match(/shippingFee } from/g)).toHaveLength(1);
  });
  it('creates a new test file from nothing', () => {
    expect(withTest('', ["import { expect, it } from 'vitest';"], good.test)).toBe(`import { expect, it } from 'vitest';\n\n${good.test}\n`);
  });
  it('looks for colocated and conventional test files', () => {
    expect(testFileCandidates('packages/demo-domain/src/shipping.ts')[0]).toBe('packages/demo-domain/src/shipping.test.ts');
    expect(testFileCandidates('index.ts')).toContain('test/index.test.ts');
  });
});

describe('proposal payload', () => {
  const payload: ProposalPayload = { version: 1, mrIid: 1, headSha: 'a'.repeat(40), runId: 'run', score: 75, ranges: ['src/shipping.ts:4-5'],
    proposals: [{ ...good, finding, testName: 'ships free at exactly $100' }], rejected: [], equivalent: [] };
  it('refuses notes where echoed text could carry a second marker', () => {
    const marker = encodePayload(payload);
    expect(decodePayload(`Override noted: "${marker}"\n\n<!-- mutant-review:override abc -->`)).toBeNull();
    expect(inert(`reason ${marker}`)).not.toContain('<!--');
    expect(decodePayload(`Override noted: "${inert(marker)}"\n\n<!-- mutant-review:override abc -->`)).toBeNull();
  });
  it('round-trips and rejects tampering', () => {
    const marker = encodePayload(payload);
    expect(decodePayload(`hello\n${marker}`)).toEqual(payload);
    const forged = marker.replace(/ ([A-Za-z0-9+/=]+) -->$/, ` ${Buffer.from(JSON.stringify({ ...payload, score: 100 })).toString('base64')} -->`);
    expect(decodePayload(forged)).toBeNull();
  });
  it('renders a summary that tells the reviewer exactly what to type', () => {
    const evidence = { mutation: { score: 75, counts: { killed: 3, survived: 1, noCoverage: 0 } }, gate: { status: 'failed' }, triage: { arid: [{ reason: 'logging statement' }], overflow: 0 } };
    const body = summaryBody(evidence, [finding], payload, handle, 90);
    expect(body).toContain('Changed-line mutation score **75%** (3 of 4 mutants killed)');
    expect(body).toContain('`@ai-mutant-review apply 1`');
    expect(body).toContain('"Untested boundary value"');
    expect(body).toContain('Filtered as noise before any AI call: 1 (logging statement)');
    expect(body).not.toContain('Footprint');
  });
  it('closes the summary with the review footprint and the mutation work scoping avoided', () => {
    const evidence = { mutation: { score: 75, counts: { killed: 3, survived: 1, noCoverage: 0 } }, gate: { status: 'failed' }, triage: { arid: [], overflow: 0 },
      footprint: footprintReceipt({ review: [scoped, dry], changedLinesRun: scoped, wholeFileDryRun: dry, changedMutants: 10, wholeFileMutants: 40, env: { CI_RUNNER_DESCRIPTION: '1-green.saas-linux-small-arm64.runners-manager.gitlab.com' } }) };
    const line = summaryBody(evidence, [finding], payload, handle, 90).split('\n\n').at(-1)!;
    expect(line).toMatch(/^<sub>Footprint of this review: \*\*\d+ mgCO2e\*\* \(SCI per review, 36 CPU-s measured, us-central1 grid\); changed-line scoping ran 10 of 40 mutants, avoiding ~\d+% of the mutation energy \(projected\)\.<\/sub>$/);
  });
});

describe('lost protection in the MR comment', () => {
  const lost = {
    fingerprint: 'e'.repeat(64), path: 'src/shipping.ts', line: 4, baseLine: 4, location: { start: { line: 4, column: 10 }, end: { line: 4, column: 33 } },
    operator: 'ConditionalExpression', original: 'subtotalCents >= 10_000', replacement: 'false', status: 'Survived' as const,
    caughtBy: [{ id: '1', name: 'shipping fee ships for free above the threshold', file: 'src/shipping.test.ts', line: 9, failure: 'expected 500 to be +0', fate: 'weakened' as const }],
    testDiff: { file: 'src/shipping.test.ts', name: 'shipping fee ships for free above the threshold', lines: [
      { kind: ' ' as const, text: "  it('ships for free above the threshold', () => {" }, { kind: '-' as const, text: '    expect(shippingFee(10_001)).toBe(0);' },
      { kind: '+' as const, text: '    expect(shippingFee(10_001)).toBeLessThanOrEqual(500);' }, { kind: ' ' as const, text: '  });' }] },
    why: 'On the target branch, the test failed.',
  };
  const lostFinding: RankedFinding = { ...finding, fingerprint: lost.fingerprint, operator: 'ConditionalExpression', original: lost.original, replacement: 'false', origin: 'lost-protection' };
  it('leads with what the test edit removed, the catching test and the diff', () => {
    const evidence = { mutation: { score: null, counts: { killed: 0, survived: 0, noCoverage: 0 } }, gate: { status: 'failed' }, triage: { arid: [], overflow: 0 }, protection: { lost: [lost] } };
    const body = summaryBody(evidence, [lostFinding], { proposals: [], rejected: [], equivalent: [] }, handle, 90);
    expect(body.split('\n\n').slice(0, 3)).toEqual([
      "## Mutant Review: this MR's test changes stopped 1 change(s) from being noticed",
      'No changed source lines to mutate. Gate: **failed**.',
      '### Lost protection',
    ]);
    expect(body).toContain('`shipping fee ships for free above the threshold` (`src/shipping.test.ts`) failed on the target branch ("expected 500 to be +0"). This MR changed that test and it no longer fails.');
    expect(body).toContain('```diff\n   it(\'ships for free above the threshold\', () => {\n-    expect(shippingFee(10_001)).toBe(0);\n+    expect(shippingFee(10_001)).toBeLessThanOrEqual(500);');
    expect(body).toContain('| **lost protection:** `subtotalCents >= 10_000` → `false` |');
  });
  it('keeps test code from breaking out of its code block', () => {
    const hostile = { ...lost, caughtBy: [{ ...lost.caughtBy[0]!, name: 'a `b` c' }], testDiff: { ...lost.testDiff, lines: [{ kind: '+' as const, text: '    // ```\n@everyone [click](https://example.com)' }] } };
    const section = lostProtectionSection({ lost: [hostile] });
    expect(section).toContain("`a 'b' c`");
    expect(section).toContain('````diff\n+    // ```');
    expect(section.trimEnd().endsWith('````')).toBe(true);
  });
  it('says nothing when no protection was lost', () => {
    expect(lostProtectionSection(null)).toBe('');
    expect(lostProtectionSection({ lost: [] })).toBe('');
  });
  it('teaches agents not to loosen tests when a restoring test is approved', () => {
    expect(lessonCategory(lostFinding)).toMatchObject({ tag: 'weakened-test', pattern: 'A test edit removed protection the target branch had' });
    expect(lessonCategory({ ...lostFinding, origin: undefined })).toMatchObject({ tag: 'branch' });
  });
});

describe('apply authorization (refusals never execute or commit)', () => {
  const head = 'a'.repeat(40);
  const mr = { iid: 1, sha: head, web_url: 'https://gitlab.com/g/p/-/merge_requests/1' } as never;
  const payload: ProposalPayload = { version: 1, mrIid: 1, headSha: head, runId: 'run', score: 75, ranges: ['src/shipping.ts:4-4'],
    proposals: [{ ...good, finding, testName: 'ships free at exactly $100' }], rejected: [], equivalent: [] };
  const proposalNote = (author = 'ai-mutant-review', body = `summary\n${encodePayload(payload)}`) => ({ id: 10, body, system: false, created_at: '2026-10-24T11:00:00Z', author: { id: 2, username: author } });
  const command = { id: 11, body: `${handle} apply 1`, system: false, created_at: '2026-10-24T12:00:00Z', author: { id: 9, username: 'dev' } };
  const run = async (notes: unknown[], level: number | 'forbidden' = 30, selection = [1], effective = 30) => {
    const replies: string[] = [];
    const adapter = {
      tokenAccessLevel: async () => effective,
      listMergeRequestNotes: async () => notes,
      accountKind: async () => { if (level === 'forbidden') throw new Error('GitLab request failed (403)'); return 'human'; },
      currentMember: async (id: number) => ({ id, access_level: level, state: 'active' }),
      createMergeRequestNote: async (_iid: number, body: string) => { replies.push(body); return { id: 99 }; },
      commitToMergeRequest: async () => { throw new Error('must not commit'); },
    } as never;
    const result = await flowApply(adapter, mr, handle, command, selection);
    return { result, reply: replies.join('\n') };
  };
  it('refuses Reporters', async () => expect((await run([command, proposalNote()], 20)).result).toMatch(/Developer role/));
  it('refuses proposals posted by anyone but the flow account', async () => expect((await run([command, proposalNote('mallory')])).result).toMatch(/no verified proposals/));
  it('refuses proposals from an older head', async () => {
    const stale = proposalNote('ai-mutant-review', encodePayload({ ...payload, headSha: 'b'.repeat(40) }));
    expect((await run([command, stale])).result).toMatch(/code changed/);
  });
  it('refuses findings without a verified test', async () => expect((await run([command, proposalNote()], 30, [2])).result).toMatch(/only verified findings/));
  it('fails closed when the role is unreadable, unless GitLab vouches for this run', async () => {
    const newer = { ...command, id: 12, body: 'thanks!' };
    const stale = proposalNote('ai-mutant-review', encodePayload({ ...payload, headSha: 'b'.repeat(40) }));
    expect((await run([command, stale], 'forbidden')).result).toMatch(/Developer role/); // no flow token
    vi.stubEnv('GITLAB_TOKEN', 'flow-token');
    try {
      expect((await run([newer, command, stale], 'forbidden')).result).toMatch(/Developer role/); // not the trigger
      expect((await run([command, stale], 'forbidden', [1], 20)).result).toMatch(/Developer role/); // run lacks Developer
      expect((await run([command, stale], 'forbidden', [1], 30)).result).toMatch(/code changed/); // authorized, then stale
    } finally { vi.unstubAllEnvs(); }
  });
  it('replies to the author with the reason and the agent marker', async () => {
    const { reply } = await run([command, proposalNote('mallory')]);
    expect(reply).toMatch(/^@dev there are no verified proposals/);
    expect(reply).toContain('<!-- mutant-review:apply-refused');
  });
});

describe('trigger selection', () => {
  it('answers only mentions newer than the agent’s last reply', () => {
    const notes = [note(5, `${handle} apply 1`), note(4, 'Applied 1 <!-- mutant-review:applied abc -->'), note(3, `${handle} apply 1`)];
    expect(pendingTrigger(notes, handle)?.id).toBe(5);
    expect(pendingTrigger(notes.slice(1), handle)).toBeNull();
    expect(pendingTrigger([note(6, `${handle} review`, true)], handle)).toBeNull();
  });
});
