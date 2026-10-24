import { createHash, randomUUID } from "node:crypto";

export interface GitLabConfig {
  baseUrl: string;
  projectId: number;
  token?: string;
  /** Explicit OAuth support for the documented Duo GITLAB_TOKEN runtime variable. */
  tokenType?: "private-token" | "bearer";
  fetch?: typeof fetch;
}
export interface MergeRequest {
  iid: number;
  sha: string;
  source_branch: string;
  source_project_id: number;
  target_project_id: number;
  web_url: string;
  state: string;
  diff_refs: { base_sha: string; head_sha: string; start_sha: string };
}
export interface DiffFile {
  old_path: string;
  new_path: string;
  diff: string;
  deleted_file?: boolean;
  too_large?: boolean;
  collapsed?: boolean;
}
export interface DiffVersion {
  id: number;
  head_commit_sha: string;
  base_commit_sha: string;
  start_commit_sha: string;
  diffs?: DiffFile[];
}
export interface FindingComment {
  id: string;
  body: string;
  path?: string;
  line?: number;
}
export const GITLAB_PIPELINE_STATUSES = [
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "manual",
  "scheduled",
  "success",
  "failed",
  "canceled",
  "skipped",
] as const;
export interface PipelineReference {
  id: number;
  sha: string;
  web_url: string;
  status: string;
}
export interface PipelineProvisioning extends PipelineReference {
  provisioning: "created" | "reused";
  /** Observing or creating a pipeline does not prove the targeted repair checks executed. */
  executionOutcome: "unverified";
  priorPipelineId?: number;
}
export interface TestFileChange {
  path: string;
  before: string;
  after: string;
}
export interface ExactPatchProposal {
  id: string;
  projectId: number;
  mergeRequestIid: number;
  sourceHeadSha: string;
  runId: string;
  findingIds: string[];
  files: TestFileChange[];
  patchHash: string;
}
export interface ExactPatchApproval {
  action: "review" | "apply" | "verify" | "learn" | "override";
  eventId: string;
  actorId: number;
  projectId: number;
  mergeRequestIid: number;
  sourceHeadSha: string;
  runId: string;
  proposalId: string;
  findingIds: string[];
  patchHash: string;
  approvedAt: string;
  expiresAt: string;
}
export interface ExactLessonProposal extends Omit<ExactPatchProposal, "files"> {
  repairCommitSha: string;
  verifiedReceiptHash: string;
  lessonPath: string;
  /** Exact candidate JSON displayed before approval; state candidate and approval null. */
  lessonContent: string;
}
/** Implement this on a trusted durable store, never an untrusted MR artifact. */
export interface ApprovalLedger {
  /** Atomically reserve the event. Return false if any earlier attempt reserved it. */
  reserve(eventId: string): Promise<boolean>;
  record(
    eventId: string,
    outcome: "committed" | "rejected",
    commitSha?: string,
  ): Promise<void>;
}

const sha = /^[a-f0-9]{40}$/i;
const safePath = (path: string) =>
  !!path &&
  !path.includes("\\") &&
  !path.startsWith("/") &&
  !path.split("/").some((part) => part === ".." || part === "." || !part) &&
  !/[\0\r\n]/.test(path);
const equalSet = (a: string[], b: string[]) =>
  a.length === b.length &&
  new Set(a).size === a.length &&
  [...a].sort().join("\0") === [...b].sort().join("\0");
const positiveId = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Expected a positive GitLab identifier");
  return value;
};
const reusablePipelineStates = new Set([
  "created",
  "waiting_for_resource",
  "preparing",
  "pending",
  "running",
  "manual",
  "scheduled",
  "success",
]);
const terminalPipelineStates = new Set(["failed", "canceled", "skipped"]);
function newestPipelineAtHead(
  pipelines: PipelineReference[],
  expectedHead: string,
): PipelineReference | undefined {
  return pipelines
    .filter((pipeline) => pipeline.sha === expectedHead)
    .sort((a, b) => positiveId(b.id) - positiveId(a.id))[0];
}
function pipelineResult(
  pipeline: PipelineReference,
  expectedHead: string,
  provisioning: "created" | "reused",
  priorPipelineId?: number,
): PipelineProvisioning {
  positiveId(pipeline.id);
  if (pipeline.sha !== expectedHead)
    throw new Error(
      "Pipeline revision differs from the approved head; execution outcome remains unverified",
    );
  if (
    !reusablePipelineStates.has(pipeline.status) &&
    !terminalPipelineStates.has(pipeline.status)
  ) {
    throw new Error(
      "Pipeline status is unavailable or unsupported; execution outcome remains unverified",
    );
  }
  return {
    ...pipeline,
    provisioning,
    executionOutcome: "unverified",
    ...(priorPipelineId ? { priorPipelineId } : {}),
  };
}

