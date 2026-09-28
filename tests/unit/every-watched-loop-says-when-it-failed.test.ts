// =============================================================================
// EVERY WATCHED LOOP SAYS WHEN ITS WORK FAILED.
//
// Roadmap G3, extending Gate 1's case 8 to every loop the Brief watches
// (`INSTITUTION_LOOPS`). A job that catches each subject's failure, logs it
// and returns normally is recorded by the scheduler as a healthy pass — so a
// day on which every search, every look at the market, or every republish of
// the public pages failed read on the Brief as a day that ran. Three loops did
// exactly that: `venture_discovery_tick`, `real_market_evidence_tick` and
// `public_workshop_tick`, which also let failed opt-out syncs — the promise to
// stop writing to someone — pass as a count in a log line.
//
// Each now finishes the pass for every other subject, and then throws, so
// `job_health` records the failure and the Brief names the loop. A pass with
// nothing wrong still resolves.
// =============================================================================
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '1'.repeat(64);

import { beforeAll, describe, expect, it, vi } from 'vitest';

let fail = true;
let publishFailed: string[] = [];
let optOutsFailed: string[] = [];

vi.mock('../../src/services/venture/discovery.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  discover: vi.fn(async () => { if (fail) throw new Error('the eyes did not answer'); return { sown: [], read: 0, passedOver: [] }; }),
  promoteWhatEarnedIt: vi.fn(async () => ({ promoted: [], refused: [] })),
  weedOut: vi.fn(async () => ({ buried: [], saidNothing: [] })),
}));
vi.mock('../../src/services/venture/research-sources.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  waysOfLooking: vi.fn(async () => [{ sourceType: 'directory' }]),
}));
vi.mock('../../src/services/venture/sources/index.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  askWhatAlreadyExists: vi.fn(async () => { if (fail) throw new Error('the directory did not answer'); return {}; }),
}));
vi.mock('../../src/services/public-workshop/suppression.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  syncOptOutsFromStore: vi.fn(async () => ({ recorded: 0, continuations: 0, swept: 0, failed: optOutsFailed })),
}));
vi.mock('../../src/services/public-workshop/infrastructure.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  keepTheProgramCurrent: vi.fn(async () => 'unchanged'),
  workshopHealth: vi.fn(async () => ({ site: { status: 'ok' }, cloudflare: { status: 'ok' }, sending: { status: 'ok' },
    inbound: { status: 'ok' }, replyInbox: { status: 'ok' }, pagesFailing: [] })),
}));
vi.mock('../../src/services/public-workshop/publication.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  publishSite: vi.fn(async () => { if (fail) throw new Error('the page store refused'); return { published: [], failed: publishFailed, held: [] }; }),
}));
vi.mock('../../src/services/public-workshop/reply-probe.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  probeIsDue: vi.fn(async () => false),
}));
vi.mock('../../src/services/venture/proof-1.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  keepProof1sRecordCurrent: vi.fn(async () => 'unchanged'),
}));
vi.mock('../../src/services/venture/proof-2.js', async (orig) => ({
  ...(await orig<Record<string, unknown>>()),
  keepProof2sEntryCurrent: vi.fn(async () => 'unchanged'),
}));

const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');
const { JOB_REGISTRY } = await import('../../src/jobs/index.js');

const OWNER = 'wl_owner';

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', [OWNER, 'clerk_wl', 'wl@example.com', 'Owner']);
  await query("INSERT INTO products (id, name, owner_id, status, reality) VALUES ('wl_co','Apex Micro',?,'active','real')", [OWNER]);
  const { openMandate } = await import('../../src/services/venture/mandate.js');
  const m = await openMandate({ founderId: OWNER, statement: 'Small things for trades businesses', shape: null, evidenceMode: 'real' });
  if ('refused' in m) throw new Error(m.refused);
  await query(`INSERT INTO market_claims (id, founder_id, claim, evidence_mode) VALUES ('wl_claim',?,'contractors track their bids by hand','real')`, [OWNER]);
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about, postal_address)
     VALUES (?,'wl_co','Apex Micro','Owner','https://apexmicro.example','apexmicro.example','hello@apexmicro.example','A small workshop.','','Apex Micro\n1 Example Drive')`, [OWNER]);
  await query(`INSERT INTO public_publications (id, founder_id, path, kind, version, digest, bytes, published_by)
    VALUES ('wl_pub',?,'/','page',1,'d',1,'test')`, [OWNER]);
});

describe('a loop whose every subject failed does not pass', () => {
  it('venture_discovery_tick', async () => {
    fail = true;
    await expect(JOB_REGISTRY.venture_discovery_tick.fn()).rejects.toThrow(/could not/);
  });

  it('real_market_evidence_tick', async () => {
    fail = true;
    await expect(JOB_REGISTRY.real_market_evidence_tick.fn()).rejects.toThrow(/could not/);
  });

  it('public_workshop_tick, when republishing throws', async () => {
    const live = Number(((await query('SELECT COUNT(*) AS n FROM public_publications WHERE founder_id = ? AND superseded_at IS NULL', [OWNER]))
      .rows[0] as Record<string, unknown>).n);
    expect(live, 'the fixture needs a live page for the republish path').toBeGreaterThan(0);
    fail = true;
    await expect(JOB_REGISTRY.public_workshop_tick.fn()).rejects.toThrow(/could not/);
  });

  it('public_workshop_tick, when pages failed to publish', async () => {
    fail = false; publishFailed = ['/refunds: the store refused'];
    await expect(JOB_REGISTRY.public_workshop_tick.fn()).rejects.toThrow(/could not/);
    publishFailed = [];
  });

  it('public_workshop_tick, when opt-outs could not be kept', async () => {
    fail = false; optOutsFailed = ['optout:abc: timeout'];
    await expect(JOB_REGISTRY.public_workshop_tick.fn()).rejects.toThrow(/opt-out/);
    optOutsFailed = [];
  });
});

describe('a pass with nothing wrong still passes', () => {
  it('each of the three resolves', async () => {
    fail = false;
    await expect(JOB_REGISTRY.venture_discovery_tick.fn()).resolves.toBeUndefined();
    await expect(JOB_REGISTRY.real_market_evidence_tick.fn()).resolves.toBeUndefined();
    await expect(JOB_REGISTRY.public_workshop_tick.fn()).resolves.toBeUndefined();
  });
});
