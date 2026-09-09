// =============================================================================
// FOUNDRY — The public Workshop's one program, as text.
//
// Deployed to Cloudflare through the governed capability and served at
// apexmicro.ai. It knows nothing: it reads finished pages out of one store
// under `page:<path>`, writes an opt-out under `optout:<id>` when the form is
// posted, and answers 404 to everything else. It holds no credential, reaches
// no origin, and cannot see the private institution, which is the isolation:
// a private route requested through the public hostname has nothing to reach.
//
// Kept as a string so it is deployed exactly as reviewed here and the digest
// of what is running can be compared with the digest of this text.
// =============================================================================

export const WORKER_SOURCE = `// Apex Micro public workshop. Serves finished pages from a store; nothing else.
const HOSTS = new Set(['apexmicro.ai', 'www.apexmicro.ai']);
const HEADERS = {
  'content-type': 'text/html; charset=utf-8',
  'cache-control': 'public, max-age=120',
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
  'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
  'strict-transport-security': 'max-age=31536000; includeSubDomains',
  'permissions-policy': 'camera=(), microphone=(), geolocation=()',
};
function normalise(pathname) {
  let p = pathname.replace(/\\/+$/, '') || '/';
  if (p.length > 200 || /[^a-z0-9\\/-]/.test(p)) return null;
  return p;
}
async function pageOr404(env, path) {
  const html = path === null ? null : await env.PAGES.get('page:' + path);
  if (html !== null && html !== undefined) return new Response(html, { status: 200, headers: HEADERS });
  const notFound = await env.PAGES.get('page:/404');
  return new Response(notFound || 'Not found', { status: 404, headers: HEADERS });
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (!HOSTS.has(url.hostname)) return new Response('Not found', { status: 404, headers: HEADERS });
    if (url.hostname === 'www.apexmicro.ai') return Response.redirect('https://apexmicro.ai' + url.pathname, 301);
    const path = normalise(url.pathname);
    if (request.method === 'POST' && path === '/email/opt-out') {
      let email = '';
      try { const form = await request.formData(); email = String(form.get('email') || '').trim().toLowerCase(); } catch (e) { email = ''; }
      if (!email || email.length > 320 || !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(email)) {
        return new Response('An email address is needed.', { status: 400, headers: HEADERS });
      }
      const id = crypto.randomUUID();
      await env.PAGES.put('optout:' + id, JSON.stringify({ email, at: new Date().toISOString() }));
      const done = await env.PAGES.get('page:/email/done');
      return new Response(done || 'Done. That address will not be contacted.', { status: 200, headers: { ...HEADERS, 'cache-control': 'no-store' } });
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') return new Response('Method not allowed', { status: 405, headers: HEADERS });
    return pageOr404(env, path);
  },
};
`;
