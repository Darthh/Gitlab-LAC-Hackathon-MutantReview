
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
const sha = /^[a-f0-9]{40}$/i;
const safePath = (path: string) =>
  !!path &&
  !path.includes("\\") &&
  !path.startsWith("/") &&
  !path.split("/").some((part) => part === ".." || part === "." || !part) &&
  !/[\0\r\n]/.test(path);
const positiveId = (value: number) => {
  if (!Number.isSafeInteger(value) || value < 1)
    throw new Error("Expected a positive GitLab identifier");
  return value;
};
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
      globalUser?: boolean;
    } = {},
  ): Promise<T> {
    if (options.globalUser && !/^\/users\/[1-9]\d*$|^\/user$/.test(path))
      throw new Error(
        "Only user lookups can leave project scope",
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
    return JSON.parse(text) as T;
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

  /** Effective access of this token on the project. For a Duo flow this is the triggering person's composite identity. */
  async tokenAccessLevel(): Promise<number | null> {
    const project = await this.request<{ permissions?: { project_access?: { access_level: number } | null; group_access?: { access_level: number } | null } }>("");
    const levels = [project.permissions?.project_access?.access_level, project.permissions?.group_access?.access_level].filter((level): level is number => Number.isSafeInteger(level));
    return levels.length ? Math.max(...levels) : null;
  }

  /** The authenticated token owner, rather than an identity claimed by a comment. */
  async currentUserId(): Promise<number> {
    const me = await this.request<{ id: number }>("/user", { globalUser: true });
    return positiveId(me?.id);
  }

  /** Idempotent per title, but only issues this token's own user opened count, so nobody can squat the title. */
  async ensureIssue(title: string, description: string, labels: string[]) {
    const actorId = await this.currentUserId();
    const open = await this.request<Array<{ iid: number; title: string; web_url: string; author: { id: number } }>>(`/issues?state=opened&search=${encodeURIComponent(title)}&in=title&per_page=20`);
    const existing = open.find((issue) => issue.title === title && issue.author?.id === actorId);
    if (existing) return existing;
    return this.request<{ iid: number; title: string; web_url: string }>("/issues", { method: "POST", body: { title, description, labels: labels.join(",") } });
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
      // The summary already carries every finding; a refused diff position must not abort the rest.
      try {
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
      } catch (error) {
        posted.push({ inlineFailed: finding.id, reason: (error as Error).message });
      }
    }
    return posted;
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
