/**
 * Mutant Review as an MCP server (stdio), so a coding agent checks its own tests before it pushes.
 *
 *   GitLab Duo Agentic Chat (IDE, CLI) and the Software Development Flow read .gitlab/duo/mcp.json;
 *   Claude Code reads .mcp.json. Both start: node node_modules/tsx/dist/cli.mjs packages/cli/src/mcp.ts
 *
 * Tools: mutation_check (changed-line mutation review of the working tree) and verify_test (a draft
 * test is kept only if it passes on the code and fails on the mutant). Read-only: nothing is committed.
 * A dependency-free JSON-RPC 2.0 loop over newline-delimited stdio, per the MCP stdio transport.
 */
import { execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import { formatPrecheck, precheck, verifyTest } from './precheck.js';

export const PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];

export interface McpTool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: Record<string, boolean>;
  run(args: Record<string, unknown>): Promise<{ text: string; structured?: Record<string, unknown>; isError?: boolean }>;
}

type JsonRpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };
type Reply = { jsonrpc: '2.0'; id: string | number | null; result?: unknown; error?: { code: number; message: string } };

const INSTRUCTIONS = 'Mutant Review mutation-tests only the lines you changed, and checks that your test edits did not stop existing tests noticing behaviour they noticed on the base branch. Before you finish a change that adds or edits TypeScript or tests, call mutation_check. For each finding, draft one test whose expected value comes from the written requirement, call verify_test, and add the test to the file only when it is verified. Never loosen, delete or skip a test, or change the evaluator, to make a check pass: mutation_check reports it as lost protection and the merge gate blocks it.';

/** One JSON-RPC message in, at most one reply out. Tool calls run one at a time (they share the working tree). */
export function createServer(tools: McpTool[], version = '0.1.0') {
  let queue: Promise<unknown> = Promise.resolve();
  const serial = <T>(work: () => Promise<T>): Promise<T> => { const next = queue.then(work, work); queue = next.catch(() => undefined); return next; };
  return async function handle(message: JsonRpc): Promise<Reply | null> {
    if (!message || typeof message !== 'object' || Array.isArray(message)) {
      return { jsonrpc: '2.0', id: null, error: { code: -32600, message: 'Invalid request' } };
    }
    const id = message.id ?? null;
    const ok = (result: unknown): Reply => ({ jsonrpc: '2.0', id, result });
    const fail = (code: number, text: string): Reply => ({ jsonrpc: '2.0', id, error: { code, message: text } });
    if (message.jsonrpc !== '2.0' || typeof message.method !== 'string') return message.id === undefined ? null : fail(-32600, 'Invalid request');
    if (message.id === undefined) return null; // Notifications (initialized, cancelled) need no reply.
    switch (message.method) {
      case 'initialize': {
        const requested = String(message.params?.protocolVersion ?? '');
        return ok({ protocolVersion: PROTOCOL_VERSIONS.includes(requested) ? requested : PROTOCOL_VERSIONS[0], capabilities: { tools: { listChanged: false } }, serverInfo: { name: 'mutant-review', title: 'Mutant Review', version }, instructions: INSTRUCTIONS });
      }
      case 'ping':
        return ok({});
      case 'tools/list':
        return ok({ tools: tools.map(({ run: _run, ...tool }) => tool) });
      case 'tools/call': {
        const tool = tools.find((item) => item.name === message.params?.name);
        if (!tool) return fail(-32602, `Unknown tool: ${String(message.params?.name)}`);
        const args = (message.params?.arguments ?? {}) as Record<string, unknown>;
        try {
          const output = await serial(() => tool.run(args));
          return ok({ content: [{ type: 'text', text: output.text }], ...(output.structured ? { structuredContent: output.structured } : {}), isError: output.isError ?? false });
        } catch (error) {
          return ok({ content: [{ type: 'text', text: `Mutant Review could not run ${tool.name}: ${error instanceof Error ? error.message : String(error)}` }], isError: true });
        }
      }
      default:
        return fail(-32601, `Method not found: ${message.method}`);
    }
  };
}

const baseArgs = z.object({ base: z.string().max(200).optional() }).strict();

export const mutantReviewTools: McpTool[] = [
  {
    name: 'mutation_check',
    title: 'Check my changed lines',
    description: 'Mutation-test only the TypeScript lines changed since the base (default: where this branch left the default branch; uncommitted edits included), and check that edited, moved or deleted tests still notice every change they noticed on the base (lost protection). Returns the changes no test would notice, the code around each, the requirement docs, and the testing rules this repository has learned. Run it before you push. Read-only.',
    inputSchema: { type: 'object', properties: { base: { type: 'string', description: 'Optional branch, tag or commit to compare against.' } }, additionalProperties: false },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run(args) {
      const result = await precheck(baseArgs.parse(args));
      return {
        text: formatPrecheck(result),
        structured: { status: result.status, score: result.score, counts: result.counts, findings: result.findings.map(({ rank, path, line, original, replacement, operator, why, testPath, origin }) => ({ rank, path, line, original, replacement, operator, why, testPath, origin: origin ?? 'changed-line' })),
          protection: result.protection ? { status: result.protection.status, reason: result.protection.reason, lost: result.protection.lost.map(({ path, line, original, replacement, caughtBy }) => ({ path, line, original, replacement, caughtBy: caughtBy.map(({ name, file, fate }) => ({ name, file, fate })) })) } : null,
          footprintG: result.footprint?.actual.sciG ?? null },
      };
    },
  },
  {
    name: 'verify_test',
    title: 'Verify a draft test against its mutant',
    description: 'Executes one draft test for a finding from the last mutation_check: verified only if it passes on the current code AND fails when the mutation is applied. The test file is restored afterwards, so add the test yourself only when it is verified. Use a single it(...) block with exact-value assertions, no mocks.',
    inputSchema: {
      type: 'object',
      properties: {
        finding: { type: 'integer', minimum: 1, maximum: 3, description: 'Finding number from mutation_check.' },
        testPath: { type: 'string', description: 'The .test.ts file the test belongs in (mutation_check suggests one).' },
        test: { type: 'string', description: "A single it('literal name', () => { ... }) block." },
        imports: { type: 'array', items: { type: 'string' }, maxItems: 5, description: 'Named imports from relative modules or vitest that the file lacks.' },
        expectedFrom: { type: 'string', description: 'Where the expected value comes from (contract, doc comment).' },
      },
      required: ['finding', 'testPath', 'test'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: false },
    async run(args) {
      const result = await verifyTest(args);
      return {
        text: result.verdict === 'verified'
          ? `Verified: the test passes on the current code and fails on mutant ${result.finding}. Add it to ${result.testPath}.`
          : `Rejected: ${result.reason}. Do not add this test; it would not notice the change. Pick an input where the original and the mutation behave differently.`,
        structured: result,
      };
    },
  },
];

/** Reads newline-delimited JSON-RPC from stdin and writes replies to stdout. Logs go to stderr only. */
export async function serve(tools = mutantReviewTools) {
  process.chdir(execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim());
  console.log = console.error;
  const handle = createServer(tools);
  const write = (reply: Reply | null) => { if (reply) process.stdout.write(`${JSON.stringify(reply)}\n`); };
  for await (const line of createInterface({ input: process.stdin, crlfDelay: Infinity })) {
    if (!line.trim()) continue;
    let message: JsonRpc;
    try { message = JSON.parse(line); } catch { write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }); continue; }
    // Replies may finish out of order; tool calls are serialised inside the handler.
    void handle(message).then(write, (error) => write({ jsonrpc: '2.0', id: message.id ?? null, error: { code: -32603, message: String(error) } }));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) void serve();
