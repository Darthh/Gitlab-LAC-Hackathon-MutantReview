import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../apps/front-desk/worker/index.mjs';

const request = (path, options) => new Request(`https://console.example${path}`, options);

test('deployed API serves measured evidence and its download as the same JSON', async () => {
  const response = await worker.fetch(request('/api/evidence'));
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('Cache-Control'), 'no-store');
  assert.equal(response.headers.get('X-Content-Type-Options'), 'nosniff');
  const evidence = await response.json();
  assert.equal(evidence.schemaVersion, 1);
  assert.ok(evidence.runId.length > 0);
  const download = await worker.fetch(request('/api/evidence/download'));
  assert.match(download.headers.get('Content-Disposition'), /^attachment; filename="mutant-review-[a-zA-Z0-9-]+\.json"$/);
  assert.deepEqual(await download.json(), evidence);
});

test('HEAD preserves API headers without a body; writes and unknown API routes are rejected', async () => {
  const head = await worker.fetch(request('/api/health', { method: 'HEAD' }));
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const post = await worker.fetch(request('/api/evidence', { method: 'POST' }));
  assert.equal(post.status, 405);
  assert.equal(post.headers.get('Allow'), 'GET, HEAD');
  assert.deepEqual(await post.json(), { error: 'This console is read-only.' });
  for (const path of ['/api', '/api/unknown', '/api/toString', '/api/__proto__']) {
    const unknown = await worker.fetch(request(path));
    assert.equal(unknown.status, 404);
    assert.deepEqual(await unknown.json(), { error: 'Unknown API endpoint.' });
  }
});
