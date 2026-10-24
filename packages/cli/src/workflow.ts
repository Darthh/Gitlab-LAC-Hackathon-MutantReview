import { mkdir, open, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { GitLabAdapter, exactPatchHash, exactLessonHash, validateTestChanges, type ExactPatchProposal, type ExactPatchApproval, type ExactLessonProposal } from '../../gitlab-adapter/src/index.js';
import { FileApprovalLedger } from '../../gitlab-adapter/src/ledger.js';
import { parseCommand } from '../../review-core/src/approval.js';
import { validateTriage, type Triage } from '../../review-core/src/triage.js';
import type { NormalizedMutant } from '../../review-core/src/types.js';
import type { ApprovedLesson } from '../../review-core/src/preflight.js';
import { digest } from './proof.js';
import { fixtureFeatures, verifyCommittedFixture } from './committed-proof.js';

interface Evidence {
  runId: string;
  source: string;
  provenance: { projectId: string | number; mrIid: number; headSha: string; baseSha: string; jobId: string | number; pipelineUrl?: string | null };
  baseline: { status: string };
  scope: { complete: boolean };
  mutation: { status: string; mutants: NormalizedMutant[] };
}
interface SavedProposal {
  createdAt: string;
  proposal: ExactPatchProposal;
  triage: Triage;
  evidence: Evidence;
  patch: string;
  posted?: boolean;
  lessonRetrieval?: LessonRetrieval;
  appliedLessonIds?: string[];
}
interface LessonRetrieval {
  id: string;
  source: 'versioned-approved-lessons';
  projectId: number;
  sourceHeadSha: string;
  query: string;
  lessons: ApprovedLesson[];
  createdAt: string;
}
interface Applied {
  id: string;
  branch: string;
  web_url: string;
  approval: ExactPatchApproval;
  committedAt: string;
}
interface Verified {
  schemaVersion: number;
  proposalId: string;
  repairCommitSha: string;
  approval: ExactPatchApproval;
  verification: Awaited<ReturnType<typeof verifyCommittedFixture>>;
  pipeline: unknown;
  pipelineStatus: string;
  verifiedAt: string;
}
interface SavedLesson {
  id: string;
  branch: string;
  web_url: string;
  lesson: { id: string; status: 'approved'; verified: true; approvedBy: string; approvedAt: string; receiptId: string; recommendation: string; tags: string[] };
  approval: ExactPatchApproval;
  receiptHash: string;
}

const ALLOWED_TESTS = Object.keys(fixtureFeatures);
const readJson = async <T>(path: string): Promise<T> => {
  const content = await readFile(path, 'utf8');
  try { return JSON.parse(content) as T; } catch { throw new Error('Structured JSON is malformed; file contents are omitted'); }
};
const readOptional = async <T>(path: string): Promise<T | null> => {
  try { return await readJson<T>(path); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
};
const id = (value: string | undefined) => {
  if (!value || !/^[a-zA-Z0-9_-]{1,100}$/.test(value)) throw new Error('Expected a concrete proposal identifier');
  return value;
};
const numberId = (value: string | undefined) => {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error('Expected a positive GitLab identifier');
  return parsed;
};

/** The application state is trusted operator storage, never an MR artifact or repository file. */
export async function trustedStateDirectory(directory: string | undefined, checkout = process.cwd()) {
  if (!directory || !isAbsolute(directory)) throw new Error('Set MUTANT_REVIEW_STATE_DIR to an absolute durable directory outside the checkout');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const root = await realpath(checkout);
  const state = await realpath(directory);
  const rel = relative(root, state);
  if (!rel || (!rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel))) throw new Error('Approval state must be outside the repository, including resolved symlinks');
  return state;
}

export async function writeImmutable(path: string, value: unknown) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 });
  const content = JSON.stringify(value, null, 2) + '\n';
  try {
    const file = await open(path, 'wx', 0o600);
    try { await file.writeFile(content); await file.sync(); } finally { await file.close(); }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(path, 'utf8') !== content) throw error;
  }
}

