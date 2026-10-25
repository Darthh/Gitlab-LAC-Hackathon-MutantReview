import { createHash } from 'node:crypto';
import { access, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, posix } from 'node:path';
import { z } from 'zod';
import { GitLabAdapter, type MergeRequest } from '../../gitlab-adapter/src/index.js';
import { parseReviewCommand, type ReviewCommand } from '../../review-core/src/approval.js';
import { formatGrams, type FootprintReceipt } from '../../review-core/src/footprint.js';
import { mutationMetrics, normalizeStrykerReport, type GateOverride } from '../../review-core/src/report.js';
import { learnFromRepair, lessonCategory, updateAgentsMd, type MemoryLesson } from '../../review-core/src/memory.js';
import { filterMutantsToScope, normalizePath } from '../../review-core/src/scope.js';
import type { ProtectionResult } from '../../review-core/src/protection.js';
import { findingContext, type RankedFinding } from '../../review-core/src/triage.js';
import type { MutationScope } from '../../review-core/src/types.js';
import { execute } from './runner.js';
import { git, json, protectedPath, runReview, runStryker, save } from './review.js';

const WORK = '.mutant-review/work';
const MARK = '<!-- mutant-review:';
const PAYLOAD = /<!-- mutant-review:proposals:v1 sha256=([a-f0-9]{64}) ([A-Za-z0-9+/=]+) -->/;
type Note = Awaited<ReturnType<GitLabAdapter['listMergeRequestNotes']>>[number];

// ---------- Pure helpers (unit-tested) ----------

export const draftTestSchema = z.object({
  finding: z.number().int().min(1).max(3),
  testPath: z.string().min(1).max(300),
  imports: z.array(z.string().max(300)).max(5).default([]),
  test: z.string().min(10).max(4000),
  expectedFrom: z.string().max(500).default(''),
}).strict();
export const draftSchema = z.object({
  proposals: z.array(draftTestSchema).max(3).default([]),
  equivalent: z.array(z.object({ finding: z.number().int().min(1).max(3), reason: z.string().min(1).max(1000) }).strict()).max(3).default([]),
}).strict();
export type Draft = z.infer<typeof draftSchema>['proposals'][number];

export interface VerifiedProposal extends Omit<Draft, 'finding'> { finding: RankedFinding; testName: string }
export interface RejectedProposal { finding: RankedFinding; testPath: string; testName: string; reason: string }
export interface ProposalPayload {
  version: 1; mrIid: number; headSha: string; runId: string; score: number | null; ranges: string[];
  /** Lines of lost-protection findings: re-run after apply, but not part of the changed-line score. */
  protectionRanges?: string[];
  proposals: VerifiedProposal[]; rejected: RejectedProposal[]; equivalent: { finding: RankedFinding; reason: string }[];
}

