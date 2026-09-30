process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '8'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { answersFor, needsYou, snooze, SnoozeRefused } from '../../src/services/needs-you/queue.js';
import { proposeAct, setBoundary } from '../../src/services/institution/standing-intent.js';
import { openUndertaking } from '../../src/services/institution/undertaking.js';
import { readTerms, setTerms } from '../../src/services/mission/write.js';
import type { AttentionItem } from '../../src/services/founder/attention.js';

// =============================================================================
// NEEDS YOU ANSWERS BEFORE IT ASKS (Mission Control, 30 September 2026).
//
// One list of everything that waits on the owner, and every item in it says —
// before any button — why now, what yes does, the most it can cost, whether it
// can be undone, and what happens if he does nothing. It takes in the two
// things the old queue left out: mail only he can answer, and Missions whose
// limits he set were crossed. And he may say "not now" to what can wait —
// never to what a buyer is owed, and never with a key he was not shown.
// =============================================================================

const OWNER = 'f_ny';
let app: Hono;
let actId = '';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clk_ny', 'owner@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,scp_status,reality) VALUES ('p_ny','Lamplight',?,'active','active','real')`, [OWNER]);
  await setBoundary({ productId: 'p_ny', subject: 'set_prices', mode: 'ask_first', statement: 'Ask me before changing prices' });
  actId = await proposeAct({ productId: 'p_ny', subject: 'set_prices', actionType: null, params: { price: 49 },
    summary: 'Raise the price to $49', why: 'Three buyers asked for more', expectedEffect: 'More per sale', risk: 'Fewer sales',
    consequence: 'low', proposedBy: 'institution:test' });
  await query(`INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,'p_ny','Apex Micro','Owner','https://apexmicro.example','apexmicro.example','hello@apexmicro.example','A small workshop.','')`, [OWNER]);
  await query(`INSERT INTO workshop_mail (id, founder_id, subject, body, rfc_message_id, thread_key, from_email, to_email)
    VALUES ('m_ny', ?, 'A question about the workbook', 'Hello', '<ny@example.com>', 'k_ny', 'buyer@example.com', 'hello@apexmicro.example')`, [OWNER]);
  const { settleMail } = await import('../../src/services/public-workshop/mail.js');
  await settleMail({ founderId: OWNER, id: 'm_ny', handling: 'needs_owner', because: 'I could not answer it on my own' });
  const u = await openUndertaking({ founderId: OWNER, productId: 'p_ny', kind: 'grow', asked: 'Grow Lamplight', understoodAs: 'Grow Lamplight',
    openedBy: `founder:${OWNER}`, from: { kind: 'owner', id: null } });
  await setTerms(OWNER, `undertaking:${u!.id}`, readTerms({ until: '2000-01-01' }));
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'owner@example.com', name: 'Owner' } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
});

describe('the six answers', () => {
  it('are all said, for every kind of item, and never empty', () => {
    const base = { id: 'x', productId: 'p', companyName: 'C', summary: 'S', detail: 'An act I cannot take until you say yes. Expires 2099-01-01.',
      yes: { label: 'Yes', action: '/y' }, no: { label: 'No', action: '/n' }, why: null, href: '/h' };
    for (const kind of ['act', 'advice', 'noticed', 'experiment', 'charter', 'obligation'] as const) {
      const a = answersFor({ ...base, kind } as AttentionItem);
      for (const [k, v] of Object.entries(a)) expect(v.trim().length, `${kind}.${k}`).toBeGreaterThan(0);
    }
    expect(answersFor({ ...base, kind: 'act', effect: 'person' } as AttentionItem).mostItCanCost).toContain('reaches a real person');
    expect(answersFor({ ...base, kind: 'act' } as AttentionItem).ifNothing).toContain('2099-01-01');
  });
});

describe('one list', () => {
  it('holds the act, the mail only he can answer, and the Mission whose limit was crossed', async () => {
    const { items } = await needsYou(OWNER);
    const keys = items.map((i) => i.key);
    expect(keys).toContain(`act:${actId}`);
    expect(keys).toContain('mail:m_ny');
    expect(keys.some((k) => k.startsWith('mission:undertaking:'))).toBe(true);
    const mission = items.find((i) => i.key.startsWith('mission:'))!;
    expect(mission.answers.mostItCanCost).toContain('I do not act on your limit');
  });

  it('shows the answers before the buttons on the page', async () => {
    const html = await (await app.request('/foundry/needs-you')).text();
    expect(html).toContain('Why now');
    expect(html).toContain('If you do nothing');
    expect(html).toContain('A question about the workbook');
    expect(html).toContain('past the end date you set');
    expect(html.indexOf('If you do nothing')).toBeLessThan(html.lastIndexOf('Not now'));
  });
});

describe('not now', () => {
  it('puts an item off until tomorrow, and it comes back on its own', async () => {
    const r = await app.request('/foundry/needs-you/later', {
      method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: `key=${encodeURIComponent('mail:m_ny')}` });
    expect(r.status).toBe(302);
    const now = await needsYou(OWNER);
    expect(now.items.map((i) => i.key)).not.toContain('mail:m_ny');
    expect(now.later.map((i) => i.key)).toContain('mail:m_ny');
    const tomorrowPlus = new Date(Date.now() + 26 * 3_600_000);
    expect((await needsYou(OWNER, tomorrowPlus)).items.map((i) => i.key)).toContain('mail:m_ny');
    const html = await (await app.request('/foundry/needs-you')).text();
    expect(html).toContain('Put off until later');
  });

  it('refuses a key he was not shown, and anything a buyer is owed', async () => {
    await expect(snooze(OWNER, 'act:not-a-real-act')).rejects.toBeInstanceOf(SnoozeRefused);
    await expect(snooze(OWNER, 'obligation:anything')).rejects.toBeInstanceOf(SnoozeRefused);
    await expect(query(`UPDATE needs_you_snoozes SET until = '2099-01-01' WHERE founder_id = ?`, [OWNER])).rejects.toThrow(/kept as it was/);
  });
});