/** Hash the complete visible before/after contents and revision context, not an AI description. */
export function exactPatchHash(
  proposal: Omit<ExactPatchProposal, "patchHash">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: proposal.id,
        projectId: proposal.projectId,
        mergeRequestIid: proposal.mergeRequestIid,
        sourceHeadSha: proposal.sourceHeadSha,
        runId: proposal.runId,
        findingIds: [...proposal.findingIds].sort(),
        files: [...proposal.files].sort((a, b) => a.path.localeCompare(b.path)),
      }),
    )
    .digest("hex");
}

export function exactLessonHash(
  proposal: Omit<ExactLessonProposal, "patchHash">,
): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        id: proposal.id,
        projectId: proposal.projectId,
        mergeRequestIid: proposal.mergeRequestIid,
        sourceHeadSha: proposal.sourceHeadSha,
        runId: proposal.runId,
        findingIds: [...proposal.findingIds].sort(),
        repairCommitSha: proposal.repairCommitSha,
        verifiedReceiptHash: proposal.verifiedReceiptHash,
        lessonPath: proposal.lessonPath,
        lessonContent: proposal.lessonContent,
      }),
    )
    .digest("hex");
}

/** Only additions to explicitly approved TypeScript tests are accepted by this MVP. */
export function validateTestChanges(
  files: TestFileChange[],
  allowedPaths: string[],
): void {
  if (files.length < 1 || files.length > 3)
    throw new Error(
      "A repair must change between one and three approved test files",
    );
  const seen = new Set<string>();
  for (const file of files) {
    if (
      !safePath(file.path) ||
      !/\.(?:test|spec)\.tsx?$/.test(file.path) ||
      !allowedPaths.includes(file.path) ||
      seen.has(file.path)
    )
      throw new Error("Repair path is not an approved unique test file");
    seen.add(file.path);
    if (
      file.before === file.after ||
      !file.after.startsWith(file.before.trimEnd())
    ) {
      throw new Error(
        "Default repair must preserve existing tests and append an assertion",
      );
    }
    const added = file.after.slice(file.before.trimEnd().length);
    if (
      !/\bexpect\s*\(/.test(added) ||
      /\b(?:it|test|describe)\s*\.\s*(?:skip|todo|only)\b|\bcatch\b|\bvi\s*\.|\bjest\s*\.|\bprocess\b|\bglobal(?:This)?\b|\.not\s*\.|toBe(?:Defined|Truthy|Falsy)\s*\(/.test(
        added,
      )
    ) {
      throw new Error(
        "Repair contains a skipped, weakened, or unsafe test pattern",
      );
    }
    if (file.after.length > 100_000)
      throw new Error("Repair exceeds file size budget");
  }
}

/** A project-scoped server adapter. It never takes an arbitrary upstream URL from the browser. */
export class GitLabAdapter {
  readonly projectId: number;
  readonly baseUrl: string;
  private readonly token?: string;
  private readonly tokenType: "private-token" | "bearer";
  private readonly requestFetch: typeof fetch;

  constructor(config: GitLabConfig) {
    const url = new URL(config.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    ) {
      throw new Error(
        "GitLab base URL must be an HTTPS origin without credentials",
      );
    }
    this.baseUrl = url.origin;
    this.projectId = positiveId(config.projectId);
    this.token = config.token;
    this.tokenType = config.tokenType ?? "private-token";
    this.requestFetch = config.fetch ?? fetch;
  }

  private async request<T>(
    path: string,
    options: {
      method?: string;
      body?: unknown;
      raw?: boolean;
      globalUser?: boolean;
    } = {},
  ): Promise<T> {
    if (options.globalUser && !/^\/users\/[1-9]\d*$/.test(path))
      throw new Error(
        "Only the note author user lookup can leave project scope",
      );
    const prefix = options.globalUser
      ? "/api/v4"
      : `/api/v4/projects/${this.projectId}`;
    const response = await this.requestFetch(
      `${this.baseUrl}${prefix}${path}`,
      {
        method: options.method ?? "GET",
        headers: {
          ...(this.token
            ? this.tokenType === "bearer"
              ? { Authorization: `Bearer ${this.token}` }
              : { "PRIVATE-TOKEN": this.token }
            : {}),
          ...(options.body ? { "Content-Type": "application/json" } : {}),
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        redirect: "error",
        signal: AbortSignal.timeout(20_000),
      },
    );
    // Deliberately omit upstream bodies: proxy errors can contain sensitive request details.
    if (!response.ok)
      throw new Error(`GitLab request failed (${response.status})`);
    if (Number(response.headers.get("content-length") ?? 0) > 10_000_000)
      throw new Error("GitLab response exceeds evidence budget");
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    let text = "";
    let bytes = 0;
    if (reader) {
      try {
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > 10_000_000) {
            await reader.cancel();
            throw new Error("GitLab response exceeds evidence budget");
          }
          text += decoder.decode(chunk.value, { stream: true });
        }
        text += decoder.decode();
      } finally {
        reader.releaseLock();
      }
    }
    return (options.raw ? text : JSON.parse(text)) as T;
  }

  async currentMergeRequest(iid: number): Promise<MergeRequest> {
    const mr = await this.request<MergeRequest>(
      `/merge_requests/${positiveId(iid)}`,
    );
    if (
      mr.target_project_id !== this.projectId ||
      mr.source_project_id !== this.projectId
    ) {
      throw new Error(
        "Fork and cross-project merge requests are outside this demonstration scope",
      );
    }
    if (!sha.test(mr.sha) || mr.diff_refs?.head_sha !== mr.sha)
      throw new Error("Current MR revision is not established");
    return mr;
  }

  async currentMember(
    actorId: number,
  ): Promise<{
    id: number;
    access_level: number;
    state?: string;
    expires_at?: string | null;
  }> {
    return this.request(`/members/all/${positiveId(actorId)}`);
  }

  async readMergeRequestNote(iid: number, noteId: number) {
    const note = await this.request<{
      id: number;
      author: { id: number; username: string; bot?: boolean };
      body: string;
      created_at: string;
      updated_at: string;
      system?: boolean;
    }>(`/merge_requests/${positiveId(iid)}/notes/${positiveId(noteId)}`);
    if (
      note.id !== noteId ||
      !note.author ||
      !Number.isSafeInteger(note.author.id) ||
      note.author.id < 1 ||
      note.system === true ||
      note.author.bot === true ||
      typeof note.body !== "string" ||
      !Number.isFinite(Date.parse(note.created_at)) ||
      !Number.isFinite(Date.parse(note.updated_at))
    )
      throw new Error(
        "GitLab note is not an authenticated human approval event",
      );
    // MR note author payloads can omit bot. Establish the account kind separately;
    // absence of a bot flag is not evidence that an approval came from a human account.
    const author = await this.request<{
      id: number;
      bot?: boolean;
      state?: string;
      locked?: boolean;
    }>(`/users/${note.author.id}`, { globalUser: true });
    if (
      author.id !== note.author.id ||
      author.bot !== false ||
      author.state !== "active" ||
      author.locked !== false
    ) {
      throw new Error(
        "Approval author cannot be established as an active unlocked human account",
      );
    }
    return note;
  }

  async readRepositoryFile(path: string, ref: string): Promise<string> {
    if (!safePath(path) || !sha.test(ref))
      throw new Error(
        "Repository file reads require a safe path and exact revision",
      );
    return this.request<string>(
      `/repository/files/${encodeURIComponent(path)}/raw?ref=${ref}`,
      { raw: true },
    );
  }

  async capabilityCheck(iid?: number) {
    const project = await this.request<{
      id: number;
      web_url: string;
      only_allow_merge_if_pipeline_succeeds?: boolean;
    }>("");
    const mr = iid ? await this.currentMergeRequest(iid) : null;
    return {
      projectId: project.id,
      projectUrl: project.web_url,
      requiredSuccessfulPipeline:
        typeof project.only_allow_merge_if_pipeline_succeeds === "boolean"
          ? project.only_allow_merge_if_pipeline_succeeds
          : null,
      mergeRequestReadable: !!mr,
      // Read permission cannot prove write, flow enablement, runner capacity, or tenant schema acceptance.
      duoExecution: "unverified",
      discussionWrite: "unverified",
      artifactAccess: "unverified",
      pipelineStart: "unverified",
    };
  }

  async readArtifact(
    jobId: number,
    artifact = "evidence/latest.json",
  ): Promise<unknown> {
    if (
      ![
        "evidence/latest.json",
        "evidence/repair-receipt.json",
        "evidence/assisted-receipt.json",
      ].includes(artifact)
    )
      throw new Error("Artifact path is not allowlisted");
    const text = await this.request<string>(
      `/jobs/${positiveId(jobId)}/artifacts/${artifact}`,
      { raw: true },
    );
    return JSON.parse(text);
  }

  async readEvidenceArtifact(
    jobId: number,
    expectedHead?: string,
  ): Promise<unknown> {
    const job = await this.request<{
      id: number;
      commit: { id: string };
      pipeline?: { id: number; sha: string };
    }>(`/jobs/${positiveId(jobId)}`);
    if (
      job.id !== jobId ||
      !sha.test(job.commit?.id ?? "") ||
      (expectedHead && job.commit.id !== expectedHead)
    ) {
      throw new Error(
        "Artifact job does not belong to the expected source revision",
      );
    }
    const evidence = (await this.readArtifact(jobId)) as {
      source?: string;
      provenance?: {
        projectId?: string | number;
        headSha?: string;
        pipelineId?: string | number;
        jobId?: string | number;
      };
    };
    if (
      evidence.source !== "gitlab" ||
      Number(evidence.provenance?.projectId) !== this.projectId ||
      evidence.provenance?.headSha !== job.commit.id ||
      Number(evidence.provenance?.jobId) !== jobId ||
      (job.pipeline &&
        (job.pipeline.sha !== job.commit.id ||
          Number(evidence.provenance?.pipelineId) !== job.pipeline.id))
    ) {
      throw new Error(
        "Artifact provenance does not match its project, job, pipeline, and source revision",
      );
    }
    return evidence;
  }

  /**
   * Duo jobs do not inherit arbitrary custom CI variables. Discover a bounded,
   * unambiguous MR/run using the actual checkout SHA and the fixed runtime project.
   */
  async findEvidenceJobForHead(
    checkoutSha: string,
  ): Promise<{ mrIid: number; jobId: number }> {
    if (!sha.test(checkoutSha))
      throw new Error("Evidence discovery requires an exact checkout revision");
    const mergeRequests = await this.request<
      Array<{ iid: number; sha: string; state: string }>
    >("/merge_requests?state=opened&per_page=20&order_by=updated_at&sort=desc");
    const matching = mergeRequests.filter(
      (mr) => mr.sha === checkoutSha && mr.state === "opened",
    );
    if (matching.length !== 1)
      throw new Error(
        "No unique open MR matches the checkout SHA within the 20-MR discovery budget",
      );
    const mr = await this.currentMergeRequest(matching[0]!.iid);
    if (mr.sha !== checkoutSha)
      throw new Error("MR head changed during evidence discovery");
    const pipelines = await this.request<Array<{ id: number; sha: string }>>(
      `/merge_requests/${mr.iid}/pipelines?per_page=5`,
    );
    for (const pipeline of pipelines.filter(
      (candidate) => candidate.sha === checkoutSha,
    )) {
      const jobs = await this.request<
        Array<{ id: number; name: string; status: string }>
      >(`/pipelines/${positiveId(pipeline.id)}/jobs?per_page=100`);
      const job = jobs.find(
        (candidate) =>
          candidate.name === "mutation:review" &&
          candidate.status === "success",
      );
      if (job) return { mrIid: mr.iid, jobId: positiveId(job.id) };
    }
    throw new Error(
      "No completed mutation:review job matches the checkout SHA within the five-pipeline discovery budget",
    );
  }

  /** The single open, same-project MR whose current head is this checkout. */
  async openMergeRequestForHead(checkoutSha: string): Promise<MergeRequest> {
    if (!sha.test(checkoutSha)) throw new Error("MR discovery requires an exact checkout revision");
    const candidates = (await this.request<Array<{ iid: number; sha: string; state: string }>>(
      "/merge_requests?state=opened&per_page=20&order_by=updated_at&sort=desc",
    )).filter((mr) => mr.sha === checkoutSha);
    if (candidates.length !== 1) throw new Error("No unique open MR matches the checkout SHA");
    const mr = await this.currentMergeRequest(candidates[0]!.iid);
    if (mr.sha !== checkoutSha) throw new Error("MR head changed during discovery");
    return mr;
  }

  /** Newest first. Bodies are untrusted data; callers authenticate authors separately. */
  async listMergeRequestNotes(iid: number) {
    const notes = await this.request<Array<{ id: number; body: string; system: boolean; created_at: string; author: { id: number; username: string } }>>(
      `/merge_requests/${positiveId(iid)}/notes?sort=desc&order_by=created_at&per_page=50`,
    );
    return notes.filter((note) => Number.isSafeInteger(note.id) && typeof note.body === "string" && Number.isFinite(Date.parse(note.created_at)) && Number.isSafeInteger(note.author?.id));
  }

  /** Account kind comes from the users API, never from the note payload. */
  async accountKind(userId: number): Promise<"human" | "bot" | "inactive"> {
    const user = await this.request<{ id: number; bot?: boolean; state?: string; locked?: boolean }>(`/users/${positiveId(userId)}`, { globalUser: true });
    if (user.id !== userId || user.state !== "active" || user.locked) return "inactive";
    return user.bot === false ? "human" : "bot";
  }

  /** Server-side time GitLab recorded this head as an MR diff version; git dates are author-controlled. */
  async headPushedAt(iid: number, headSha: string): Promise<number | null> {
    const versions = await this.request<Array<{ head_commit_sha: string; created_at: string }>>(`/merge_requests/${positiveId(iid)}/versions?per_page=20`);
    const version = versions.find((item) => item.head_commit_sha === headSha);
    const time = version ? Date.parse(version.created_at) : NaN;
    return Number.isFinite(time) ? time : null;
  }

  async createMergeRequestNote(iid: number, body: string) {
    return this.request<{ id: number }>(`/merge_requests/${positiveId(iid)}/notes`, { method: "POST", body: { body } });
  }

  /**
   * Commits approved files onto the MR source branch. Every existing file is guarded by its
   * last commit at the approved head, so a concurrent push to those files rejects the commit.
   */
  async commitToMergeRequest(iid: number, expectedHead: string, files: Array<{ path: string; content: string }>, message: string) {
    if (!this.token) throw new Error("A write credential is required");
    const mr = await this.currentMergeRequest(iid);
    if (mr.sha !== expectedHead || mr.state !== "opened") throw new Error("MR head changed or MR closed; mention the agent again for a fresh review");
    const actions = [];
    for (const file of files) {
      if (!safePath(file.path)) throw new Error("Unsafe commit path");
      const meta = await this.request<{ last_commit_id: string }>(`/repository/files/${encodeURIComponent(file.path)}?ref=${expectedHead}`).catch(() => null);
      actions.push(meta
        ? { action: "update", file_path: file.path, content: file.content, last_commit_id: meta.last_commit_id }
        : { action: "create", file_path: file.path, content: file.content });
    }
    if ((await this.currentMergeRequest(iid)).sha !== expectedHead) throw new Error("MR head changed during commit preparation");
    return this.request<{ id: string; web_url: string }>("/repository/commits", {
      method: "POST",
      body: { branch: mr.source_branch, commit_message: message, actions },
    });
  }

  async publishFindings(
    iid: number,
    expectedHead: string,
    summary: string,
    findings: FindingComment[],
  ) {
    const mr = await this.currentMergeRequest(iid);
    if (mr.sha !== expectedHead)
      throw new Error("Stale evidence: MR head changed");
    const versions = await this.request<DiffVersion[]>(
      `/merge_requests/${iid}/versions?per_page=1`,
    );
    const latest = versions[0];
    let diffs: DiffFile[] = [];
    if (latest?.head_commit_sha === expectedHead) {
      const version = await this.request<DiffVersion>(
        `/merge_requests/${iid}/versions/${positiveId(latest.id)}`,
      );
      if (version.head_commit_sha === expectedHead) diffs = version.diffs ?? [];
    }
    const inline: Array<{ finding: FindingComment; file: DiffFile }> = [];
    const fallback: FindingComment[] = [];
    for (const finding of findings) {
      const file = diffs.find(
        (item) =>
          item.new_path === finding.path &&
          !item.deleted_file &&
          !item.too_large &&
          !item.collapsed,
      );
      if (
        inline.length < 3 &&
        file &&
        finding.line &&
        addedLines(file.diff).has(finding.line)
      )
        inline.push({ finding, file });
      else fallback.push(finding);
    }
    const body = [
      summary,
      `Evidence revision: \`${expectedHead}\`.`,
      ...fallback.map((item) => `### ${item.id}\n${item.body}`),
    ].join("\n\n");
    const posted: unknown[] = [
      await this.request(`/merge_requests/${iid}/discussions`, {
        method: "POST",
        body: { body },
      }),
    ];
    for (const { finding, file } of inline) {
      // Check head before every write, since comment publication takes multiple requests.
      if ((await this.currentMergeRequest(iid)).sha !== expectedHead)
        throw new Error("MR head changed during comment publication");
      posted.push(
        await this.request(`/merge_requests/${iid}/discussions`, {
          method: "POST",
          body: {
            body: `${finding.body}\n\nEvidence revision: \`${expectedHead}\`.`,
            position: {
              position_type: "text",
              base_sha: latest.base_commit_sha,
              start_sha: latest.start_commit_sha,
              head_sha: expectedHead,
              old_path: file.old_path,
              new_path: file.new_path,
              new_line: finding.line,
            },
          },
        }),
      );
    }
    return posted;
  }

  /**
   * Creates an isolated repair branch at the exact approved parent. GitLab's commits API
   * offers no branch-wide compare-and-swap for an existing MR source branch. Keeping
   * the repair on a fresh branch prevents a concurrent push from changing its parent.
   * Moving/merging this branch into the human's MR remains a separate human action.
   */
  async commitApprovedTests(
    proposal: ExactPatchProposal,
    approval: ExactPatchApproval,
    allowedPaths: string[],
    ledger: ApprovalLedger,
    now = new Date(),
  ) {
    if (!this.token)
      throw new Error("A server-side write credential is required");
    if (
      proposal.projectId !== this.projectId ||
      approval.projectId !== this.projectId
    )
      throw new Error("Approval project mismatch");
    if (
      !sha.test(proposal.sourceHeadSha) ||
      proposal.patchHash !== exactPatchHash(proposal)
    )
      throw new Error("Proposal hash does not match exact patch");
    validateTestChanges(proposal.files, allowedPaths);
    if (
      approval.action !== "apply" ||
      !approval.eventId ||
      approval.proposalId !== proposal.id ||
      approval.mergeRequestIid !== proposal.mergeRequestIid ||
      approval.runId !== proposal.runId ||
      approval.sourceHeadSha !== proposal.sourceHeadSha ||
      approval.patchHash !== proposal.patchHash ||
      !equalSet(approval.findingIds, proposal.findingIds)
    )
      throw new Error("Approval does not authorize this exact proposal");
    const start = Date.parse(approval.approvedAt),
      end = Date.parse(approval.expiresAt);
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > now.getTime() ||
      end <= now.getTime() ||
      end <= start ||
      end - start > 3_600_000
    ) {
      throw new Error(
        "Approval is expired or outside the one-hour validity budget",
      );
    }
    const member = await this.currentMember(approval.actorId);
    const membershipExpiry = member.expires_at
      ? Date.parse(`${member.expires_at}T23:59:59Z`)
      : null;
    if (
      member.id !== approval.actorId ||
      !Number.isInteger(member.access_level) ||
      member.access_level < 40 ||
      (member.state && member.state !== "active") ||
      (membershipExpiry !== null &&
        (!Number.isFinite(membershipExpiry) ||
          membershipExpiry < now.getTime()))
    )
      throw new Error("Actor is not currently authorized");
    const mr = await this.currentMergeRequest(proposal.mergeRequestIid);
    if (mr.state !== "opened" || mr.sha !== proposal.sourceHeadSha)
      throw new Error("Stale approval: MR head changed or MR closed");
    for (const file of proposal.files) {
      const original = await this.request<string>(
        `/repository/files/${encodeURIComponent(file.path)}/raw?ref=${proposal.sourceHeadSha}`,
        { raw: true },
      );
      if (original !== file.before)
        throw new Error(
          "Approved test base contents differ from the recorded revision",
        );
    }
    if (
      (await this.currentMergeRequest(proposal.mergeRequestIid)).sha !==
      proposal.sourceHeadSha
    )
      throw new Error("MR head changed before commit");
    if (!(await ledger.reserve(approval.eventId)))
      throw new Error("Approval event was already consumed");
    // A fresh unpredictable suffix avoids an existing branch causing start_sha to be ignored.
    const branch = `mutant-review/${proposal.patchHash.slice(0, 20)}-${randomUUID()}`;
    try {
      const commit = await this.request<{
        id: string;
        parent_ids: string[];
        web_url: string;
      }>(`/repository/commits`, {
        method: "POST",
        body: {
          branch,
          start_sha: proposal.sourceHeadSha,
          commit_message: `test: repair ${proposal.id}`,
          actions: proposal.files.map((file) => ({
            action: "update",
            file_path: file.path,
            content: file.after,
          })),
        },
      });
      if (
        commit.parent_ids.length !== 1 ||
        commit.parent_ids[0] !== proposal.sourceHeadSha
      )
        throw new Error("Repair parent revision mismatch");
      await ledger.record(approval.eventId, "committed", commit.id);
      return {
        ...commit,
        branch,
        sourceBranchUpdated: false,
        next: "Human review of the isolated repair branch",
      };
    } catch (error) {
      await ledger.record(approval.eventId, "rejected");
      throw error;
    }
  }

  /** Separate approval stores a verified lesson on its own branch; it never changes the verified repair commit. */
  async commitApprovedLesson(
    proposal: ExactLessonProposal,
    approval: ExactPatchApproval,
    ledger: ApprovalLedger,
    now = new Date(),
  ) {
    if (!this.token)
      throw new Error("A server-side write credential is required");
    if (
      proposal.projectId !== this.projectId ||
      approval.projectId !== this.projectId ||
      proposal.patchHash !== exactLessonHash(proposal)
    )
      throw new Error("Lesson proposal project or exact content hash mismatch");
    if (
      !sha.test(proposal.sourceHeadSha) ||
      !sha.test(proposal.repairCommitSha) ||
      !/^[a-f0-9]{64}$/.test(proposal.verifiedReceiptHash) ||
      !/^\.mutant-review\/lessons\/[a-zA-Z0-9_-]+\.json$/.test(
        proposal.lessonPath,
      ) ||
      proposal.lessonContent.length > 100_000
    ) {
      throw new Error(
        "Lesson proposal has an invalid scope or verification reference",
      );
    }
    const lesson = JSON.parse(proposal.lessonContent) as Record<
      string,
      unknown
    >;
    const receipt = lesson.repairReceipt as
      { hash?: string; repairCommitSha?: string; status?: string } | undefined;
    if (
      lesson.state !== "candidate" ||
      lesson.approval != null ||
      typeof lesson.id !== "string" ||
      !lesson.id ||
      typeof lesson.recommendation !== "string" ||
      !lesson.recommendation ||
      proposal.lessonPath !==
        `.mutant-review/lessons/${String(lesson.id)}.json` ||
      receipt?.hash !== proposal.verifiedReceiptHash ||
      receipt?.repairCommitSha !== proposal.repairCommitSha ||
      receipt?.status !== "passed"
    ) {
      throw new Error(
        "Only a specific verified candidate lesson can be approved",
      );
    }
    if (
      approval.action !== "learn" ||
      !approval.eventId ||
      approval.proposalId !== proposal.id ||
      approval.mergeRequestIid !== proposal.mergeRequestIid ||
      approval.runId !== proposal.runId ||
      approval.sourceHeadSha !== proposal.sourceHeadSha ||
      approval.patchHash !== proposal.patchHash ||
      !equalSet(approval.findingIds, proposal.findingIds)
    )
      throw new Error("Approval does not authorize this exact lesson");
    const start = Date.parse(approval.approvedAt),
      end = Date.parse(approval.expiresAt);
    if (
      !Number.isFinite(now.getTime()) ||
      !Number.isFinite(start) ||
      !Number.isFinite(end) ||
      start > now.getTime() ||
      end <= now.getTime() ||
      end <= start ||
      end - start > 3_600_000
    )
      throw new Error("Lesson approval expired or outside validity budget");
    const member = await this.currentMember(approval.actorId);
    const expiry = member.expires_at
      ? Date.parse(`${member.expires_at}T23:59:59Z`)
      : null;
    if (
      member.id !== approval.actorId ||
      !Number.isInteger(member.access_level) ||
      member.access_level < 40 ||
      (member.state && member.state !== "active") ||
      (expiry !== null && (!Number.isFinite(expiry) || expiry < now.getTime()))
    ) {
      throw new Error("Actor is not currently authorized to approve lessons");
    }
    const mr = await this.currentMergeRequest(proposal.mergeRequestIid);
    if (mr.state !== "opened" || mr.sha !== proposal.sourceHeadSha)
      throw new Error("Stale lesson approval: MR head changed");
    // Establish that the recorded verified revision actually exists in this project.
    const repair = await this.request<{ id: string }>(
      `/repository/commits/${proposal.repairCommitSha}`,
    );
    if (repair.id !== proposal.repairCommitSha)
      throw new Error("Verified repair commit cannot be established");
    if (!(await ledger.reserve(approval.eventId)))
      throw new Error("Lesson approval event was already consumed");
    const branch = `mutant-review/lesson-${proposal.patchHash.slice(0, 16)}-${randomUUID()}`;
    const approvedLesson = {
      ...lesson,
      state: "approved",
      status: "approved",
      verified: true,
      approvedBy: String(approval.actorId),
      approvedAt: approval.approvedAt,
      receiptId: proposal.verifiedReceiptHash,
      approvedContentHash: proposal.patchHash,
      approval: {
        actor: approval.actorId,
        approvedAt: approval.approvedAt,
        noteEventId: approval.eventId,
      },
    };
    try {
      const commit = await this.request<{
        id: string;
        parent_ids: string[];
        web_url: string;
      }>(`/repository/commits`, {
        method: "POST",
        body: {
          branch,
          start_sha: proposal.repairCommitSha,
          commit_message: `docs: save verified lesson ${String(lesson.id)}`,
          actions: [
            {
              action: "create",
              file_path: proposal.lessonPath,
              content: JSON.stringify(approvedLesson, null, 2) + "\n",
            },
          ],
        },
      });
      if (
        commit.parent_ids.length !== 1 ||
        commit.parent_ids[0] !== proposal.repairCommitSha
      )
        throw new Error("Lesson commit parent differs from verified repair");
      await ledger.record(approval.eventId, "committed", commit.id);
      return {
        ...commit,
        branch,
        lesson: approvedLesson,
        sourceBranchUpdated: false,
      };
    } catch (error) {
      await ledger.record(approval.eventId, "rejected");
      throw error;
    }
  }

  async ensureMergeRequestPipeline(
    iid: number,
    expectedHead: string,
  ): Promise<PipelineProvisioning> {
    const mr = await this.currentMergeRequest(iid);
    if (mr.sha !== expectedHead)
      throw new Error("Cannot start verification for a stale revision");
    const existing = await this.request<PipelineReference[]>(
      `/merge_requests/${iid}/pipelines?per_page=100`,
    );
    const matching = newestPipelineAtHead(existing, expectedHead);
    if (matching) {
      const observed = pipelineResult(matching, expectedHead, "reused");
      if (reusablePipelineStates.has(observed.status)) return observed;
    }
    // A terminal pre-execution failure (for example account verification) must not
    // masquerade as a pending run. Make one fresh attempt, without a retry loop.
    const created = await this.request<PipelineReference>(
      `/merge_requests/${iid}/pipelines`,
      { method: "POST" },
    );
    return pipelineResult(created, expectedHead, "created", matching?.id);
  }

  /** Starting a pipeline records execution intent. Its success and repair checks remain separate evidence. */
  async ensureBranchPipeline(
    branch: string,
    expectedHead: string,
  ): Promise<PipelineProvisioning> {
    if (!branch || /[\0\r\n]/.test(branch) || !sha.test(expectedHead))
      throw new Error("Invalid branch pipeline revision");
    const current = await this.request<{ commit: { id: string } }>(
      `/repository/branches/${encodeURIComponent(branch)}`,
    );
    if (current.commit?.id !== expectedHead)
      throw new Error("Repair branch head changed before verification");
    const existing = await this.request<PipelineReference[]>(
      `/pipelines?ref=${encodeURIComponent(branch)}&sha=${expectedHead}&per_page=100`,
    );
    const matching = newestPipelineAtHead(existing, expectedHead);
    if (matching) {
      const observed = pipelineResult(matching, expectedHead, "reused");
      if (reusablePipelineStates.has(observed.status)) return observed;
    }
    const pipeline = await this.request<PipelineReference>(`/pipeline`, {
      method: "POST",
      body: { ref: branch },
    });
    return pipelineResult(pipeline, expectedHead, "created", matching?.id);
  }

  async readBranchHead(branch: string): Promise<string> {
    if (!branch || /[\0\r\n]/.test(branch)) throw new Error("Invalid branch");
    const result = await this.request<{ commit: { id: string } }>(
      `/repository/branches/${encodeURIComponent(branch)}`,
    );
    if (!sha.test(result.commit?.id ?? ""))
      throw new Error("Branch revision cannot be established");
    return result.commit.id;
  }
}

function addedLines(diff: string): Set<number> {
  const lines = new Set<number>();
  let current = 0;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) current = Number(hunk[1]);
    else if (line.startsWith("+") && !line.startsWith("+++")) {
      lines.add(current);
      current++;
    } else if (line.startsWith(" ")) current++;
  }
  return lines;
}