const IMPORT = /^import\s+(?:type\s+)?\{[\w\s,$]+\}\s+from\s+['"](?:(?:\.\.?\/)+(?:[\w-][\w.-]*\/)*[\w-][\w.-]*|vitest)['"];?$/;
// Defence in depth only. The real boundary: drafts run in child processes with credentials
// stripped from the environment (runner.executionEnvironment) inside the Duo sandbox.
const FORBIDDEN = /\.(?:skip|only|todo|fails)\b|\b(?:xit|xtest|xdescribe)\b|\b(?:vi|jest)\s*\.\s*(?:mock|spyOn|stubGlobal|stubEnv)\b|@ts-(?:ignore|nocheck|expect-error)|\b(?:process|require|eval|fetch|globalThis|child_process|Function|constructor|prototype|__proto__|Reflect|Proxy|WebAssembly|XMLHttpRequest|WebSocket)\b|\bimport\s*\(|\bimport\.meta\b|\bcatch\s*[({]/;
const STRONG = /\bexpect\s*\([\s\S]*?\)\s*\.\s*(?:toBe|toEqual|toStrictEqual|toThrow|toThrowError|toMatch|toBeCloseTo|toHaveLength|toContain)\s*\(/;

export function testName(test: string): string | null {
  return /^\s*(?:it|test)\s*\(\s*(['"`])((?:(?!\1)[^\\\n]|\\.){1,200})\1/.exec(test)?.[2] ?? null;
}

/** Static guardrails before execution. Execution (pass on original, fail on mutant) is the real check. */
export function checkDraft(draft: Draft): string | null {
  let path: string;
  try { path = normalizePath(draft.testPath); } catch { return 'unsafe test path'; }
  if (path !== draft.testPath || !/\.(?:test|spec)\.tsx?$/.test(path) || /(^|\/)node_modules\//.test(path)) return 'test path must be a .test.ts or .spec.ts file in the repository';
  if (!testName(draft.test)) return 'test must be a single it(...) or test(...) block with a literal name';
  if (draft.imports.some((line) => !IMPORT.test(line.trim()))) return 'only named imports from relative modules or vitest are allowed';
  if (FORBIDDEN.test(draft.test)) return 'test uses a disabled, mocked, swallowed or environment-dependent construct';
  if (!STRONG.test(draft.test)) return 'test has no exact-value assertion';
  return null;
}

export function withTest(original: string, imports: string[], test: string): string {
  const lines = original.split('\n');
  const missing = imports.map((line) => line.trim().replace(/;?$/, ';')).filter((line) => !original.includes(line));
  let lastImport = -1;
  lines.forEach((line, index) => { if (/^import\s/.test(line)) lastImport = index; });
  lines.splice(lastImport + 1, 0, ...missing);
  return `${lines.join('\n').trimEnd()}\n\n${test.trim()}\n`.replace(/^\n+/, '');
}

export function encodePayload(payload: ProposalPayload): string {
  const text = JSON.stringify(payload);
  return `<!-- mutant-review:proposals:v1 sha256=${createHash('sha256').update(text).digest('hex')} ${Buffer.from(text).toString('base64')} -->`;
}

/** Echoed text (reasons, test code, mutated source) can never form an HTML comment, so the only marker in an agent note is the agent's own. */
export const inert = (text: string) => text.replace(/<!--/g, '<​!--').replace(/-->/g, '--​>');

export function decodePayload(body: string): ProposalPayload | null {
  if (body.split('<!--').length !== 2) return null;
  const match = PAYLOAD.exec(body);
  if (!match) return null;
  const text = Buffer.from(match[2]!, 'base64').toString('utf8');
  if (createHash('sha256').update(text).digest('hex') !== match[1]) return null;
  return JSON.parse(text) as ProposalPayload;
}

/** Newest human mention after the agent's last reply. Older commands were already answered. */
export function pendingTrigger(notes: Note[], handle: string): Note | null {
  for (const note of notes) {
    if (note.body.includes(MARK)) return null;
    if (!note.system && note.body.trim().toLowerCase().startsWith(handle.toLowerCase())) return note;
  }
  return null;
}

export function testFileCandidates(source: string): string[] {
  const dir = posix.dirname(source), base = posix.basename(source).replace(/\.tsx?$/, '');
  return [`${dir}/${base}.test.ts`, `${dir}/${base}.spec.ts`, `${dir}/__tests__/${base}.test.ts`, `test/${base}.test.ts`, `tests/${base}.test.ts`].map((path) => path.replace(/^\.\//, ''));
}

// ---------- GitLab context ----------

const exists = (path: string) => access(path).then(() => true, () => false);
const readOr = (path: string, fallback = '') => readFile(path, 'utf8').catch(() => fallback);

export async function flowAdapter(env = process.env) {
  const bearer = env.GITLAB_TOKEN ?? env.GITLAB_OAUTH_TOKEN;
  const token = bearer ?? env.MUTANT_REVIEW_TOKEN;
  const tokenType = bearer ? 'bearer' as const : 'private-token' as const;
  const baseUrl = new URL(env.GITLAB_BASE_URL ?? env.CI_SERVER_URL ?? 'https://gitlab.com').origin;
  let projectId = Number(env.CI_PROJECT_ID ?? env.GITLAB_PROJECT_ID);
  if (!Number.isSafeInteger(projectId) || projectId < 1) {
    // Duo workloads expose only DAP/Git variables; derive the project from the checkout's own remote.
    const remote = git('remote', 'get-url', 'origin').replace(/^git@([^:]+):/, 'https://$1/');
    const path = new URL(remote).pathname.replace(/^\/+/, '').replace(/\.git$/, '');
    const response = await fetch(`${baseUrl}/api/v4/projects/${encodeURIComponent(path)}`, {
      headers: token ? (bearer ? { Authorization: `Bearer ${token}` } : { 'PRIVATE-TOKEN': token }) : {}, redirect: 'error', signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) throw new Error(`Could not resolve the GitLab project from the checkout remote (${response.status})`);
    projectId = (await response.json() as { id: number }).id;
  }
  return new GitLabAdapter({ baseUrl, projectId, token, tokenType });
}

export function flowHandle(args: string[], env = process.env): string {
  const index = args.indexOf('--handle');
  const handle = index >= 0 ? args[index + 1] : env.MUTANT_REVIEW_HANDLE;
  if (!handle || !/^@[a-zA-Z0-9_.-]+$/.test(handle)) throw new Error('Pass --handle @<flow-service-account> or set MUTANT_REVIEW_HANDLE');
  return handle;
}

async function reply(adapter: GitLabAdapter, mr: MergeRequest, text: string, tag: string) {
  await adapter.createMergeRequestNote(mr.iid, `${inert(text)}\n\n${MARK}${tag} ${mr.sha} -->`);
}

/** Access level of an active human author; null when this token may not read users/members. */
async function memberLevel(adapter: GitLabAdapter, note: Note): Promise<number | null> {
  try {
    if (await adapter.accountKind(note.author.id) !== 'human') return 0;
    const member = await adapter.currentMember(note.author.id);
    return member.id === note.author.id && (!member.state || member.state === 'active') ? member.access_level : 0;
  } catch (error) {
    return /\((?:401|403)\)/.test(String(error)) ? null : 0;
  }
}

/** Gate waiver: newest override note at this head by an active human Maintainer. */
export async function findOverride(adapter: GitLabAdapter, mrIid: number, headSha: string, handle: string): Promise<GateOverride | null> {
  const mr = await adapter.currentMergeRequest(mrIid);
  if (mr.sha !== headSha) return null;
  const pushedAt = await adapter.headPushedAt(mrIid, headSha);
  if (pushedAt === null) return null;
  for (const note of await adapter.listMergeRequestNotes(mrIid)) {
    if (note.system || Date.parse(note.created_at) <= pushedAt) continue;
    let command: ReviewCommand;
    try { command = parseReviewCommand(note.body, handle); } catch { continue; }
    if (command.action !== 'override') continue;
    const accessLevel = await memberLevel(adapter, note);
    if (accessLevel === null || accessLevel < 40) continue;
    return { actor: note.author.username, accessLevel, reason: command.reason, noteUrl: `${mr.web_url}#note_${note.id}`, approvedAt: note.created_at, headSha };
  }
  return null;
}

// ---------- Review: brief for the model ----------

async function requirementDocs(path: string): Promise<string> {
  for (let dir = posix.dirname(path); ; dir = posix.dirname(dir)) {
    for (const name of ['CONTRACTS.md', 'SPEC.md']) {
      const text = await readOr(dir === '.' ? name : `${dir}/${name}`);
      if (text) return `${dir === '.' ? name : `${dir}/${name}`}:\n${text.slice(0, 3000)}`;
    }
    if (dir === '.' || dir === '/') return '';
  }
}

export async function buildBrief(ranked: RankedFinding[], sources: Record<string, string>) {
  const memory = (await readOr('AGENTS.md')).match(/<!-- mutant-review:lessons:start -->[\s\S]*?<!-- mutant-review:lessons:end -->/)?.[0] ?? '';
  const sections = [];
  const targets = [];
  for (const finding of ranked) {
    const candidates = testFileCandidates(finding.path);
    let testPath = candidates[0]!;
    for (const candidate of candidates) if (await exists(candidate)) { testPath = candidate; break; }
    const existing = await readOr(testPath);
    targets.push({ ...finding, testPath });
    sections.push([
      findingContext(finding, sources[finding.path] ?? ''),
      `Requirement sources: doc comments above, plus:\n${await requirementDocs(finding.path) || '(no CONTRACTS.md found; use doc comments and names only, and say so in expectedFrom)'}`,
      existing ? `Write the test into the existing file \`${testPath}\` (first 60 lines):\n\`\`\`ts\n${existing.split('\n').slice(0, 60).join('\n')}\n\`\`\`` : `No test file exists yet; use \`${testPath}\` and import from 'vitest' and the module under test.`,
    ].join('\n'));
  }
  return { targets, brief: [`MODE: review`, `Draft one test per finding (at most ${ranked.length}). Write ${WORK}/proposals.json.`, memory, ...sections].filter(Boolean).join('\n\n') };
}

// ---------- Verification by execution ----------

/** Inverse of strykerRanges: `path:start-end` strings back to a mutation scope. */
export function scopeFromRanges(ranges: string[]): MutationScope[] {
  const scope: MutationScope[] = [];
  for (const range of ranges) {
    const [, path, start, end] = /^(.*):(\d+)-(\d+)$/.exec(range) ?? [];
    if (!path) throw new Error(`Invalid range ${range}`);
    const file = scope.find((item) => item.path === path) ?? (scope.push({ path, lines: [], change: 'modified' }), scope.at(-1)!);
    file.lines.push({ start: Number(start), end: Number(end) });
  }
  return scope;
}

async function runTestFile(testPath: string, name: string, report: string) {
  const config = (await json('stryker.config.json')).vitest?.configFile ?? 'vitest.config.ts';
  const run = await execute(['node_modules/vitest/vitest.mjs', 'run', testPath, '--config', config, '--reporter=json', `--outputFile=${report}`], report.replace(/\.json$/, '.log'), 60_000);
  const result = await json(report).catch(() => null) as { testResults?: { assertionResults: { title: string; fullName: string; status: string }[] }[] } | null;
  const ran = result?.testResults?.flatMap((suite) => suite.assertionResults).find((test) => test.title === name || test.fullName.endsWith(name));
  return run.exitCode === 0 && !run.timedOut && ran?.status === 'passed';
}

async function mutantKilled(findings: RankedFinding[], name: string): Promise<Record<string, boolean>> {
  const ranges = findings.map((finding) => `${finding.path}:${finding.line}-${finding.line}`);
  const { report } = await runStryker(ranges, { incremental: false, name });
  const mutants = report ? normalizeStrykerReport(report as never, scopeFromRanges(ranges)) : [];
  return Object.fromEntries(findings.map((finding) => [finding.fingerprint, mutants.find((mutant) => mutant.fingerprint === finding.fingerprint)?.status === 'Killed']));
}

/** A drafted test is kept only if it passes on this code AND fails on the targeted mutant. */
export async function verifyDraft(draft: Draft, finding: RankedFinding, index: number): Promise<VerifiedProposal | RejectedProposal> {
  const name = testName(draft.test) ?? '';
  const reject = (reason: string): RejectedProposal => ({ finding, testPath: draft.testPath, testName: name, reason });
  const problem = checkDraft(draft);
  if (problem) return reject(problem);
  const existed = await exists(draft.testPath);
  const original = await readOr(draft.testPath);
  try {
    await writeFile(draft.testPath, withTest(original, draft.imports, draft.test));
    if (!await runTestFile(draft.testPath, name, `evidence/flow/draft-${index}.json`)) return reject('fails or does not run on the current code');
    if (!(await mutantKilled([finding], `verify-${index}`))[finding.fingerprint]) return reject('passes on the mutant too, so it cannot notice the change (hallucinated or ineffective test)');
    return { ...draft, finding, testName: name };
  } finally {
    if (existed) await writeFile(draft.testPath, original); else await rm(draft.testPath, { force: true });
  }
}

// ---------- Comments ----------

function table(payload: Pick<ProposalPayload, 'proposals' | 'rejected' | 'equivalent'>, ranked: RankedFinding[]) {
  const rows = ranked.map((finding) => {
    const verified = payload.proposals.find((item) => item.finding.fingerprint === finding.fingerprint);
    const rejected = payload.rejected.find((item) => item.finding.fingerprint === finding.fingerprint);
    const equivalent = payload.equivalent.find((item) => item.finding.fingerprint === finding.fingerprint);
    const status = verified ? `✅ \`${verified.testName}\` kills it` : equivalent ? `➖ judged equivalent: ${equivalent.reason}` : rejected ? `❌ AI draft rejected: ${rejected.reason}` : '— no test drafted yet';
    const lost = finding.origin === 'lost-protection' ? '**lost protection:** ' : '';
    return `| ${finding.rank} | \`${finding.path}:${finding.line}\` | ${lost}\`${finding.original.replace(/\s+/g, ' ')}\` → \`${finding.replacement.replace(/\s+/g, ' ')}\` | ${status} |`;
  });
  return ['| # | Where | Change no test noticed | Verified test |', '|---|---|---|---|', ...rows].join('\n');
}

const flatCode = (code: string, max = 80) => { const text = code.replace(/\s+/g, ' ').trim(); return text.length > max ? `${text.slice(0, max - 1)}…` : text; };

/** Each change the target branch's tests noticed and this MR's tests no longer notice, with the test that noticed it and how the MR changed that test. */
export function lostProtectionSection(protection: Pick<ProtectionResult, 'lost'> | null | undefined): string {
  const lost = protection?.lost ?? [];
  if (!lost.length) return '';
  const items = lost.map((item, index) => {
    const test = item.caughtBy[0]!;
    const fate = test.fate === 'weakened' ? 'This MR changed that test and it no longer fails' : 'This MR removed, renamed or skipped that test, and no other test fails';
    const diff = item.testDiff?.lines.length ? `\n\n\`\`\`diff\n${item.testDiff.lines.map((line) => `${line.kind}${line.text}`).join('\n')}\n\`\`\`` : '';
    return `**${index + 1}.** \`${item.path}:${item.line}\`: when \`${flatCode(item.original)}\` became \`${flatCode(item.replacement)}\`, \`${flatCode(test.name, 120)}\` (\`${test.file}\`) failed on the target branch${test.failure ? ` ("${flatCode(test.failure, 120)}")` : ''}. ${fate}.${diff}`;
  });
  return ['### Lost protection', `This MR changed tests. On the target branch they noticed ${lost.length === 1 ? 'this change' : 'these changes'}; at this head no test does. Coverage cannot show it: every line still runs and every test is green.`, ...items].join('\n\n');
}

export function summaryBody(evidence: { mutation: { score: number | null; counts: { killed: number; survived: number; noCoverage: number } }; gate: { status: string }; triage: { arid: { reason: string }[]; overflow: number }; footprint?: FootprintReceipt | null; protection?: Pick<ProtectionResult, 'lost'> | null }, ranked: RankedFinding[], payload: Pick<ProposalPayload, 'proposals' | 'rejected' | 'equivalent'>, handle: string, threshold: number) {
  const { counts, score } = evidence.mutation;
  const open = counts.survived + counts.noCoverage;
  const lost = evidence.protection?.lost?.length ?? 0;
  const verified = payload.proposals.map((item) => item.finding.rank);
  const lessons = [...new Set(payload.proposals.map((item) => lessonCategory(item.finding).pattern))];
  return [
    lost
      ? `## Mutant Review: this MR's test changes stopped ${lost} change(s) from being noticed${open ? `, and ${open} change(s) on your changed lines go unnoticed` : ''}`
      : `## Mutant Review: ${open} change(s) on your changed lines that no test would notice`,
    score === null
      ? `No changed source lines to mutate. Gate: **${evidence.gate.status}**.`
      : `Changed-line mutation score **${score.toFixed(0)}%** (${counts.killed} of ${counts.killed + open} mutants killed). Policy ${threshold}%. Gate: **${evidence.gate.status}**.`,
    lostProtectionSection(evidence.protection),
    table(payload, ranked),
    evidence.triage.arid.length ? `Filtered as noise before any AI call: ${evidence.triage.arid.length} (${[...new Set(evidence.triage.arid.map((item) => item.reason))].join(', ')}).` : '',
    evidence.triage.overflow ? `${evidence.triage.overflow} lower-ranked finding(s) not commented, to keep review short.` : '',
    payload.rejected.length ? `**${payload.rejected.length} AI-drafted test(s) rejected by execution** before you saw them. A test that still passes on the mutant protects nothing.` : '',
    verified.length
      ? `Reply \`${handle} apply ${verified.join(' and ')}\` to commit ${verified.length === 1 ? 'this verified test' : 'these verified tests'} to this MR (Developer role or higher). Approving also adds ${lessons.map((item) => `"${item}"`).join(', ')} to this repository's AGENTS.md, so future agents stop repeating it.`
      : `Mention \`${handle}\` to draft a test for each finding. Every draft is executed against the mutant before you see it.`,
    `A Maintainer can waive the gate with \`${handle} override <written reason>\`; the reason is recorded in the gate job.`,
    footprintLine(evidence.footprint),
  ].filter(Boolean).join('\n\n');
}

/** One line: what this review cost (SCI, measured CPU time) and the mutation work scoping avoided. */
export function footprintLine(receipt: FootprintReceipt | null | undefined): string {
  if (!receipt) return '';
  const { actual, changedLinesRun, projectedWholeFile, savedPercent, region } = receipt;
  const parts = [`<sub>Footprint of this review: **${formatGrams(actual.sciG)}** (SCI per review, ${actual.cpuSeconds} CPU-s ${actual.cpuMeasured ? 'measured' : 'assumed at full load'}, ${region} grid)`];
  if (changedLinesRun && projectedWholeFile && savedPercent) parts.push(`changed-line scoping ran ${changedLinesRun.mutants} of ${projectedWholeFile.mutants} mutants, avoiding ~${savedPercent.toFixed(0)}% of the mutation energy (projected)`);
  return `${parts.join('; ')}.</sub>`;
}

function inlineBody(finding: RankedFinding, proposal: VerifiedProposal | undefined, handle: string) {
  return [
    `**[${finding.rank}] ${finding.why}**`,
    proposal ? `Verified test (passes on this code, fails on the mutant):\n\n\`\`\`ts\n${proposal.test.trim()}\n\`\`\`\n\nExpected value from: ${proposal.expectedFrom || 'see test'}\n\nReply \`${handle} apply ${finding.rank}\` to commit it to \`${proposal.testPath}\`.` : `Mention \`${handle}\` to get a verified test for this line.`,
  ].join('\n\n');
}

// ---------- Commands ----------

interface FlowState { mode: 'review' | 'done'; mrIid: number; headSha: string; runId?: string; score?: number | null; ranges?: string[]; protectionRanges?: string[]; targets?: (RankedFinding & { testPath: string })[]; threshold?: number }

export async function flowPrepare(args: string[]) {
  const handle = flowHandle(args);
  const adapter = await flowAdapter();
  const mr = await adapter.openMergeRequestForHead(git('rev-parse', 'HEAD'));
  const trigger = pendingTrigger(await adapter.listMergeRequestNotes(mr.iid), handle);
  await rm(`${WORK}/proposals.json`, { force: true });
  const done = async (message: string) => { await save(`${WORK}/flow.json`, { mode: 'done', mrIid: mr.iid, headSha: mr.sha } satisfies FlowState); console.log(`MODE: done\n${message}`); };
  let command: ReviewCommand = { action: 'review' };
  if (trigger) {
    try { command = parseReviewCommand(trigger.body, handle); } catch (error) {
      if (/\b(?:apply|override)\b/i.test(trigger.body)) {
        await reply(adapter, mr, `@${trigger.author.username} ${(error as Error).message}`, 'usage');
        return done('Replied with command usage.');
      }
    }
  }
  if (command.action === 'apply') return done(await flowApply(adapter, mr, handle, trigger!, command.findings));
  if (command.action === 'override') {
    const level = await memberLevel(adapter, trigger!);
    await reply(adapter, mr, level === null || level >= 40
      ? `Override request noted for \`${mr.sha.slice(0, 8)}\` by @${trigger!.author.username}: "${command.reason}". Re-run \`mutation:gate\`; it verifies the Maintainer role and records the reason.`
      : `@${trigger!.author.username} only a Maintainer can override the mutation gate.`, 'override');
    return done('Override acknowledged.');
  }
  const { evidence, sources } = await runReview({ mode: 'flow', headSha: mr.sha, baseSha: mr.diff_refs.base_sha, projectId: String(adapter.projectId), mrIid: mr.iid,
    pipelineId: null, jobId: null, pipelineUrl: null, projectUrl: null, output: `${WORK}/evidence.json` });
  const ranked = evidence.triage.ranked;
  if (!ranked.length) {
    const protection = evidence.protection;
    const unfinished = protection && (protection.status === 'inconclusive' || protection.status === 'over-budget');
    await reply(adapter, mr, evidence.mutation.status === 'complete' && !unfinished
      ? [evidence.mutation.score === null
        ? '## Mutant Review: no changed source lines to mutate'
        : `## Mutant Review: every mutant on the changed lines was killed\nChanged-line mutation score **${evidence.mutation.score.toFixed(0)}%** across ${evidence.mutation.mutants.length} mutants. Nothing to add.`,
      protection?.status === 'held' && protection.rechecked ? `Your test changes keep all ${protection.rechecked} change(s) they noticed on the target branch noticed.` : ''].filter(Boolean).join('\n\n')
      : `## Mutant Review could not finish\n${unfinished ? `Lost-protection check: ${protection.reason}` : evidence.scope.reason ?? 'Mutation analysis was inconclusive.'}`, 'clean');
    return done('No surviving mutants to draft tests for.');
  }
  const { targets, brief } = await buildBrief(ranked, sources);
  const policy = await json('.mutant-review/policy.json').catch(() => ({}));
  await save(`${WORK}/flow.json`, { mode: 'review', mrIid: mr.iid, headSha: mr.sha, runId: evidence.runId, score: evidence.mutation.score,
    ranges: evidence.scope.files.flatMap((file) => file.lines.map((line) => `${file.path}:${line.start}-${line.end}`)),
    protectionRanges: [...new Set<string>((evidence.protection?.lost ?? []).map((item) => `${item.path}:${item.location.start.line}-${item.location.end.line}`))], targets, threshold: policy.mutationThreshold ?? 90 } satisfies FlowState);
  console.log(brief);
}

export async function flowPublish(args: string[], connect: () => Promise<GitLabAdapter> = flowAdapter) {
  const handle = flowHandle(args);
  const state = await json(`${WORK}/flow.json`).catch(() => null) as FlowState | null;
  if (!state || state.mode !== 'review') { console.log('Nothing to publish.'); return; }
  const adapter = await connect();
  const mr = await adapter.currentMergeRequest(state.mrIid);
  if (mr.sha !== state.headSha) throw new Error('MR head changed while drafting; mention the agent again for a fresh review');
  const evidence = await json(`${WORK}/evidence.json`);
  const parsed = draftSchema.safeParse(await json(`${WORK}/proposals.json`).catch(() => ({})));
  const drafts = parsed.success ? parsed.data : { proposals: [], equivalent: [] };
  const targets = state.targets ?? [];
  const payload: ProposalPayload = { version: 1, mrIid: mr.iid, headSha: mr.sha, runId: state.runId!, score: state.score ?? null, ranges: state.ranges ?? [],
    ...(state.protectionRanges?.length ? { protectionRanges: state.protectionRanges } : {}), proposals: [], rejected: [], equivalent: [] };
  for (const draft of drafts.proposals.filter((item, index, all) => all.findIndex((other) => other.finding === item.finding) === index)) {
    const finding = targets.find((target) => target.rank === draft.finding);
    if (!finding) continue;
    const result = await verifyDraft(draft, finding, draft.finding);
    if ('reason' in result) payload.rejected.push(result); else payload.proposals.push(result);
  }
  for (const item of drafts.equivalent) {
    const finding = targets.find((target) => target.rank === item.finding);
    if (finding && !payload.proposals.some((proposal) => proposal.finding.rank === item.finding)) payload.equivalent.push({ finding, reason: item.reason });
  }
  const summary = `${inert(summaryBody(evidence, targets, payload, handle, state.threshold ?? 90))}\n\n${encodePayload(payload)}`;
  await adapter.publishFindings(mr.iid, mr.sha, summary, targets.map((finding) => ({
    id: `Finding ${finding.rank}`, path: finding.path, line: finding.line,
    body: inert(inlineBody(finding, payload.proposals.find((proposal) => proposal.finding.rank === finding.rank), handle)),
  })));
  await save(`${WORK}/published.json`, payload);
  console.log(`Published ${payload.proposals.length} verified, ${payload.rejected.length} rejected, ${payload.equivalent.length} equivalent.`);
}

/** CI variant: deterministic findings without AI drafts, posted once per head. */
export async function flowNotify(args: string[]) {
  const handle = flowHandle(args);
  const evidence = await json('evidence/latest.json');
  if (!evidence.triage?.ranked?.length) { console.log('No surviving mutants to report.'); return; }
  const adapter = await flowAdapter();
  const mr = await adapter.currentMergeRequest(Number(process.env.CI_MERGE_REQUEST_IID));
  if (mr.sha !== evidence.provenance.headSha) { console.log('MR head moved on; skipping stale findings.'); return; }
  if ((await adapter.listMergeRequestNotes(mr.iid)).some((note) => note.body.includes(`${MARK}notified ${mr.sha}`))) { console.log('Already reported for this head.'); return; }
  const policy = await json('.mutant-review/policy.json').catch(() => ({}));
  const empty = { proposals: [], rejected: [], equivalent: [] };
  await adapter.publishFindings(mr.iid, mr.sha, `${inert(summaryBody(evidence, evidence.triage.ranked, empty, handle, policy.mutationThreshold ?? 90))}\n\n${MARK}notified ${mr.sha} -->`,
    evidence.triage.ranked.map((finding: RankedFinding) => ({ id: `Finding ${finding.rank}`, path: finding.path, line: finding.line, body: inert(inlineBody(finding, undefined, handle)) })));
  console.log(`Reported ${evidence.triage.ranked.length} finding(s).`);
}

// ---------- Apply: human-approved commit ----------

interface LedgerEntry { id: string; kind: 'repaired' | 'rejected-proposal' | 'override'; recordedAt: string; mergeRequestIid: number | null; headSha: string;
  mutant: { path: string; line: number; operator: string; original: string; replacement: string } | null; test: { path: string; name: string } | null;
  scoreBefore: number | null; scoreAfter: number | null; actor: string | null; reason: string; lessonId: string | null }

const mutantOf = (finding: RankedFinding) => ({ path: finding.path, line: finding.line, operator: finding.operator, original: finding.original, replacement: finding.replacement });

export async function flowApply(adapter: GitLabAdapter, mr: MergeRequest, handle: string, note: Note, selection: number[]): Promise<string> {
  const fail = async (message: string) => { await reply(adapter, mr, `@${note.author.username} ${message}`, 'apply-refused'); return message; };
  const notes = await adapter.listMergeRequestNotes(mr.iid);
  // Fail closed. If this token may not read the author's role, require GitLab's own effective
  // permission for this run (the triggering person's composite identity) to be Developer+, and
  // the command to be the comment that started the run.
  const level = await memberLevel(adapter, note);
  let allowed = level !== null && level >= 30;
  if (level === null) {
    const effective = await adapter.tokenAccessLevel().catch(() => null);
    allowed = Boolean(process.env.GITLAB_TOKEN) && effective !== null && effective >= 30 && notes.find((item) => !item.system)?.id === note.id;
  }
  if (!allowed) return fail('applying tests needs an active human account with the Developer role or higher.');
  let payload: ProposalPayload | null = null, proposalNote: Note | undefined;
  // Proposals are trusted only when this flow's own service account posted them (usernames are unique).
  const agent = handle.slice(1).toLowerCase();
  for (const candidate of notes) {
    if (candidate.author.username?.toLowerCase() !== agent) continue;
    const decoded = decodePayload(candidate.body);
    if (decoded) { payload = decoded; proposalNote = candidate; break; }
  }
  if (!payload || !proposalNote) return fail(`there are no verified proposals on this MR yet. Mention \`${handle}\` to start a review.`);
  if (payload.headSha !== mr.sha || payload.mrIid !== mr.iid) return fail(`the code changed since the proposals were posted. Mention \`${handle}\` for a fresh review.`);
  if (Date.parse(note.created_at) < Date.parse(proposalNote.created_at)) return fail('this command predates the latest proposals.');
  const selected = payload.proposals.filter((proposal) => selection.includes(proposal.finding.rank));
  if (selected.length !== selection.length) return fail(`only verified findings can be applied: ${payload.proposals.map((item) => item.finding.rank).join(', ') || 'none'}.`);
  const unsafe = selected.find((proposal) => checkDraft({ ...proposal, finding: proposal.finding.rank }) || protectedPath(proposal.testPath));
  if (unsafe) return fail(`finding ${unsafe.finding.rank} targets a file the agent may not change; nothing was committed.`);

  const files = new Map<string, string>();
  for (const proposal of selected) files.set(proposal.testPath, withTest(files.get(proposal.testPath) ?? await readOr(proposal.testPath), proposal.imports, proposal.test));
  for (const [path, content] of files) { await writeFile(path, content); }
  for (const proposal of selected) {
    if (!await runTestFile(proposal.testPath, proposal.testName, `evidence/flow/apply-${proposal.finding.rank}.json`)) return fail(`\`${proposal.testName}\` no longer passes here; nothing was committed.`);
  }
  // Lost-protection lines are re-run too, so a restoring test is proven, but the score stays the changed-line score.
  const ranges = [...new Set([...payload.ranges, ...(payload.protectionRanges ?? [])])];
  const { report } = await runStryker(ranges, { incremental: false, name: 'apply' });
  const after = report ? normalizeStrykerReport(report as never, scopeFromRanges(ranges)) : [];
  const unkilled = selected.filter((proposal) => after.find((mutant) => mutant.fingerprint === proposal.finding.fingerprint)?.status !== 'Killed');
  if (!report || unkilled.length) return fail(`the re-run did not kill finding ${unkilled.map((item) => item.finding.rank).join(', ') || '(no report)'}; nothing was committed.`);
  const scoreAfter = payload.ranges.length ? mutationMetrics(filterMutantsToScope(after, scopeFromRanges(payload.ranges))).score : null;

  const now = new Date().toISOString();
  const ledgerPath = '.mutant-review/ledger.json';
  const ledger = await json(ledgerPath).catch(() => ({ schemaVersion: 1, entries: [] })) as { schemaVersion: 1; entries: LedgerEntry[] };
  const add = (entry: LedgerEntry) => { if (!ledger.entries.some((item) => item.id === entry.id)) ledger.entries.push(entry); };
  const lessons = new Map<string, MemoryLesson>();
  for (const name of (await readdir('.mutant-review/lessons').catch(() => [])).filter((item) => item.endsWith('.json'))) {
    const lesson = await json(`.mutant-review/lessons/${name}`).catch(() => null);
    if (lesson?.examples) lessons.set(lesson.id, lesson);
  }
  for (const proposal of selected) {
    const id = `repair-${mr.iid}-${proposal.finding.fingerprint.slice(0, 12)}`;
    const lesson = learnFromRepair(lessons.get(`lesson-${lessonCategory(proposal.finding).tag}`) ?? null, proposal.finding,
      { repository: new URL(mr.web_url).pathname.replace(/\/-\/merge_requests\/\d+$/, '').slice(1), module: dirname(proposal.finding.path), approvedBy: note.author.username, approvedAt: note.created_at, receiptId: id, mergeRequestIid: mr.iid });
    lessons.set(lesson.id, lesson);
    add({ id, kind: 'repaired', recordedAt: now, mergeRequestIid: mr.iid, headSha: mr.sha, mutant: mutantOf(proposal.finding), test: { path: proposal.testPath, name: proposal.testName },
      scoreBefore: payload.score, scoreAfter, actor: note.author.username, reason: proposal.finding.why, lessonId: lesson.id });
  }
  for (const rejected of payload.rejected) {
    add({ id: `rejected-${mr.iid}-${rejected.finding.fingerprint.slice(0, 12)}`, kind: 'rejected-proposal', recordedAt: now, mergeRequestIid: mr.iid, headSha: mr.sha, mutant: mutantOf(rejected.finding),
      test: { path: rejected.testPath, name: rejected.testName }, scoreBefore: payload.score, scoreAfter: null, actor: null, reason: `AI draft rejected: ${rejected.reason}`, lessonId: null });
  }
  const lessonFiles = [...lessons.values()].map((lesson) => ({ path: `.mutant-review/lessons/${lesson.id}.json`, content: JSON.stringify(lesson, null, 2) + '\n' }));
  const commitFiles = [
    ...[...files].map(([path, content]) => ({ path, content })),
    { path: ledgerPath, content: JSON.stringify(ledger, null, 2) + '\n' },
    ...lessonFiles,
    { path: 'AGENTS.md', content: updateAgentsMd(await readOr('AGENTS.md'), [...lessons.values()]) },
  ];
  const ranks = selected.map((item) => item.finding.rank);
  const commit = await adapter.commitToMergeRequest(mr.iid, mr.sha, commitFiles,
    `test: kill ${selected.length} surviving mutant(s) approved by @${note.author.username}\n\nMutant Review applied finding(s) ${ranks.join(', ')} from note ${note.id}. Each test passed on the reviewed code and failed on its mutant before commit.`);
  const score = (value: number | null) => value === null ? 'n/a' : `${value.toFixed(0)}%`;
  await reply(adapter, mr, [
    `Applied ${ranks.join(' and ')} for @${note.author.username} in ${commit.id.slice(0, 8)}.`,
    payload.ranges.length ? `Changed-line mutation score: **${score(payload.score)} → ${score(scoreAfter)}**.` : '',
    selected.some((item) => item.finding.origin === 'lost-protection') ? `Protection restored: ${selected.filter((item) => item.finding.origin === 'lost-protection').length} change(s) the target branch's tests noticed are noticed again, proven by the re-run.` : '',
    'The MR pipeline re-runs the gate on the new commit.',
    `AGENTS.md now teaches: ${[...new Set(selected.map((item) => lessonCategory(item.finding).pattern))].join('; ')}.`,
  ].filter(Boolean).join('\n\n'), 'applied');
  return `Committed ${commit.id}.`;
}
