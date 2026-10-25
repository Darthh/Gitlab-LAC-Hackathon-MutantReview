import { describe, expect, it, vi } from "vitest";
import { GitLabAdapter } from "./index.js";

const head = "a".repeat(40);
const mr = {
  iid: 2,
  sha: head,
  source_branch: "feature/shipping",
  source_project_id: 7,
  target_project_id: 7,
  state: "opened",
  web_url: "https://gitlab.example/team/shop/-/merge_requests/2",
  diff_refs: { head_sha: head, base_sha: "b".repeat(40), start_sha: "c".repeat(40) },
};
const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });
type Route = (url: string, options?: RequestInit) => Response | undefined;
const adapter = (route: Route, token: string | null = "server-only") => {
  const fake = vi.fn(async (input: string | URL | Request, options?: RequestInit) => route(String(input), options) ?? json(mr));
  return { fake, api: new GitLabAdapter({ baseUrl: "https://gitlab.example", projectId: 7, token: token ?? undefined, fetch: fake }) };
};

describe("project-restricted GitLab adapter", () => {
  it("resolves the token owner's identity from the authenticated user endpoint", async () => {
    const { api, fake } = adapter((url) => url.endsWith('/api/v4/user') ? json({ id: 42 }) : undefined);
    expect(await api.currentUserId()).toBe(42);
    expect(fake.mock.calls[0]?.[0]).toBe('https://gitlab.example/api/v4/user');
    expect(fake.mock.calls[0]?.[1]?.headers).toMatchObject({ 'PRIVATE-TOKEN': 'server-only' });
  });
  it("rejects invalid identities instead of trusting comment authors", async () => {
    for (const id of [0, -1, '42', null]) {
      await expect(adapter(() => json({ id })).api.currentUserId()).rejects.toThrow('Expected a positive GitLab identifier');
    }
  });
  it("rejects credential-bearing or non-HTTPS base URLs", () => {
    for (const baseUrl of ["http://gitlab.example", "https://user:secret@gitlab.example", "https://gitlab.example/api"]) {
      expect(() => new GitLabAdapter({ baseUrl, projectId: 7 })).toThrow();
    }
  });
  it("rejects cross-project and fork MRs", async () => {
    const { api } = adapter(() => json({ ...mr, source_project_id: 8 }));
    await expect(api.currentMergeRequest(2)).rejects.toThrow("cross-project");
  });
  it("does not expose upstream error text or follow redirects", async () => {
    const { api, fake } = adapter(() => new Response("secret=do-not-leak", { status: 403 }));
    await expect(api.currentMergeRequest(2)).rejects.toThrow("GitLab request failed (403)");
    expect((fake.mock.calls[0]?.[1] as RequestInit).redirect).toBe("error");
  });
  it("enforces the response budget while streaming when content length is omitted", async () => {
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({ start: (controller) => controller.enqueue(new Uint8Array(10_000_001)), cancel: () => { cancelled = true; } });
    const { api } = adapter(() => new Response(body));
    await expect(api.currentMergeRequest(2)).rejects.toThrow("evidence budget");
    expect(cancelled).toBe(true);
  });
  it("sends the Duo flow OAuth token as a bearer header, never in the URL", async () => {
    const fake = vi.fn(async (_input: string | URL | Request, _options?: RequestInit) => json(mr));
    const api = new GitLabAdapter({ baseUrl: "https://gitlab.example", projectId: 7, token: "fixture-oauth-token", tokenType: "bearer", fetch: fake });
    await api.currentMergeRequest(2);
    expect(fake.mock.calls[0]?.[0]).toBe("https://gitlab.example/api/v4/projects/7/merge_requests/2");
    expect(fake.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer fixture-oauth-token" });
    expect(fake.mock.calls[0]?.[1]?.headers).not.toHaveProperty("PRIVATE-TOKEN");
  });
});

describe("merge request discovery and comments", () => {
  it("finds the single open MR at the checkout and refuses ambiguity", async () => {
    const list = [{ iid: 2, sha: head, state: "opened" }, { iid: 3, sha: "d".repeat(40), state: "opened" }];
    expect((await adapter((url) => (url.includes("/merge_requests?") ? json(list) : undefined)).api.openMergeRequestForHead(head)).iid).toBe(2);
    const twice = [...list, { iid: 4, sha: head, state: "opened" }];
    await expect(adapter((url) => (url.includes("/merge_requests?") ? json(twice) : undefined)).api.openMergeRequestForHead(head)).rejects.toThrow("No unique open MR");
  });
  it("limits inline comments to three and falls back when diff coordinates cannot be mapped", async () => {
    const writes: Record<string, unknown>[] = [];
    const { api } = adapter((url, options) => {
      if (options?.method === "POST") { writes.push(JSON.parse(String(options.body))); return json({ id: String(writes.length) }); }
      if (url.endsWith("/versions?per_page=1")) return json([{ id: 5, head_commit_sha: head, base_commit_sha: "b".repeat(40), start_commit_sha: "c".repeat(40) }]);
      if (url.endsWith("/versions/5")) return json({ id: 5, head_commit_sha: head, diffs: [{ old_path: "src/old.ts", new_path: "src/shipping.ts", diff: "@@ -1,1 +1,4 @@\n+one\n+two\n+three\n+four" }] });
      return undefined;
    });
    await api.publishFindings(2, head, "Mutation review", [1, 2, 3, 4, 99].map((line) => ({ id: `gap-${line}`, body: `Finding ${line}`, path: "src/shipping.ts", line })));
    expect(writes).toHaveLength(4);
    expect(writes.filter((item) => item.position)).toHaveLength(3);
    expect(writes[0]?.body).toContain("Finding 4");
    expect(writes[0]?.body).toContain("Finding 99");
    expect(writes[1]?.position).toMatchObject({ old_path: "src/old.ts", new_path: "src/shipping.ts", head_sha: head, new_line: 1 });
  });
  it("rejects stale findings before posting anything", async () => {
    const { api, fake } = adapter(() => json({ ...mr, sha: "d".repeat(40), diff_refs: { ...mr.diff_refs, head_sha: "d".repeat(40) } }));
    await expect(api.publishFindings(2, head, "summary", [])).rejects.toThrow("Stale evidence");
    expect(fake).toHaveBeenCalledTimes(1);
  });
  it("uses GitLab's push time for a head, not author-controlled commit dates", async () => {
    const { api } = adapter((url) => (url.includes("/versions") ? json([{ head_commit_sha: head, created_at: "2026-10-24T12:00:00Z" }]) : undefined));
    expect(await api.headPushedAt(2, head)).toBe(Date.parse("2026-10-24T12:00:00Z"));
    expect(await api.headPushedAt(2, "e".repeat(40))).toBeNull();
  });
  it("only leaves project scope for user lookups", async () => {
    const { api, fake } = adapter((url) => (url.endsWith("/api/v4/users/9") ? json({ id: 9, bot: false, state: "active", locked: false }) : undefined));
    expect(await api.accountKind(9)).toBe("human");
    expect(fake.mock.calls[0]?.[0]).toBe("https://gitlab.example/api/v4/users/9");
  });
});

describe("approved commits and follow-up issues", () => {
  it("guards every updated file with its last commit and rechecks the head", async () => {
    const writes: Record<string, unknown>[] = [];
    const { api } = adapter((url, options) => {
      if (options?.method === "POST") { writes.push(JSON.parse(String(options.body))); return json({ id: "f".repeat(40), web_url: "https://gitlab.example/c" }); }
      if (url.includes("/repository/files/src%2Fshipping.test.ts")) return json({ last_commit_id: "9".repeat(40) });
      if (url.includes("/repository/files/")) return json({ message: "404" }, 404);
      return undefined;
    });
    await api.commitToMergeRequest(2, head, [{ path: "src/shipping.test.ts", content: "a" }, { path: "AGENTS.md", content: "b" }], "test: approved");
    expect(writes[0]).toMatchObject({ branch: "feature/shipping", actions: [
      { action: "update", file_path: "src/shipping.test.ts", last_commit_id: "9".repeat(40) },
      { action: "create", file_path: "AGENTS.md" },
    ] });
  });
  it("refuses to commit when the MR moved, unsafe paths, or no write token", async () => {
    await expect(adapter(() => undefined).api.commitToMergeRequest(2, "e".repeat(40), [], "x")).rejects.toThrow("MR head changed");
    await expect(adapter(() => undefined).api.commitToMergeRequest(2, head, [{ path: "../escape", content: "x" }], "x")).rejects.toThrow("Unsafe commit path");
    await expect(adapter(() => undefined, null).api.commitToMergeRequest(2, head, [], "x")).rejects.toThrow("write credential");
  });
  it("reuses only a test-debt issue its own account opened, so the title cannot be squatted", async () => {
    let created = 0;
    const issues = [{ iid: 1, title: "Test debt: x", web_url: "https://gitlab.example/i/1", author: { id: 666 } }];
    const route: Route = (url, options) => {
      if (url.endsWith("/api/v4/user")) return json({ id: 42 });
      if (options?.method === "POST") { created++; return json({ iid: 2, title: "Test debt: x", web_url: "https://gitlab.example/i/2" }); }
      if (url.includes("/issues?")) return json(issues);
      return undefined;
    };
    expect((await adapter(route).api.ensureIssue("Test debt: x", "d", ["test-debt"])).iid).toBe(2);
    issues.push({ iid: 3, title: "Test debt: x", web_url: "https://gitlab.example/i/3", author: { id: 42 } });
    expect((await adapter(route).api.ensureIssue("Test debt: x", "d", ["test-debt"])).iid).toBe(3);
    expect(created).toBe(1);
  });
});
