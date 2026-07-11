// =============================================================================
// Tests: Fluency — one product, many voices
// The dial changes vocabulary and hand-holding, NEVER features: the same Letter
// renders for a plain and a technical founder with identical facts and actions,
// different words. Explicit choices survive onboarding defaults.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, it, expect, beforeAll } from 'vitest';
import { Hono } from 'hono';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  getFluency, setFluency, setFluencyDefault, gateLabel, rate, explain, term,
  extractPremiseCondition, metricLabel, metricValue, riskLabel, navExplain,
} from '../../src/services/ux/fluency.js';
import { composeLetter } from '../../src/services/letter/composer.js';

let app: Hono;
let currentFounder: Record<string, unknown> = {};

beforeAll(async () => {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query(
    `INSERT INTO founders (id, clerk_user_id, email, preferences) VALUES ('fl_f','clk_fl','f@t.co', ?)`,
    [JSON.stringify({ digest_time: '08:00' })],
  );
  await query("INSERT INTO products (id, name, owner_id) VALUES ('fl_p','FlCo','fl_f')", []);
  await query(
    `INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
     VALUES ('fl_d1', 'fl_p', 'strategic', 3, 'Enter enterprise', 'pull', 'pending')`,
    [],
  );

  const { letterRoutes } = await import('../../src/routes/dashboard/letter.js');
  const { decisionRoutes } = await import('../../src/routes/dashboard/decisions.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never, currentFounder as never);
    c.set('csrfToken' as never, 't' as never);
    await next();
  });
  app.route('/', letterRoutes);
  app.route('/', decisionRoutes);
});

describe('the dial', () => {
  it('defaults to balanced; parses off hydrated preferences', () => {
    expect(getFluency(null)).toBe('balanced');
    expect(getFluency({ preferences: null })).toBe('balanced');
    expect(getFluency({ preferences: { fluency: 'plain' } })).toBe('plain');
    expect(getFluency({ preferences: { fluency: 'weird' as never } })).toBe('balanced');
  });

  it('setFluency JSON-merges (other preferences survive)', async () => {
    await setFluency('fl_f', 'plain');
    const r = await query("SELECT preferences FROM founders WHERE id='fl_f'", []);
    const prefs = JSON.parse((r.rows[0] as Record<string, string>).preferences);
    expect(prefs.fluency).toBe('plain');
    expect(prefs.digest_time).toBe('08:00'); // untouched
  });

  it('onboarding defaults never override an explicit choice', async () => {
    await setFluencyDefault('fl_f', 'technical'); // founder already chose plain
    const r = await query("SELECT preferences FROM founders WHERE id='fl_f'", []);
    expect(JSON.parse((r.rows[0] as Record<string, string>).preferences).fluency).toBe('plain');
  });

  it('vocabulary never hides the technical truth at plain fluency', () => {
    expect(gateLabel(3, 'plain')).toBe('Big decision (gate 3)'); // number kept
    expect(gateLabel(3, 'technical')).toBe('Gate-3');
    expect(rate(0.05, 'plain')).toBe('5%');
    expect(rate(0.05, 'technical')).toBe('0.05');
    expect(term('falsified', 'plain')).toBe('no longer true');
    expect(explain('controls', 'technical')).toBe(''); // experts get silence
    expect(explain('controls', 'plain').length).toBeGreaterThan(50);
  });
});

describe('plain-text premise extraction (no dropdowns, ever)', () => {
  it('parses the common phrasings into monitored conditions', () => {
    expect(extractPremiseCondition('churn stays under 5%'))
      .toEqual({ metricKey: 'churn_rate', comparator: '<', threshold: 0.05 });
    expect(extractPremiseCondition('NPS stays above 40'))
      .toEqual({ metricKey: 'nps_score', comparator: '>=', threshold: 40 });
    expect(extractPremiseCondition('retention at least 60%'))
      .toEqual({ metricKey: 'day_30_retention', comparator: '>=', threshold: 0.6 });
    expect(extractPremiseCondition('activation at most 30 percent'))
      .toEqual({ metricKey: 'activation_rate', comparator: '<=', threshold: 0.3 });
  });
  it('returns null (→ qualitative premise) when it cannot parse honestly', () => {
    expect(extractPremiseCondition('our users love the brand')).toBeNull();
    expect(extractPremiseCondition('churn is basically fine')).toBeNull(); // no comparator/number
  });
  it('metric/risk translation keeps the technical truth visible', () => {
    expect(metricLabel('churn_rate', 'plain')).toBe('customers leaving monthly');
    expect(metricValue('churn_rate', 0.07, 'plain')).toBe('7%');
    expect(metricValue('nps_score', 42, 'plain')).toBe('42');
    expect(riskLabel('yellow', 'plain')).toBe('needs attention (yellow)');
    expect(riskLabel('yellow', 'technical')).toBe('yellow');
  });
});

