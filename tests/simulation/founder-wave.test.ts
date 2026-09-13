// =============================================================================
// FOUNDRY — Founder-wave simulation (the loop, lived)
//
// The walkthrough sim proved the SURFACES; this wave proves the LOOP. ~20
// simulated founders live with the system across a compressed 90 days, driving
// REAL doors against REAL migrations (model mocked, deterministic).
//
// THE DOORS CHANGED AND THE LOOP DID NOT. The decision chamber and the
// strategic-decisions form were Commercial Foundry pages and have been removed.
// Every stage below that used to press one of those buttons now goes through
// the door that survived it — `executeLoopTool`, the live MCP transport, which
// calls the same `runPreMortem`, `runGhostFork`, `resolveDecision` and
// `recordPremise` those pages called. The Letter is still a route and is still
// driven as one. What is asserted is unchanged: the LEDGER each stage leaves
// behind, not the markup it left it through.
//
// The stages:
//
//   • the Overruler — red-teamed, overrules dissent, telemetry proves the
//     Red Team right → belief expires, review vindicated, banner shows
//   • the Forker — forks reality; scenarios land; fork is idempotent
//   • the Thin founder — Ghost + radar both ABSTAIN (honesty holds under load)
//   • the Overloaded founder — a 2am decision spree → pulse notices, kindly
//   • the Radar-warned founder — churn in the peer danger tail → tap + Letter
//   • the Trusted founder — 9/10 positive outcomes → graduation proposal
//   • the Quiet founder — a letter that says "nothing needs you"
//   • the Adversary — tries to run the loop against a victim's tenant → refused
//   • + a background wave of steady founders driving the loop end to end
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
import { executeLoopTool } from '../../src/mcp/loop-tools.js';

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
async function founderWith(
  name: string,
  opts: { snapshots?: number[]; stage?: string; timezone?: string } = {},
): Promise<{ fid: string; pid: string; founder: Record<string, unknown> }> {
  const fid = `wf_f${++seq}`;
  const pid = `wf_p${seq}`;
  // A FOUNDER WHO HAS NOT SAID WHERE THEY ARE HAS NO LATE NIGHT.
  // `wellbeing/pulse.ts` counts a decision as late-night against the founder's
  // OWN clock, and refuses to guess when no timezone is stated — because
  // counting UTC hours told a US-Pacific founder that an ordinary working
  // evening was the middle of the night, in a message about their life. A
  // fixture that means "this founder decided things at 2am" has to say which
  // 2am, and this one means UTC because that is what it inserts.
  const preferences = opts.timezone ? JSON.stringify({ timezone: opts.timezone }) : null;
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, name, tier, preferences) VALUES (?, ?, ?, ?, 'growth', ?)`,
    [fid, `clk_${fid}`, `${fid}@wave.test`, name, preferences],
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

/** The loop, through the transport that still carries it. `ctx` is what an API
 *  key resolves to: the company it is scoped for, and the person who issued it.
 *  Every tool re-checks both — which is why the Adversary stage can use the
 *  same helper to prove the seal. */
async function loop(
  tool: string, args: Record<string, unknown>, f: { fid: string; pid: string },
): Promise<string> {
  requests++;
  const res = await executeLoopTool(tool, args, { productId: f.pid, founderId: f.fid });
  return res.content[0]?.text ?? '';
}

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');

  app = new Hono();
  app.use('*', async (c, next) => {
    if (currentFounder) {
      // A dashboard request carries a human session and nothing else. Setting
      // `userId`/`productId` too made this look like a session AND an API key
      // at once, and `principalOf` fails closed on that ambiguity by design —
      // two candidate principals is not a principal. The selected company
      // travels as `product`, which is what the real dashboard middleware sets.
      c.set('founder' as never, currentFounder as never);
      if (currentProductId) c.set('product' as never, { id: currentProductId } as never);
      c.set('csrfToken' as never, 'test' as never);
    }
    await next();
  });
  app.route('/', letterRoutes);
});

// ─── The wave ─────────────────────────────────────────────────────────────────

describe('the Overruler — dissent, overruled, vindicated', () => {
  it('lives the full contest→commit→observe→learn arc through real doors', async () => {
    const f = await founderWith('Overruler', { snapshots: [10000, 10600, 11200, 11900] });
    actAs(f);
    const d = await decision(f.pid, 'Raise Solo price to $99');

    // Summon the Red Team through the live door.
    const rt = await loop('foundry_red_team', { decision_id: d }, f);
    const review = await query('SELECT verdict FROM red_team_reviews WHERE decision_id = ?', [d]);
    expect((review.rows[0] as Record<string, unknown>).verdict).toBe('do_not_proceed');

    // And the dissent comes back to the caller, not only to the table — the
    // founder has to be able to READ what was argued before overruling it.
    expect(rt).toContain('do_not_proceed');
    expect(rt).toContain('Churn breaches 8%');

    // Overrule: resolve past the dissent (gate-3 needs reasoning).
    const res = await loop('foundry_resolve_decision',
      { decision_id: d, chosen_option: 'Raise price', reasoning: 'Margin matters more' }, f);
    expect(res).not.toMatch(/^Error/);
    expect(res, 'the overruling says what it now owes')
      .toContain('monitored premises');

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
  it('gets ordered scenario bands from its own history via the real door', async () => {
    const f = await founderWith('Forker', { snapshots: [20000, 21000, 22100, 23200, 24400] });
    actAs(f);
    const d = await decision(f.pid, 'Launch annual plans');
    const forked = await loop('foundry_fork_reality', { decision_id: d }, f);
    expect(forked).not.toMatch(/^Abstained/);

    const rows = await query('SELECT option_label, base_case FROM scenario_models WHERE decision_id = ?', [d]);
    expect(rows.rows.length).toBe(3); // ghost + 2 options
    expect((rows.rows as Array<Record<string, string>>).some((r) => r.option_label.includes('Ghost'))).toBe(true);

    await loop('foundry_fork_reality', { decision_id: d }, f); // second fork must not duplicate
    const again = await query('SELECT COUNT(*) AS n FROM scenario_models WHERE decision_id = ?', [d]);
    expect(Number((again.rows[0] as Record<string, unknown>).n)).toBe(3);

    // And the second call hands back what was already stored rather than
    // silence — the fork data itself, including the do-nothing baseline.
    const second = await loop('foundry_fork_reality', { decision_id: d }, f);
    expect(second).toContain('Ghost (do nothing)');
  });
});

describe('the Thin founder — honesty under thin data', () => {
  it('Ghost abstains and the radar stays silent rather than fabricate', async () => {
    const f = await founderWith('Thin', { snapshots: [5000, 5200] });
    actAs(f);
    const d = await decision(f.pid, 'Big bet on outbound');
    const answer = await loop('foundry_fork_reality', { decision_id: d }, f);
    expect(answer, 'it says it abstained rather than inventing a band')
      .toMatch(/^Abstained/);
    const rows = await query('SELECT COUNT(*) AS n FROM scenario_models WHERE decision_id = ?', [d]);
    expect(Number((rows.rows[0] as Record<string, unknown>).n)).toBe(0); // abstained

    const { scanForWarnings } = await import('../../src/services/network/radar.js');
    expect(await scanForWarnings(f.pid)).toEqual([]); // no peer cell → silence
  });
});

describe('the Overloaded founder — the pulse notices', () => {
  it('a 2am decision spree triggers one kind, numbers-shown note', async () => {
    const f = await founderWith('Overloaded', { timezone: 'UTC' });
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
    expect(text).toContain('4%');
  });
});

describe('the Trusted founder — autonomy is earned on the record', () => {
  it('9/10 positive marketing outcomes produce a graduation proposal in The Letter', async () => {
    const f = await founderWith('Trusted');
    for (let i = 0; i < 10; i++) {
      await query(
        // FOUNDRY PROPOSED IT AND THE FOUNDER TOOK IT. The ledger prices
        // autonomy on Foundry's OWN record, and `decided_by = 'founder'` says
        // who resolved the row, not who proposed it — so this fixture used to
        // earn Foundry a gate with ten decisions the founder made themselves.
        // The recommendation and the matching choice are what a proposal
        // Foundry made and the founder accepted looks like in this table.
        `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status, decided_by, decided_at, outcome_valence, recommendation, chosen_option)
         VALUES (?, ?, 'marketing', 1, 'x', 'y', 'approved', 'founder', datetime('now','-10 days'), ?, 'Run it', 'run it')`,
        [`wf_d${++seq}`, f.pid, i < 9 ? 1 : -1]);
    }
    actAs(f);
    const text = await (await hit('GET', '/letter')).text();
    expect(text).toContain('How trust moved');
    expect(text).toContain('9/10');
  });
});

describe('the Quiet founder — the product lets go', () => {
  it('gets a letter that says nothing needs them', async () => {
    // An ESTABLISHED founder on a calm day (has history, nothing pending) —
    // distinct from a brand-new founder, who correctly sees the first-run
    // welcome instead of the "nothing needs you" rest state.
    const f = await founderWith('Quiet', { snapshots: [10000, 10000, 10000, 10000] });
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
    // A key scoped for the attacker's company, pointed at the victim's decision
    // id. Every tool resolves the decision WITHIN its own company first, so the
    // id buys nothing.
    expect(await loop('foundry_red_team', { decision_id: victimDecision }, attacker))
      .toMatch(/not found in this company/);
    expect(await loop('foundry_fork_reality', { decision_id: victimDecision }, attacker))
      .toMatch(/^Abstained/);
    expect(await loop('foundry_resolve_decision',
      { decision_id: victimDecision, chosen_option: 'hijack', reasoning: 'x' }, attacker))
      .toMatch(/not found in this company/);

    const untouched = await query('SELECT status FROM decisions WHERE id = ?', [victimDecision]);
    expect((untouched.rows[0] as Record<string, unknown>).status).toBe('pending');
    // Nothing of the victim's was written on the way past, either.
    expect((await query('SELECT id FROM red_team_reviews WHERE decision_id = ?', [victimDecision])).rows)
      .toHaveLength(0);
    expect((await query('SELECT id FROM scenario_models WHERE decision_id = ?', [victimDecision])).rows)
      .toHaveLength(0);
  });
});

describe('the background wave — a dozen steady founders drive the loop', () => {
  it('the Letter renders, all premises record, nothing fails across the wave', async () => {
    for (let i = 0; i < 12; i++) {
      const f = await founderWith(`Steady${i}`, { snapshots: [8000 + i * 500, 8400 + i * 500, 8900 + i * 500, 9500 + i * 500] });
      actAs(f);
      // Record a strategic decision WITH a belief through the live door.
      const create = await loop('foundry_record_decision', {
        title: `Bet ${i}`, decision: 'Chose the narrow ICP',
        rationale: 'Focus', premise: 'Churn stays under 6%',
        premise_metric: 'churn_rate', premise_comparator: '<', premise_threshold: 0.06,
      }, f);
      expect(create, `Steady${i} recorded no decision`).toContain('Premise recorded');

      const res = await hit('GET', '/letter');
      expect(res.status, `/letter for Steady${i}`).toBe(200);
    }
    const premises = await query(
      "SELECT COUNT(*) AS n FROM decision_premises WHERE premise = 'Churn stays under 6%'", []);
    expect(Number((premises.rows[0] as Record<string, unknown>).n)).toBe(12);
    // eslint-disable-next-line no-console
    console.log(`\n[FOUNDER WAVE] ${seq} entities seeded, ${requests} real requests driven, all ledgers verified.\n`);
  });
});
