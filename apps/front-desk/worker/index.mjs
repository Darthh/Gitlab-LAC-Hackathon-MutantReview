import snapshot from '../../../dist/worker-api.json' with { type: 'json' };

// Only the existing server's validated, public API responses enter this bundle.
// No filesystem, GitLab credentials, mutation execution, or write API at runtime.
export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path !== '/api' && !path.startsWith('/api/')) return env.ASSETS.fetch(request);

    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'same-origin',
    });
    if (!['GET', 'HEAD'].includes(request.method)) {
      headers.set('Allow', 'GET, HEAD');
      return new Response(JSON.stringify({ error: 'This console is read-only.' }), { status: 405, headers });
    }

    const download = path === '/api/evidence/download';
    const key = download ? '/api/evidence' : path;
    const endpoint = Object.hasOwn(snapshot.endpoints, key) ? snapshot.endpoints[key] : null;
    const status = endpoint?.status ?? 404;
    const body = endpoint?.body ?? { error: 'Unknown API endpoint.' };
    if (download && status === 200) {
      const runId = body.runId.replace(/[^a-zA-Z0-9-]/g, '');
      headers.set('Content-Disposition', `attachment; filename="mutant-review-${runId}.json"`);
    }
    return new Response(request.method === 'HEAD' ? null : JSON.stringify(body), { status, headers });
  },
};