/** Strict additive unified-diff reader. Hunk coordinates and all original context must agree. */
export function applyAppendPatch(patch: string, originals: Record<string, string>) {
  if (patch.includes('\r') || /^(?:GIT binary patch|Binary files|rename |old mode|new mode|deleted file mode|\\ No newline)/m.test(patch)) throw new Error('Unsupported patch encoding or operation');
  const rows = (patch.endsWith('\n') ? patch.slice(0, -1) : patch).split('\n');
  const files: { path: string; before: string; after: string }[] = [];
  let cursor = 0;
  while (cursor < rows.length) {
    if (rows[cursor]!.startsWith('diff --git ') || rows[cursor]!.startsWith('index ')) { cursor++; continue; }
    const old = /^--- a\/(.+)$/.exec(rows[cursor++]!);
    const fresh = /^\+\+\+ b\/(.+)$/.exec(rows[cursor++] ?? '');
    if (!old || !fresh || old[1] !== fresh[1] || !(fresh[1]! in originals)) throw new Error('Patch must target an existing, explicitly approved test file');
    const path = fresh[1]!;
    const before = originals[path]!;
    if (!before.endsWith('\n')) throw new Error('The demo supports newline-terminated test files');
    const source = before.slice(0, -1).split('\n');
    const output: string[] = [];
    let sourceIndex = 0;
    let hunks = 0;
    while (cursor < rows.length && rows[cursor]!.startsWith('@@ ')) {
      const match = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@(?:.*)$/.exec(rows[cursor++]!);
      if (!match) throw new Error('Invalid unified-diff hunk');
      const oldStart = Number(match[1]);
      const oldCount = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newCount = match[4] === undefined ? 1 : Number(match[4]);
      const startIndex = oldCount === 0 ? oldStart : oldStart - 1;
      if (startIndex < sourceIndex || startIndex > source.length) throw new Error('Patch hunk is outside its original file');
      output.push(...source.slice(sourceIndex, startIndex));
      sourceIndex = startIndex;
      if (newStart !== output.length + 1) throw new Error('Patch new-line coordinates are inconsistent');
      let consumed = 0;
      let produced = 0;
      while (cursor < rows.length && !rows[cursor]!.startsWith('@@ ') && !rows[cursor]!.startsWith('diff --git ') && !rows[cursor]!.startsWith('--- a/')) {
        const row = rows[cursor++]!;
        if (row.startsWith('+')) { output.push(row.slice(1)); produced++; }
        else if (row.startsWith(' ') && source[sourceIndex] === row.slice(1)) { output.push(source[sourceIndex++]!); consumed++; produced++; }
        else throw new Error('Patch removes existing code or its context does not match the revision');
      }
      if (consumed !== oldCount || produced !== newCount) throw new Error('Patch hunk line counts are inconsistent');
      hunks++;
    }
    if (!hunks) throw new Error('Patch has no changes');
    output.push(...source.slice(sourceIndex));
    files.push({ path, before, after: output.join('\n') + '\n' });
  }
  validateTestChanges(files, ALLOWED_TESTS);
  return files;
}

