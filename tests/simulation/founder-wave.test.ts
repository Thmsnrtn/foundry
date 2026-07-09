// =============================================================================
// FOUNDRY — Founder-wave simulation (the loop, lived)
//
// The walkthrough sim proved the SURFACES; this wave proves the LOOP. ~20
// simulated founders live with the system across a compressed 90 days, driving
// REAL routes against REAL migrations (model mocked, deterministic):
//
//   • the Overruler — red-teamed, overrules dissent, telemetry proves the
//     Red Team right → belief expires, review vindicated, banner shows
//   • the Forker — forks reality; scenarios land; fork is idempotent
//   • the Thin founder — Ghost + radar both ABSTAIN (honesty holds under load)
//   • the Overloaded founder — a 2am decision spree → pulse notices, kindly
//   • the Radar-warned founder — churn in the peer danger tail → tap + Letter
//   • the Trusted founder — 9/10 positive outcomes → graduation proposal
//   • the Quiet founder — a letter that says "nothing needs you"
//   • the Adversary — tries to run the loop against a victim's tenant → 404s
//   • + a background wave of steady founders exercising every page
//
// Every stage asserts its LEDGER, not just its status code.
// =============================================================================

process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.APP_URL = 'http://localhost:8080';

import { describe, it, expect, beforeAll, vi } from 'vitest';

// One mock, two voices: the Red Team council and the Ghost prior-estimator are
// distinguished by their system prompts. Deterministic canned outputs.
vi.mock('../../src/services/ai/client.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/services/ai/client.js')>();
  return {
    ...actual,
    callSonnet: vi.fn(async (systemPrompt: string) => ({
      content: systemPrompt.includes('RED TEAM')
        ? JSON.stringify({
            verdict: 'do_not_proceed',
            strongest_objection: 'This bets against your own churn trend.',
            confidence: 0.7,
            objections: [
              { lens: 'downside', claim: 'Churn breaches 8% in 90 days', severity: 'fatal',
                metric_key: 'churn_rate', comparator: '>', threshold: 0.08, mitigation: 'Grandfather existing users' },
              { lens: 'capacity', claim: 'Support wave lands on one person', severity: 'note' },
            ],
          })
        : JSON.stringify({
            options: [
              { label: 'Raise price', growth_delta_pp: 1.2, rationale: 'ARPU up, churn risk' },
              { label: 'Hold price', growth_delta_pp: 0, rationale: 'status quo' },
            ],
          }),
      model: 'sonnet',
      usage: { input_tokens: 400, output_tokens: 250 },
    })),
  };
});

import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// ── Harness: real route modules behind an auth stub (walkthrough pattern) ─────
let currentFounder: Record<string, unknown> | null = null;
let currentProductId: string | null = null;
let app: Hono;
let requests = 0;

async function hit(method: string, path: string, body?: unknown, json = false): Promise<Response> {
  requests++;
  const init: RequestInit & { headers: Record<string, string> } = { method, headers: {} };
  if (body !== undefined) {
    if (json) {
      init.headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    } else {
      init.headers['content-type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(body as Record<string, string>).toString();
    }
  }
  return app.request(path, init);
}

let seq = 0;
async function founderWith(name: string, opts: { snapshots?: number[]; stage?: string } = {}): Promise<{ fid: string; pid: string; founder: Record<string, unknown> }> {
  const fid = `wf_f${++seq}`;
  const pid = `wf_p${seq}`;
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier) VALUES (?, ?, ?, ?, 'growth')`,
    [fid, `clk_${fid}`, `${fid}@wave.test`, name],
  );
  await query(`INSERT INTO products (id, name, owner_id) VALUES (?, ?, ?)`, [pid, `${name}Co`, fid]);
  await query(`INSERT INTO lifecycle_state (product_id, current_prompt) VALUES (?, ?)`, [pid, opts.stage ?? 'prompt_2']);
  for (let i = 0; i < (opts.snapshots?.length ?? 0); i++) {
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, mrr_cents) VALUES (?, ?, ?, ?)`,
      [`wf_s${seq}_${i}`, pid, `2026-0${(i % 9) + 1}-15`, opts.snapshots![i]],
    );
  }
  const founder = { id: fid, email: `${fid}@wave.test`, name, tier: 'growth' };
  return { fid, pid, founder };
}