describe('the layout explainer strip', () => {
  it('covers every expert page; silent at technical; never doubles in-page strips', () => {
    for (const nav of ['agents', 'agents-debate', 'agents-accuracy', 'memory', 'network', 'roi', 'benchmarks']) {
      expect(navExplain(nav, 'plain').length).toBeGreaterThan(40);
      expect(navExplain(nav, 'balanced').length).toBeGreaterThan(20);
      expect(navExplain(nav, 'technical')).toBe('');
    }
    // pages that render their own strip must be absent from the layout map:
    for (const nav of ['dashboard', 'decisions', 'agents-briefings', 'letter', 'autopilot', 'talk']) {
      expect(navExplain(nav, 'plain')).toBe('');
    }
  });
});

describe('same product, different voice', () => {
  it('the Letter composer: identical facts, dialed phrasing', async () => {
    const plain = await composeLetter('fl_p', 'plain');
    const technical = await composeLetter('fl_p', 'technical');
    // Same facts in both voices — the one thing that needs you:
    expect(plain.needsYou).toContain('Enter enterprise');
    expect(technical.needsYou).toContain('Enter enterprise');
    expect(plain.needsYou).toEqual(technical.needsYou); // gate translation happens at the route
    expect(plain.quiet).toBe(technical.quiet);
  });

  it('the Letter shows identical facts and actions at both extremes', async () => {
    currentFounder = { id: 'fl_f', email: 'f@t.co', preferences: { fluency: 'plain' } };
    const plain = await (await app.request('/letter')).text();
    currentFounder = { id: 'fl_f', email: 'f@t.co', preferences: { fluency: 'technical' } };
    const technical = await (await app.request('/letter')).text();

    // Same facts + same actions in both:
    for (const doc of [plain, technical]) {
      expect(doc).toContain('Enter enterprise');           // the decision itself
      expect(doc).toContain('The one thing that needs you');
      expect(doc).toContain('/decisions');                 // the same action
    }
    // Different voice:
    expect(plain).toContain('Big decision (gate 3)');
    expect(plain).toContain('daily letter');               // hand-holding intro
    expect(technical).toContain('Gate-3');
    expect(technical).not.toContain('daily letter');       // no hand-holding
  });

  it('the decision chamber: identical facts, translated instruments', async () => {
    currentFounder = { id: 'fl_f', email: 'f@t.co', preferences: { fluency: 'plain' } };
    const plain = await (await app.request('/decisions/fl_d1')).text();
    currentFounder = { id: 'fl_f', email: 'f@t.co', preferences: { fluency: 'technical' } };
    const technical = await (await app.request('/decisions/fl_d1')).text();

    for (const doc of [plain, technical]) {
      expect(doc).toContain('Enter enterprise');                 // the decision
      expect(doc).toContain(`/decisions/fl_d1/redteam`);         // same instrument, both voices
      expect(doc).toContain(`/decisions/fl_d1/ghost`);           // same instrument, both voices
    }
    expect(plain).toContain('Hear the devil');               // "devil's advocate" (apostrophe HTML-escaped)
    expect(plain).toContain('Big decision (gate 3)');
    expect(plain).toContain('See how each option could play out');
    expect(technical).toContain('Summon the Red Team (adversarial pre-mortem)');
    expect(technical).toContain('Gate-3');
    expect(technical).toContain('1,000 runs on your real growth history');
  });
});
