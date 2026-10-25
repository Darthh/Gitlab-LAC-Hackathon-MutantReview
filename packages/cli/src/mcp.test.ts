import { describe, expect, it } from 'vitest';
import { createServer, mutantReviewTools, type McpTool } from './mcp.js';
import { safeRef } from './precheck.js';

const echo: McpTool = { name: 'echo', title: 'Echo', description: 'Echo', inputSchema: { type: 'object' }, run: async (args) => ({ text: String(args.text), structured: { seen: args.text } }) };
const broken: McpTool = { ...echo, name: 'broken', run: async () => { throw new Error('Stryker did not finish'); } };
const call = (handle: ReturnType<typeof createServer>, method: string, params?: Record<string, unknown>, id = 1) => handle({ jsonrpc: '2.0', id, method, params });

describe('MCP server', () => {
  const handle = createServer([echo, broken]);
  it('negotiates a supported protocol version and announces tools', async () => {
    expect(await call(handle, 'initialize', { protocolVersion: '2025-03-26' })).toMatchObject({ id: 1, result: { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'mutant-review' } } });
    expect(await call(handle, 'initialize', { protocolVersion: '1999-01-01' })).toMatchObject({ result: { protocolVersion: '2025-06-18' } });
  });
  it('answers notifications with nothing and unknown methods with an error', async () => {
    expect(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' })).toBeNull();
    expect(await call(handle, 'resources/list')).toMatchObject({ error: { code: -32601 } });
    expect(await handle({ id: 3, method: 'ping' })).toMatchObject({ error: { code: -32600 } });
  });
  it('lists tools without their implementation', async () => {
    const reply = await call(handle, 'tools/list') as { result: { tools: Record<string, unknown>[] } };
    expect(reply.result.tools.map((tool) => tool.name)).toEqual(['echo', 'broken']);
    expect(reply.result.tools[0]).not.toHaveProperty('run');
  });
  it('returns tool output as text and structured content, and tool failures as isError results', async () => {
    expect(await call(handle, 'tools/call', { name: 'echo', arguments: { text: 'hi' } })).toMatchObject({ result: { content: [{ type: 'text', text: 'hi' }], structuredContent: { seen: 'hi' }, isError: false } });
    expect(await call(handle, 'tools/call', { name: 'broken', arguments: {} })).toMatchObject({ result: { isError: true, content: [{ text: expect.stringContaining('Stryker did not finish') }] } });
    expect(await call(handle, 'tools/call', { name: 'missing' })).toMatchObject({ error: { code: -32602 } });
  });
  it('runs tool calls one at a time, because they share the working tree', async () => {
    const order: string[] = [];
    const slow: McpTool = { ...echo, name: 'slow', run: async (args) => { order.push(`start ${args.text}`); await new Promise((r) => setTimeout(r, 20)); order.push(`end ${args.text}`); return { text: 'ok' }; } };
    const serial = createServer([slow]);
    await Promise.all([call(serial, 'tools/call', { name: 'slow', arguments: { text: 'a' } }), call(serial, 'tools/call', { name: 'slow', arguments: { text: 'b' } }, 2)]);
    expect(order).toEqual(['start a', 'end a', 'start b', 'end b']);
  });
  it('publishes the two Mutant Review tools as read-only', () => {
    expect(mutantReviewTools.map((tool) => [tool.name, tool.annotations?.readOnlyHint])).toEqual([['mutation_check', true], ['verify_test', true]]);
    expect(mutantReviewTools[1]!.inputSchema).toMatchObject({ required: ['finding', 'testPath', 'test'] });
  });
});

describe('base refs from an agent', () => {
  it('accepts branches, tags and SHAs', () => {
    for (const ref of ['main', 'origin/main', 'v1.2.0', 'a'.repeat(40), 'HEAD']) expect(safeRef(ref)).toBe(ref);
  });
  it('rejects options, ranges and shell text', () => {
    for (const ref of ['--output=/etc/passwd', '-p', 'main..HEAD', 'main;rm -rf', '', 'a b']) expect(() => safeRef(ref)).toThrow('Unsupported base ref');
  });
});
