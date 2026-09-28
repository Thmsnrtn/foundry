// =============================================================================
// ASK ANSWERS THE FIVE QUESTIONS, AND AGREES WITH THE SCREENS.
//
// Roadmap F1 and F4. The comprehension test the owner is to take on his own
// phone is five questions: What is owed? What reached the bank? What may
// Foundry spend? What is Foundry doing? What must I do? Typed into Ask, three
// of them were answered "I don't know yet" — the classifier had no reading for
// "owed", "bank" or "must I do" — and "How much can you spend?" was read as a
// question about a company's metrics.
//
// Each is now answered, and from the reader the screen that shows it uses:
// what is owed from `obligationsFor` (the money page's "Owed to buyers"), what
// reached a bank from `moneyBanked` and the held figure (the money page's own
// tiles). So Ask cannot say one thing while the page says another; this file
// fails if it does.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '9'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'five@example.com';
process.env.APP_URL = 'http://localhost:8080';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { approveListing, recordListing, recordVenueOrder, requestVenueRefund, seedProof2 } from '../../src/services/venture/proof-2.js';

const OWNER = 'five_owner';
let app: Hono;
const text = (h: string) => h.replace(/<[^>]+>/g, ' ').replace(/&[a-z#0-9]+;/g, ' ').replace(/\s+/g, ' ');
/** Only the answer — the rest of the first screen carries every figure anyway. */
const asked = async (q: string) => {
  const h = await (await app.request(`/foundry?q=${encodeURIComponent(q)}`)).text();
  const m = /<div class="said">([\s\S]*?)<\/div>/.exec(h);
  return text(m ? m[1] : '(no answer block)');
};

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_five', 'five@example.com', 'Owner']);
  await query(`INSERT INTO products (id,name,owner_id,status,operating_budget_monthly_usd) VALUES ('five_f','Foundry',?,'active',50)`, [OWNER]);
  await query(`INSERT INTO system_identities (identity_key,product_id,established_reason) VALUES ('foundry','five_f','test')`, []);
  const { recordJobSuccess, ECONOMIC_LOOPS } = await import('../../src/services/institution/loop-health.js');
  for (const j of ECONOMIC_LOOPS) await recordJobSuccess(j);
  // A sale, and a buyer who has asked for their money back: something is owed.
  const X = (await seedProof2(OWNER)).experimentId;
  await approveListing({ founderId: OWNER, experimentId: X });
  await recordListing({ founderId: OWNER, experimentId: X, url: 'https://www.etsy.com/listing/9988776661/workbook' });
  await recordVenueOrder({ founderId: OWNER, experimentId: X,
    order: { orderRef: '8100000001', paidAt: new Date().toISOString(), grossCents: 1400, feeCents: 158 } });
  await requestVenueRefund({ founderId: OWNER, experimentId: X, orderRef: '8100000001' });
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  const { moneyRoutes } = await import('../../src/routes/dashboard/money-place.js');
  app = new Hono();
  app.use('*', async (c, next) => { c.set('founder' as never, { id: OWNER, email: 'five@example.com', name: 'Owner', preferences: {} } as never); c.set('csrfToken' as never, 't' as never); await next(); });
  app.route('/', letterRoutes);
  app.route('/', moneyRoutes);
});

describe('the five questions, typed as he would type them', () => {
  for (const q of ['What is owed?', 'What reached the bank?', 'What may Foundry spend?', 'What is Foundry doing?', 'What must I do?',
    'How much can you spend?', 'What do I owe buyers?', 'Has any money reached my bank?', 'What do I need to do?']) {
    it(`answers "${q}"`, async () => {
      expect(await asked(q)).not.toMatch(/I don't know yet/);
    });
  }

  it('reads "How much can you spend?" as what Foundry may spend, not a company\'s numbers', async () => {
    expect(await asked('How much can you spend?')).toMatch(/charter|may spend|may think/i);
  });
});

describe('Ask and the money page say the same thing', () => {
  it('what is owed: every obligation the page lists, in its words', async () => {
    const { obligationsFor } = await import('../../src/services/venture/obligations.js');
    const owed = await obligationsFor(OWNER);
    expect(owed.length).toBeGreaterThan(0);
    const [ask, page] = [await asked('What is owed?'), text(await (await app.request('/foundry/money')).text())];
    for (const o of owed) {
      expect(page).toContain(text(o.sentence));
      expect(ask).toContain(text(o.sentence));
    }
  });

  it('what reached the bank: not known, for the page\'s reason, beside the page\'s held figure', async () => {
    const { moneyBanked, distributableSurplus, figureText } = await import('../../src/services/economy/projection.js');
    const banked = await moneyBanked();
    const held = figureText((await distributableSurplus(OWNER)).held);
    const [ask, page] = [await asked('What reached the bank?'), text(await (await app.request('/foundry/money')).text())];
    expect(ask).toMatch(/not known/);
    expect(ask).toContain(text(banked.because).slice(0, 60));
    expect(page).toContain(text(banked.because).slice(0, 60));
    expect(ask).toContain(held);
    expect(page).toContain(held);
  });
});
