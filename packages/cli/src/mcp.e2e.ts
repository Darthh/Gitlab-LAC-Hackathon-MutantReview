// Real Stryker through the real MCP stdio server: an agent's uncommitted edit is mutation-checked
// before it is pushed, and its draft tests are verified against the mutant. Restores every file.
import { spawn } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { createInterface } from 'node:readline';
import { describe, expect, it } from 'vitest';

const source = 'packages/demo-domain/src/shipping.ts';
const testPath = 'packages/demo-domain/src/shipping.test.ts';

function client() {
  const child = spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'packages/cli/src/mcp.ts'], { stdio: ['pipe', 'pipe', 'inherit'] });
  const pending = new Map<number, (reply: { result?: Record<string, unknown>; error?: unknown }) => void>();
  const stdout: string[] = [];
  createInterface({ input: child.stdout }).on('line', (line) => {
    stdout.push(line);
    const reply = JSON.parse(line);
    pending.get(reply.id)?.(reply);
  });
  let next = 1;
  const request = (method: string, params: Record<string, unknown> = {}) => new Promise<{ result?: Record<string, unknown>; error?: unknown }>((resolve) => {
    const id = next++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const notify = (method: string) => child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method })}\n`);
  return { request, notify, stdout, close: () => child.stdin.end() };
}

describe('pre-push check over MCP', () => {
  it('finds the unnoticed change in an uncommitted edit, keeps the killing test and rejects the useless one', async () => {
    const original = await readFile(source, 'utf8');
    const tests = await readFile(testPath, 'utf8');
    const mcp = client();
    try {
      // An agent edits the shipping rule (same behaviour, new line) without touching the tests.
      await writeFile(source, original.replace('? 0 : 500;', '? 0 : 5_00;'));
      const init = await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
      expect(init.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'mutant-review' } });
      mcp.notify('notifications/initialized');
      const tools = await mcp.request('tools/list');
      expect((tools.result!.tools as { name: string }[]).map((tool) => tool.name)).toEqual(['mutation_check', 'verify_test']);

      const check = await mcp.request('tools/call', { name: 'mutation_check', arguments: { base: 'HEAD' } });
      const structured = check.result!.structuredContent as { status: string; findings: { rank: number; replacement: string; testPath: string }[] };
      expect(check.result!.isError).toBe(false);
      expect(structured.status).toBe('gaps');
      expect(structured.findings[0]).toMatchObject({ rank: 1, replacement: 'subtotalCents > 10_000', testPath });
      const text = (check.result!.content as { text: string }[])[0]!.text;
      expect(text).toContain('call verify_test');
      expect(text).toContain('SHIPPING-001');

      const kept = await mcp.request('tools/call', { name: 'verify_test', arguments: { finding: 1, testPath, test: "it('ships free at exactly $100 (SHIPPING-001)', () => {\n  expect(shippingFee(10_000)).toBe(0);\n});" } });
      expect(kept.result!.structuredContent).toMatchObject({ verdict: 'verified' });
      const useless = await mcp.request('tools/call', { name: 'verify_test', arguments: { finding: 1, testPath, test: "it('ships free for big orders', () => {\n  expect(shippingFee(10_001)).toBe(0);\n});" } });
      expect(useless.result!.structuredContent).toMatchObject({ verdict: 'rejected', reason: expect.stringContaining('passes on the mutant too') });
      expect(await readFile(testPath, 'utf8')).toBe(tests);
      // Nothing but protocol messages on stdout.
      expect(mcp.stdout.every((line) => JSON.parse(line).jsonrpc === '2.0')).toBe(true);
    } finally {
      mcp.close();
      await writeFile(source, original);
      await writeFile(testPath, tests);
    }
  }, 240_000);

  it('tells an agent that loosened a test what it broke, and verifies the test that restores it', async () => {
    const tests = await readFile(testPath, 'utf8');
    const mcp = client();
    try {
      // The agent "fixes" a red build by loosening an assertion instead of the code. No source line changes.
      await writeFile(testPath, tests.replace('expect(shippingFee(10_001)).toBe(0);', 'expect(shippingFee(10_001)).toBeLessThanOrEqual(500);'));
      await mcp.request('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
      mcp.notify('notifications/initialized');
      const check = await mcp.request('tools/call', { name: 'mutation_check', arguments: { base: 'HEAD' } });
      const structured = check.result!.structuredContent as { status: string; findings: { rank: number; replacement: string; origin: string }[]; protection: { status: string; lost: { line: number; caughtBy: { name: string; fate: string }[] }[] } };
      expect(structured.status).toBe('gaps');
      expect(structured.protection).toMatchObject({ status: 'lost', lost: [{ line: 4, caughtBy: [{ name: 'shipping fee ships for free above the threshold', fate: 'weakened' }] }] });
      expect(structured.findings[0]).toMatchObject({ rank: 1, replacement: 'false', origin: 'lost-protection' });
      const text = (check.result!.content as { text: string }[])[0]!.text;
      expect(text).toContain('YOUR TEST EDITS REMOVED PROTECTION');
      expect(text).toContain('+      expect(shippingFee(10_001)).toBeLessThanOrEqual(500);');

      const restoring = await mcp.request('tools/call', { name: 'verify_test', arguments: { finding: 1, testPath, test: "it('ships free above $100 (SHIPPING-001)', () => {\n  expect(shippingFee(10_001)).toBe(0);\n});" } });
      expect(restoring.result!.structuredContent).toMatchObject({ verdict: 'verified' });
    } finally {
      mcp.close();
      await writeFile(testPath, tests);
    }
  }, 240_000);
});