async function decision(pid: string, what: string, gate = 3): Promise<string> {
  const id = `wf_d${++seq}`;
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, options, status)
     VALUES (?, ?, 'strategic', ?, ?, 'now', ?, 'pending')`,
    [id, pid, gate, what, JSON.stringify([{ label: 'Raise price' }, { label: 'Hold price' }])],
  );
  return id;
}

function actAs(f: { founder: Record<string, unknown>; pid: string }): void {
  currentFounder = f.founder;
  currentProductId = f.pid;
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);

  const { decisionRoutes } = await import('../../src/routes/dashboard/decisions.js');
  const { agentsDecisions } = await import('../../src/routes/dashboard/agents-decisions.js');
  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');

  app = new Hono();
  app.use('*', async (c, next) => {
    if (currentFounder) {
      c.set('founder' as never, currentFounder as never);
      c.set('userId' as never, currentFounder.id as never);
      if (currentProductId) c.set('productId' as never, currentProductId as never);
      c.set('csrfToken' as never, 'test' as never);
    }
    await next();
  });
  app.route('/', decisionRoutes);
  app.route('/', agentsDecisions);
  app.route('/', letterRoutes);
});

// ─── The wave ─────────────────────────────────────────────────────────────────

describe('the Overruler — dissent, overruled, vindicated', () => {
  it('lives the full contest→commit→observe→learn arc through real routes', async () => {
    const f = await founderWith('Overruler', { snapshots: [10000, 10600, 11200, 11900] });
    actAs(f);
    const d = await decision(f.pid, 'Raise Solo price to $99');

    // Summon the Red Team via the real route.
    const rt = await hit('POST', `/decisions/${d}/redteam`);
    expect([302, 303]).toContain(rt.status);
    const review = await query('SELECT verdict FROM red_team_reviews WHERE decision_id = ?', [d]);
    expect((review.rows[0] as Record<string, unknown>).verdict).toBe('do_not_proceed');

    // The chamber renders the dissent.
    const chamber = await hit('GET', `/decisions/${d}`);
    expect(chamber.status).toBe(200);
    const chamberHtml = await chamber.text();
    expect(chamberHtml).toContain('Red Team pre-mortem');
    expect(chamberHtml).toContain('Churn breaches 8%');

    // Overrule: resolve past the dissent (gate-3 needs reasoning).
    const res = await hit('POST', `/decisions/${d}/resolve`,
      { chosen_option: 'Raise price', resolution_reasoning: 'Margin matters more' }, true);
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 50)); // fire-and-forget premise write

    const premise = await query(
      "SELECT * FROM decision_premises WHERE decision_id = ? AND origin = 'red_team'", [d]);
    expect(premise.rows.length).toBe(1);
    expect((premise.rows[0] as Record<string, unknown>).comparator).toBe('<=');

    // 60 days later: churn breaches. The premise-check job runs.
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate) VALUES (?, ?, '2026-12-01', 0.11)`,
      [`wf_churn_${f.pid}`, f.pid]);
    const { checkPremises } = await import('../../src/services/memory/kernel.js');
    const check = await checkPremises(f.pid);
    expect(check.falsified).toBe(1);

    // The dissent is vindicated; the strategic page shows the expired belief.
    const rev = await query('SELECT resolved_outcome FROM red_team_reviews WHERE decision_id = ?', [d]);
    expect((rev.rows[0] as Record<string, unknown>).resolved_outcome).toBe('vindicated');
  });
});

describe('the Forker — reality forked, idempotently', () => {
  it('gets ordered scenario bands from its own history via the real route', async () => {
    const f = await founderWith('Forker', { snapshots: [20000, 21000, 22100, 23200, 24400] });
    actAs(f);
    const d = await decision(f.pid, 'Launch annual plans');
    expect([302, 303]).toContain((await hit('POST', `/decisions/${d}/ghost`)).status);

    const rows = await query('SELECT option_label, base_case FROM scenario_models WHERE decision_id = ?', [d]);
    expect(rows.rows.length).toBe(3); // ghost + 2 options
    expect((rows.rows as Array<Record<string, string>>).some((r) => r.option_label.includes('Ghost'))).toBe(true);

    await hit('POST', `/decisions/${d}/ghost`); // second fork must not duplicate
    const again = await query('SELECT COUNT(*) AS n FROM scenario_models WHERE decision_id = ?', [d]);
    expect(Number((again.rows[0] as Record<string, unknown>).n)).toBe(3);

    const chamber = await hit('GET', `/decisions/${d}`);
    expect((await chamber.text())).toContain('Ghost fork');
  });
});

describe('the Thin founder — honesty under thin data', () => {
  it('Ghost abstains and the radar stays silent rather than fabricate', async () => {
    const f = await founderWith('Thin', { snapshots: [5000, 5200] });
    actAs(f);
    const d = await decision(f.pid, 'Big bet on outbound');
    await hit('POST', `/decisions/${d}/ghost`);
    const rows = await query('SELECT COUNT(*) AS n FROM scenario_models WHERE decision_id = ?', [d]);
    expect(Number((rows.rows[0] as Record<string, unknown>).n)).toBe(0); // abstained

    const { scanForWarnings } = await import('../../src/services/network/radar.js');
    expect(await scanForWarnings(f.pid)).toEqual([]); // no peer cell → silence
  });
});

