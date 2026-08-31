process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// AN EMPTY PAGE MAY SAY IT IS EMPTY. IT MAY NOT PROMISE THAT IT WON'T BE.
//
// The OKR page told every founder "No OKRs defined yet. Agents will create
// objectives as your strategy evolves." Nothing creates one: `createOKR` has no
// caller anywhere in `src/`, and never has. The page would say that forever.
//
// This is the public-claims rule inside the product. A claim on a marketing
// page is checked by a gate; a claim on a dashboard a founder opens is the same
// claim, made to the one person who will act on it.
//
// Compass reads the same table and its comment blamed a status-vocabulary bug
// found in an earlier cycle. Fixing that filter did not make it non-empty, and
// the comment now says the real reason.
// =============================================================================

const P = 'ok_product';
const OWNER = 'ok_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email,tier) VALUES (?,'ok_c','o@example.com','growth')`, [OWNER]);
  await query(`INSERT INTO products (id,name,owner_id,status) VALUES (?,'Fold Street Dance',?,'active')`, [P, OWNER]);

  const { agentsOkr } = await import('../../src/routes/dashboard/agents-okr.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'o@example.com', tier: 'growth', preferences: {} } as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', agentsOkr);
});

describe('the OKR page', () => {
  it('says it is empty without promising that something will fill it', async () => {
    const html = await (await app.request('/agents/okr')).text();
    expect(html).toContain('No objectives here');
    expect(html).not.toContain('Agents will create objectives');
  });

  it('is empty because nothing creates an OKR, which is checked and not assumed', () => {
    // If somebody wires `createOKR`, this test fails and the page's wording
    // should be revisited — which is the point of asserting it here rather than
    // trusting the sentence to stay true.
    const files: string[] = [];
    (function walk(dir: string): void {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith('.ts')) files.push(path);
      }
    })(resolve(__dirname, '../../src'));

    // Comments stripped first. A note ABOUT this fact is not a caller, and
    // counting one made this test fail on the comment written to explain it —
    // the same false positive the write-only-column gate has with SQL comments.
    const strip = (source: string): string => source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .split('\n').map((l) => l.replace(/^\s*\/\/.*$/, '')).join('\n');
    const callers = files.filter((f) => !f.endsWith(join('scp', 'okr.ts')))
      .filter((f) => /\bcreateOKR\b/.test(strip(readFileSync(f, 'utf8'))));
    expect(callers, 'createOKR now has a caller — the empty state should stop saying nothing does')
      .toEqual([]);
  });
});