/** Identity and timestamps come exclusively from a freshly fetched project MR note. */
export async function approvalFromNote(adapter: GitLabAdapter, proposal: ExactPatchProposal, action: 'apply' | 'verify' | 'learn', noteId: number, configuredHandle: string, after: string, now = new Date()): Promise<ExactPatchApproval> {
  const note = await adapter.readMergeRequestNote(proposal.mergeRequestIid, noteId);
  const command = parseCommand(note.body, configuredHandle);
  if (command.action !== action || command.proposalId !== proposal.id || command.patchHash !== proposal.patchHash) throw new Error('Note does not authorize this exact action and proposal hash');
  const approvedAt = note.updated_at || note.created_at;
  const time = Date.parse(approvedAt);
  const earliest = Date.parse(after);
  if (![time, earliest, now.getTime()].every(Number.isFinite) || time < earliest || time > now.getTime() || now.getTime() - time >= 3_600_000) throw new Error('Approval note predates the proposal, is expired, or has an invalid timestamp');
  const member = await adapter.currentMember(note.author.id);
  const expiry = member.expires_at ? Date.parse(`${member.expires_at}T23:59:59Z`) : null;
  if (member.id !== note.author.id || member.access_level < 40 || !Number.isInteger(member.access_level) || (member.state && member.state !== 'active') || (expiry !== null && (!Number.isFinite(expiry) || expiry < now.getTime()))) throw new Error('Approval author is not a currently authorized maintainer');
  const mr = await adapter.currentMergeRequest(proposal.mergeRequestIid);
  if (mr.sha !== proposal.sourceHeadSha || mr.state !== 'opened') throw new Error('Approval is stale: MR head changed or MR closed');
  return { eventId: `project-${adapter.projectId}-mr-${proposal.mergeRequestIid}-note-${note.id}`, action, actorId: note.author.id, projectId: adapter.projectId, mergeRequestIid: proposal.mergeRequestIid, sourceHeadSha: proposal.sourceHeadSha, runId: proposal.runId, proposalId: proposal.id, findingIds: proposal.findingIds, patchHash: proposal.patchHash, approvedAt, expiresAt: new Date(time + 3_600_000).toISOString() };
}

function configuredAdapter(write: boolean) {
  const token = write ? process.env.GITLAB_WRITE_TOKEN : process.env.GITLAB_READ_TOKEN ?? process.env.GITLAB_WRITE_TOKEN;
  if (write && !token) throw new Error('Set server-side GITLAB_WRITE_TOKEN for this explicit write action');
  return new GitLabAdapter({ baseUrl: process.env.GITLAB_URL ?? 'https://gitlab.com', projectId: numberId(process.env.GITLAB_PROJECT_ID), token });
}

/** Read-only flow hydration. A failure removes previous evidence so no stale fixture can be interpreted. */
export async function hydrateEvidence(adapter: GitLabAdapter, mrIid: number, jobId: number, checkoutSha: string, output = 'evidence/latest.json') {
  await rm(output, { force: true });
  const mr = await adapter.currentMergeRequest(mrIid);
  if (mr.sha !== checkoutSha) throw new Error('Flow checkout does not match the current MR source revision');
  const evidence = await adapter.readEvidenceArtifact(jobId, mr.sha) as Evidence;
  if (evidence.source !== 'gitlab' || Number(evidence.provenance.projectId) !== adapter.projectId || Number(evidence.provenance.mrIid) !== mrIid || evidence.provenance.headSha !== mr.sha || Number(evidence.provenance.jobId) !== jobId || evidence.baseline.status !== 'passed' || !evidence.scope.complete || evidence.mutation.status !== 'complete' || !Array.isArray(evidence.mutation.mutants)) throw new Error('Flow evidence is incomplete, stale, or does not match the configured MR/job');
  await mkdir(resolve(output, '..'), { recursive: true });
  const temporary = `${output}.${randomUUID()}.pending`;
  await writeFile(temporary, JSON.stringify(evidence, null, 2) + '\n');
  await rename(temporary, output);
  return { status: 'hydrated', projectId: adapter.projectId, mrIid, headSha: mr.sha, jobId };
}

export async function hydrateConfiguredEvidence(checkoutSha: string) {
  // Remove stale data even when configuration itself is missing or invalid.
  await rm('evidence/latest.json', { force: true });
  const adapter = new GitLabAdapter({
    baseUrl: process.env.GITLAB_URL ?? process.env.DUO_WORKFLOW_GIT_HTTP_BASE_URL ?? process.env.GITLAB_BASE_URL ?? 'https://gitlab.com',
    projectId: numberId(process.env.GITLAB_PROJECT_ID ?? process.env.CI_PROJECT_ID),
    token: process.env.GITLAB_READ_TOKEN ?? process.env.GITLAB_TOKEN,
    tokenType: process.env.GITLAB_READ_TOKEN ? 'private-token' : 'bearer',
  });
  if (Boolean(process.env.GITLAB_MR_IID) !== Boolean(process.env.GITLAB_EVIDENCE_JOB_ID)) throw new Error('Explicit hydration requires both GITLAB_MR_IID and GITLAB_EVIDENCE_JOB_ID');
  const context = process.env.GITLAB_MR_IID ? { mrIid: numberId(process.env.GITLAB_MR_IID), jobId: numberId(process.env.GITLAB_EVIDENCE_JOB_ID) } : await adapter.findEvidenceJobForHead(checkoutSha);
  return hydrateEvidence(adapter, context.mrIid, context.jobId, checkoutSha);
}