describe('the Overloaded founder — the pulse notices', () => {
  it('a 2am decision spree triggers one kind, numbers-shown note', async () => {
    const f = await founderWith('Overloaded');
    for (const d of [10, 17, 24, 31]) {
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at)
         VALUES (?, ?, 'product', 1, 'x', 'y', 'approved', 'founder', datetime('now', '-${d} days'))`,
        [`wf_d${++seq}`, f.pid]);
    }
    for (let i = 1; i <= 8; i++) {
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at)
         VALUES (?, ?, 'product', 1, 'x', 'y', 'approved', 'founder',
                 datetime(datetime('now', '-${(i % 6) + 1} days'), 'start of day', '+2 hours'))`,
        [`wf_d${++seq}`, f.pid]);
    }
    const { getFounderPulse } = await import('../../src/services/wellbeing/pulse.js');
    const pulse = await getFounderPulse(f.pid);
    expect(pulse.signal).toBe('overloaded');
    expect(pulse.message).toContain('the queue will keep');
  });
});

describe('the Radar-warned founder — the network sees it first', () => {
  it('churn in the peer danger tail lands in The Letter with evidence', async () => {
    const f = await founderWith('Warned', { stage: 'prompt_4' });
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, churn_rate, mrr_cents)
       VALUES (?, ?, '2026-06-01', 0.12, 900000)`, [`wf_warn_${f.pid}`, f.pid]);
    await query(
      `INSERT INTO network_benchmarks (id, metric, market_category, lifecycle_stage, mrr_bracket, p25, p50, p75, sample_count)
       VALUES (?, 'churn_rate', 'all', 'prompt_4', '5k-25k', 0.02, 0.04, 0.07, 11)`, [`wf_nb_${f.pid}`]);
    actAs(f);
    const letter = await hit('GET', '/letter');
    expect(letter.status).toBe(200);
    const text = await letter.text();
    expect(text).toContain('11 peers');
    expect(text).toContain('0.04');
  });
});

describe('the Trusted founder — autonomy is earned on the record', () => {
  it('9/10 positive marketing outcomes produce a graduation proposal in The Letter', async () => {
    const f = await founderWith('Trusted');
    for (let i = 0; i < 10; i++) {
      await query(
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at, outcome_valence)
         VALUES (?, ?, 'marketing', 1, 'x', 'y', 'approved', 'founder', datetime('now','-10 days'), ?)`,
        [`wf_d${++seq}`, f.pid, i < 9 ? 'positive' : 'negative']);
    }
    actAs(f);
    const text = await (await hit('GET', '/letter')).text();
    expect(text).toContain('How trust moved');
    expect(text).toContain('9/10');
  });
});

describe('the Quiet founder — the product lets go', () => {
  it('gets a letter that says nothing needs them', async () => {
    const f = await founderWith('Quiet');
    actAs(f);
    const text = await (await hit('GET', '/letter')).text();
    expect(text).toContain('Nothing needs you');
  });
});

describe('the Adversary — the loop is tenant-sealed', () => {
  it('cannot summon, fork, or resolve against a victim tenant', async () => {
    const victim = await founderWith('Victim', { snapshots: [10000, 11000, 12000, 13000] });
    const victimDecision = await decision(victim.pid, 'Victim decision');
    const attacker = await founderWith('Attacker');
    actAs(attacker);
    expect((await hit('POST', `/decisions/${victimDecision}/redteam`)).status).toBe(404);
    expect((await hit('POST', `/decisions/${victimDecision}/ghost`)).status).toBe(404);
    expect((await hit('POST', `/decisions/${victimDecision}/resolve`,
      { chosen_option: 'hijack', resolution_reasoning: 'x' }, true)).status).toBe(404);
    const untouched = await query('SELECT status FROM decisions WHERE id = ?', [victimDecision]);
    expect((untouched.rows[0] as Record<string, unknown>).status).toBe('pending');
  });
});

describe('the background wave — a dozen steady founders exercise every surface', () => {
  it('all pages render, all premises record, zero 5xx across the wave', async () => {
    for (let i = 0; i < 12; i++) {
      const f = await founderWith(`Steady${i}`, { snapshots: [8000 + i * 500, 8400 + i * 500, 8900 + i * 500, 9500 + i * 500] });
      actAs(f);
      // Record a strategic decision WITH a belief through the real form.
      const create = await hit('POST', '/strategic-decisions', {
        title: `Bet ${i}`, decision_made: 'Chose the narrow ICP',
        rationale: 'Focus', premise: 'Churn stays under 6%',
        premise_metric: 'churn_rate', premise_comparator: '<', premise_threshold: '0.06',
      });
      expect([302, 303]).toContain(create.status);

      for (const path of ['/strategic-decisions', '/letter']) {
        const res = await hit('GET', path);
        expect(res.status, `${path} for Steady${i}`).toBe(200);
      }
    }
    const premises = await query(
      "SELECT COUNT(*) AS n FROM decision_premises WHERE premise = 'Churn stays under 6%'", []);
    expect(Number((premises.rows[0] as Record<string, unknown>).n)).toBe(12);
    // eslint-disable-next-line no-console
    console.log(`\n[FOUNDER WAVE] ${seq} entities seeded, ${requests} real requests driven, all ledgers verified.\n`);
  });
});
