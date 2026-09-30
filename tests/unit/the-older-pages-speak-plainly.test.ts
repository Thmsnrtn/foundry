process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// THE OLDER PAGES SPEAK PLAINLY (Institution V1b, 30 September 2026).
//
// Account, Your data, Tool servers and the first-run page were the last owner
// pages written in the machinery's words — agents, agent logs, scopes, the
// gateway, idempotent, kill-switchable, "anything that speaks MCP", JSON as a
// button. The long-horizon directive: no jargon; depth behind progressive
// disclosure. This reads what the owner actually sees — the text, not the
// markup, and not what a program is handed — on each page, and refuses the
// words that name Foundry's insides rather than the owner's world. A technical
// name may still appear once in brackets beside the plain one (MCP, JSON), so
// the owner can match it to what another tool calls it.
// =============================================================================

const OWNER = 'f_plain';
let app: Hono;

/** What a person reads: tags, scripts, styles and attribute values removed. */
const visible = (html: string): string => html
  .replace(/<script[\s\S]*?<\/script>/g, ' ').replace(/<style[\s\S]*?<\/style>/g, ' ')
  .replace(/<code[\s\S]*?<\/code>/g, ' ')
  .replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');

const MACHINERY = /\b(agents?|agent logs?|agent-to-agent|scopes?|principal|gateway|idempotent|kill-switch\w*|grants?|residency|REST API|webhooks?|OAuth|tenant|speaks MCP|MCP server)\b/i;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_plain', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_plain','Lamplight',?,'active','active','real')`, [OWNER]);
  const founder = (await query('SELECT * FROM founders WHERE id = ?', [OWNER])).rows[0] as Record<string, unknown>;
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, founder as never); c.set('userId' as never, OWNER as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', (await import('../../src/routes/dashboard/settings.js')).settingsRoutes);
  app.route('/', (await import('../../src/routes/dashboard/privacy.js')).privacySettings);
  app.route('/', (await import('../../src/routes/dashboard/connections.js')).connectionRoutes);
  app.route('/', (await import('../../src/routes/dashboard/onboarding.js')).onboardingRoutes);
});

describe('what the owner reads', () => {
  for (const path of ['/settings', '/privacy', '/connections', '/onboarding']) {
    it(`on ${path} names the owner's world, not Foundry's insides`, async () => {
      const r = await app.request(path);
      if (r.status >= 300 && r.status < 400) return; // a page that sends the owner elsewhere shows nothing
      expect(r.status, path).toBe(200);
      const said = visible(await r.text());
      expect(said.length, path).toBeGreaterThan(200);
      const all = [...said.matchAll(new RegExp(MACHINERY.source, 'gi'))].map((m) => said.slice(Math.max(0, m.index! - 50), m.index! + 40));
      expect(all, path).toEqual([]);
    });
  }

  it('calls the tool page by what it holds', async () => {
    const said = visible(await (await app.request('/connections')).text());
    expect(said).toContain('Tool servers');
    expect(said).not.toContain('Reach is never license');
    expect(said).not.toContain('Connections');
  });

  it('offers a download, not a file format, on Your data', async () => {
    const html = await (await app.request('/privacy')).text();
    expect(html).not.toMatch(/>\s*JSON\s*<\/a>/);
    expect(html).toContain('How long Foundry keeps its working notes');
  });
});