/** Retrieval is a separate recorded event, never a claim that an agent applied the lesson. */
export async function recordLessonRetrieval(query: string, lessons: ApprovedLesson[], projectId: number, headSha: string) {
  if (!lessons.length || !process.env.MUTANT_REVIEW_STATE_DIR) return null;
  if (!Number.isSafeInteger(projectId) || projectId < 1 || !/^[a-f0-9]{40}$/.test(headSha)) throw new Error('Tracked lesson retrieval requires the configured project and exact checkout SHA');
  const state = await trustedStateDirectory(process.env.MUTANT_REVIEW_STATE_DIR);
  const retrieval: LessonRetrieval = { id: `retrieval-${randomUUID()}`, source: 'versioned-approved-lessons', projectId, sourceHeadSha: headSha, query, lessons, createdAt: new Date().toISOString() };
  await writeImmutable(join(state, 'retrievals', `${retrieval.id}.json`), retrieval);
  return { id: retrieval.id, lessonIds: lessons.map((lesson) => lesson.id), sourceHeadSha: headSha, status: 'retrieved', note: 'Retrieval is recorded; application and a real Duo session have not been established.' };
}

/** Public projection of trusted operator receipts; contains no credentials or operational state paths. */
export async function exportAssistedReceipt(state: string, proposalId: string, latestAttempt?: Verified) {
  const saved = await readJson<SavedProposal>(join(state, 'proposals', `${id(proposalId)}.json`));
  const applied = await readJson<Applied>(join(state, 'applied', `${proposalId}.json`));
  const verified = latestAttempt ?? await readOptional<Verified>(join(state, 'verified', `${proposalId}.json`)) ?? await readOptional<Verified>(join(state, 'verification-attempts', proposalId, '2.json')) ?? await readJson<Verified>(join(state, 'verification-attempts', proposalId, '1.json'));
  const lesson = verified.verification.status === 'passed' ? await readOptional<SavedLesson>(join(state, 'lessons', `${proposalId}.json`)) : null;
  const proposal = saved.proposal;
  if (proposal.patchHash !== exactPatchHash(proposal) || verified.repairCommitSha !== applied.id || verified.verification.patchHash !== proposal.patchHash || !['passed', 'failed'].includes(verified.verification.status)) throw new Error('Trusted receipts do not establish this exact repair attempt');
  const pipeline = verified.pipeline as { id: number; sha: string; web_url: string };
  const receipt = {
    schemaVersion: 1,
    source: 'gitlab-assisted-local-verification',
    proposalId,
    projectId: String(proposal.projectId),
    mrIid: proposal.mergeRequestIid,
    sourceHeadSha: proposal.sourceHeadSha,
    runId: proposal.runId,
    patchHash: proposal.patchHash,
    proposal,
    proposalPatch: saved.patch,
    testPath: proposal.files[0]!.path,
    repair: { commitSha: applied.id, branch: applied.branch, url: applied.web_url, approvedBy: String(applied.approval.actorId), approvedAt: applied.approval.approvedAt, approvalEventId: applied.approval.eventId },
    verification: { ...verified.verification, approvedBy: String(verified.approval.actorId), approvedAt: verified.approval.approvedAt, approvalEventId: verified.approval.eventId },
    pipeline: { id: pipeline.id, sha: pipeline.sha, url: pipeline.web_url, status: 'started-or-existing-outcome-unverified' },
    ...(saved.lessonRetrieval && saved.appliedLessonIds?.length ? { lessonApplication: { retrievalId: saved.lessonRetrieval.id, lessonIds: saved.appliedLessonIds, sourceRevision: saved.lessonRetrieval.sourceHeadSha, whyApplies: [...saved.triage.suggestedTests.map((test) => test.rationale), ...saved.triage.uncertainty].join('\n'), status: verified.verification.status === 'passed' ? 'applied-and-verified' : 'retrieved', repairCommitSha: applied.id, provenance: 'submitted-structured-triage', duoExecution: 'unverified' } } : {}),
    ...(lesson ? { lesson: { id: lesson.lesson.id, status: lesson.lesson.status, verified: lesson.lesson.verified, approvedBy: lesson.lesson.approvedBy, approvedAt: lesson.lesson.approvedAt, receiptId: lesson.lesson.receiptId, commitSha: lesson.id, branch: lesson.branch, url: lesson.web_url, recommendation: lesson.lesson.recommendation, tags: lesson.lesson.tags, sourceReceiptHash: lesson.receiptHash } } : {}),
    createdAt: new Date().toISOString(),
  };
  await mkdir('evidence', { recursive: true });
  const temporary = `evidence/assisted-receipt-${randomUUID()}.json`;
  await writeFile(temporary, JSON.stringify(receipt, null, 2) + '\n');
  await rename(temporary, 'evidence/assisted-receipt.json');
  return receipt;
}

export async function runAssisted(command: string, args: string[]) {
  if (command === 'export-receipt') {
    const state = await trustedStateDirectory(process.env.MUTANT_REVIEW_STATE_DIR);
    console.log(JSON.stringify(await exportAssistedReceipt(state, id(args[0])), null, 2));
    return;
  }
  const adapter = configuredAdapter(command !== 'capabilities');
  if (command === 'capabilities') {
    console.log(JSON.stringify(await adapter.capabilityCheck(args[0] ? numberId(args[0]) : undefined), null, 2));
    return;
  }
  const state = await trustedStateDirectory(process.env.MUTANT_REVIEW_STATE_DIR);
  const handle = process.env.GITLAB_FLOW_HANDLE;
  if (!handle || !/^@[a-zA-Z0-9_.-]+$/.test(handle)) throw new Error('Set GITLAB_FLOW_HANDLE to the actual configured flow service-account mention');
  const ledger = new FileApprovalLedger(join(state, 'events'));
  if (command === 'publish') {
    const iid = numberId(args[0]);
    const jobId = numberId(args[1]);
    if (!args[2]) throw new Error('Use publish <MR IID> <evidence job ID> <structured-triage.json>');
    const mr = await adapter.currentMergeRequest(iid);
    const evidence = await adapter.readEvidenceArtifact(jobId, mr.sha) as Evidence;
    if (Number(evidence.provenance.mrIid) !== iid || evidence.baseline.status !== 'passed' || !evidence.scope.complete || evidence.mutation.status !== 'complete') throw new Error('Proposal requires complete baseline and mutation evidence for this MR');
    const survivors = evidence.mutation.mutants.filter((mutant) => mutant.status === 'Survived');
    const triage = validateTriage(await readJson(args[2]), survivors.map((mutant) => mutant.fingerprint));
    if (triage.classification !== 'actionable-testing-gap') throw new Error('Only actionable triage can create a repair proposal');
    const originals = Object.fromEntries(await Promise.all(ALLOWED_TESTS.map(async (path) => [path, await adapter.readRepositoryFile(path, mr.sha)] as const)));
    const files = applyAppendPatch(triage.proposedPatch, originals);
    if (files.length !== 1) throw new Error('The demonstration supports one feature per approved proposal');
    const feature = fixtureFeatures[files[0]!.path as keyof typeof fixtureFeatures];
    const targeted = survivors.filter((mutant) => triage.mutantFingerprints.includes(mutant.fingerprint));
    if (!targeted.every((mutant) => mutant.path === feature.sourcePath && mutant.original === feature.original && mutant.replacement === feature.replacement && mutant.operator === 'EqualityOperator')) throw new Error('Proposal does not target the supported exact threshold mutation');
    const body = { id: `proposal-${digest(`${evidence.runId}:${triage.findingId}:${triage.proposedPatch}`).slice(0, 20)}`, projectId: adapter.projectId, mergeRequestIid: iid, sourceHeadSha: mr.sha, runId: evidence.runId, findingIds: [triage.findingId], files };
    const proposal: ExactPatchProposal = { ...body, patchHash: exactPatchHash(body) };
    const retrieval = args[3] ? await readJson<LessonRetrieval>(join(state, 'retrievals', `${id(args[3])}.json`)) : null;
    const rationale = [...triage.suggestedTests.map((test) => test.rationale), ...triage.uncertainty].join('\n');
    const appliedLessonIds = retrieval?.lessons.filter((lesson) => rationale.includes(lesson.id)).map((lesson) => lesson.id) ?? [];
    if (retrieval && (retrieval.projectId !== adapter.projectId || retrieval.sourceHeadSha !== mr.sha || retrieval.source !== 'versioned-approved-lessons' || !appliedLessonIds.length || !Number.isFinite(Date.parse(retrieval.createdAt)) || Date.parse(retrieval.createdAt) > Date.now())) throw new Error('Lesson retrieval does not match this project/source revision or is not cited in the proposed test rationale');
    const saved: SavedProposal = { createdAt: new Date().toISOString(), proposal, triage, evidence, patch: triage.proposedPatch, ...(retrieval ? { lessonRetrieval: retrieval, appliedLessonIds } : {}) };
    await writeImmutable(join(state, 'proposals', `${proposal.id}.json`), saved);
    const summary = `## Mutant Review\n\n${triage.behavioralGap}\n\nRequirement: ${triage.requirementReference}\n\nMeasured evidence: job ${jobId}, run ${evidence.runId}.\n\nInterpretation is submitted structured triage; a Duo session is not inferred from this file.\n\nExact proposed test patch:\n\n\`\`\`diff\n${triage.proposedPatch}\n\`\`\`\n\nProposal: \`${proposal.id}\`\n\nExact content/revision SHA-256: \`${proposal.patchHash}\`\n\nA maintainer can authorize this exact test-only commit by posting:\n\n\`${handle} apply ${proposal.id} ${proposal.patchHash}\`\n\nThis creates an isolated repair branch. It does not update this MR, approve verification, save a lesson, merge, or deploy.`;
    await adapter.publishFindings(iid, mr.sha, summary, [{ id: triage.findingId, body: `${triage.behavioralGap}\n\nRequirement: ${triage.requirementReference}\n\nUncertainty: ${triage.uncertainty.join('; ') || 'No additional uncertainty submitted.'}`, path: targeted[0]!.path, line: targeted[0]!.location.start.line }]);
    await writeImmutable(join(state, 'published', `${proposal.id}.json`), { proposalId: proposal.id, patchHash: proposal.patchHash });
    console.log(JSON.stringify({ proposalId: proposal.id, patchHash: proposal.patchHash, stage: 'awaiting patch approval', mr: mr.web_url }, null, 2));
    return;
  }
  const proposalId = id(args[0]);
  const saved = await readJson<SavedProposal>(join(state, 'proposals', `${proposalId}.json`));
  const proposal = saved.proposal;
  if (proposal.projectId !== adapter.projectId || proposal.patchHash !== exactPatchHash(proposal)) throw new Error('Trusted proposal integrity check failed');
  await readJson(join(state, 'published', `${proposalId}.json`));
  const noteId = command === 'prepare-lesson' ? 0 : numberId(args[1]);
  if (command === 'apply') {
    const approval = await approvalFromNote(adapter, proposal, 'apply', noteId, handle, saved.createdAt);
    const scopeEvent = `apply-proposal-${proposal.patchHash}`;
    if (!await ledger.reserve(scopeEvent)) throw new Error('This proposal already has a commit attempt; reconcile the durable receipt before retrying');
    try {
      const commit = await adapter.commitApprovedTests(proposal, approval, ALLOWED_TESTS, ledger);
      const applied: Applied = { ...commit, approval, committedAt: new Date().toISOString() };
      await writeImmutable(join(state, 'applied', `${proposalId}.json`), applied);
      await ledger.record(scopeEvent, 'committed', commit.id);
      console.log(JSON.stringify({ stage: 'awaiting verification approval', commit, nextCommand: `${handle} verify ${proposalId} ${proposal.patchHash}`, scope: 'Verification approval runs fresh checks and starts a pipeline at this exact repair commit. MR update, merge, lesson and deployment remain separate.' }, null, 2));
    } catch (error) { await ledger.record(scopeEvent, 'rejected'); throw error; }
    return;
  }
  const applied = await readJson<Applied>(join(state, 'applied', `${proposalId}.json`));
  if (command === 'verify') {
    if (await readOptional(join(state, 'verified', `${proposalId}.json`))) throw new Error('This exact repair already has a successful verification receipt; export-receipt can display it without another execution');
    const approval = await approvalFromNote(adapter, proposal, 'verify', noteId, handle, applied.committedAt);
    if (await adapter.readBranchHead(applied.branch) !== applied.id) throw new Error('Repair branch advanced; a new proposal and approval are required');
    const attemptDirectory = join(state, 'verification-attempts', proposalId);
    if (!await ledger.reserve(approval.eventId)) throw new Error('Verification approval was already consumed');
    let attempt = 0;
    let attemptEvent = '';
    for (let candidate = 1; candidate <= 2; candidate++) {
      const event = `verify-${proposal.patchHash}-${candidate}`;
      if (await ledger.reserve(event)) { attempt = candidate; attemptEvent = event; break; }
    }
    if (!attempt) { await ledger.record(approval.eventId, 'rejected'); throw new Error('Verification repair-attempt budget exhausted; prepare a new proposal'); }
    await writeImmutable(join(attemptDirectory, `${attempt}-started.json`), { status: 'reserved', approval, startedAt: new Date().toISOString() });
    try {
      const verification = await verifyCommittedFixture(adapter, proposal, applied.id, `evidence/approved/${proposalId}/attempt-${attempt}`);
      if ((await adapter.currentMergeRequest(proposal.mergeRequestIid)).sha !== proposal.sourceHeadSha || await adapter.readBranchHead(applied.branch) !== applied.id) throw new Error('A recorded revision changed during verification; renewed approval is required');
      // A created pipeline is execution intent; its CI outcome is not a successful verification claim.
      const pipeline = await adapter.ensureBranchPipeline(applied.branch, applied.id);
      const receipt: Verified = { schemaVersion: 1, proposalId, repairCommitSha: applied.id, approval, verification, pipeline, pipelineStatus: 'started or existing; CI outcome not yet established', verifiedAt: new Date().toISOString() };
      await writeImmutable(join(attemptDirectory, `${attempt}.json`), receipt);
      if (verification.status === 'passed') await writeImmutable(join(state, 'verified', `${proposalId}.json`), receipt);
      await ledger.record(approval.eventId, verification.status === 'passed' ? 'committed' : 'rejected', applied.id);
      await ledger.record(attemptEvent, verification.status === 'passed' ? 'committed' : 'rejected', applied.id);
      await exportAssistedReceipt(state, proposalId, receipt);
      console.log(JSON.stringify({ stage: verification.status === 'passed' ? 'repair verified by local execution of GitLab commit contents' : 'repair rejected', receipt, next: verification.status === 'passed' ? `Run prepare-lesson ${proposalId} to inspect a candidate before separate lesson approval.` : 'A revised patch requires a new approval.' }, null, 2));
      if (verification.status !== 'passed') process.exitCode = 1;
    } catch (error) {
      await writeImmutable(join(attemptDirectory, `${attempt}-error.json`), { status: 'failed', approval, error: error instanceof Error ? error.message : 'Verification execution failed', failedAt: new Date().toISOString() });
      await Promise.allSettled([ledger.record(approval.eventId, 'rejected'), ledger.record(attemptEvent, 'rejected')]);
      throw error;
    }
    return;
  }
  const verified = await readJson<Verified>(join(state, 'verified', `${proposalId}.json`));
  if (verified.verification.status !== 'passed' || !verified.verification.cleanRerun || verified.repairCommitSha !== applied.id) throw new Error('A fresh successful verification receipt is required for a lesson');
  const receiptHash = digest(JSON.stringify(verified));
  if (command === 'prepare-lesson') {
    const feature = fixtureFeatures[proposal.files[0]!.path as keyof typeof fixtureFeatures];
    const content = JSON.stringify({ schemaVersion: 1, id: `inclusive-boundary-${proposal.patchHash.slice(0, 12)}`, repository: process.env.CI_PROJECT_PATH ?? 'mutant-review', module: 'demo-domain', symbols: [feature.symbol], tags: ['inclusive-threshold', 'money', 'boundary'], pattern: 'Inclusive monetary thresholds', applicability: 'A written business contract includes a threshold value using at least or at most.', weakness: saved.triage.behavioralGap, recommendation: 'Test one integer cent below the threshold, exactly at it, and one cent above. Derive each expected result from the feature contract.', requirementReference: saved.triage.requirementReference, sourceMergeRequest: proposal.mergeRequestIid, sourceRevision: proposal.sourceHeadSha, mutantFingerprints: saved.triage.mutantFingerprints, verifiedPatchHash: proposal.patchHash, repairReceipt: { hash: receiptHash, repairCommitSha: applied.id, status: 'passed' }, state: 'candidate', approval: null, revalidateWhen: 'The contract, implementation, test runner or mutation toolchain changes.', demonstratedUses: [] }, null, 2) + '\n';
    const body = { id: `lesson-${proposal.patchHash.slice(0, 20)}`, projectId: proposal.projectId, mergeRequestIid: proposal.mergeRequestIid, sourceHeadSha: proposal.sourceHeadSha, runId: proposal.runId, findingIds: proposal.findingIds, repairCommitSha: applied.id, verifiedReceiptHash: receiptHash, lessonPath: `.mutant-review/lessons/inclusive-boundary-${proposal.patchHash.slice(0, 12)}.json`, lessonContent: content };
    const lesson: ExactLessonProposal = { ...body, patchHash: exactLessonHash(body) };
    await writeImmutable(join(state, 'lesson-proposals', `${proposalId}.json`), { createdAt: new Date().toISOString(), proposal: lesson });
    console.log(JSON.stringify({ lesson, stage: 'awaiting lesson approval', nextCommand: `${handle} learn ${lesson.id} ${lesson.patchHash}`, scope: 'Approve these exact lesson semantics. The commit adds the actual note actor and timestamp as approval metadata on a separate branch. It does not update this MR, merge, or deploy.' }, null, 2));
    return;
  }
  if (command === 'learn') {
    const draft = await readJson<{ createdAt: string; proposal: ExactLessonProposal }>(join(state, 'lesson-proposals', `${proposalId}.json`));
    if (draft.proposal.verifiedReceiptHash !== receiptHash || draft.proposal.patchHash !== exactLessonHash(draft.proposal)) throw new Error('Lesson draft no longer matches the verified receipt');
    const approval = await approvalFromNote(adapter, { ...draft.proposal, files: [] }, 'learn', noteId, handle, draft.createdAt);
    const lesson = await adapter.commitApprovedLesson(draft.proposal, approval, ledger);
    await writeImmutable(join(state, 'lessons', `${proposalId}.json`), { ...lesson, approval, receiptHash });
    await exportAssistedReceipt(state, proposalId);
    console.log(JSON.stringify({ stage: 'lesson saved on separate branch', lesson, next: 'Human review and merge remain required. Retrieval is available only after the approved lesson enters the checked-out repository.' }, null, 2));
    return;
  }
  throw new Error('Unknown assisted command');
}
