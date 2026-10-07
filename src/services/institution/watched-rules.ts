// =============================================================================
// FOUNDRY — the institution's own rules, read back from its rows
//
// The twin's invariant monitor (tests/simulation/invariants.ts) checks, after
// every simulated day, rules the institution already holds. Six of them can
// be read from the database alone, cheaply and without writing anything, and
// those are the ones a real day can break too — so they live here, are read
// by the monitor in every simulated world, and are read by the hourly pulse in
// production (`institution_pulse_tick`), which finishes its pass and then
// fails with what it found, the way every watched loop says when its work
// failed. Nothing here repairs anything: a broken rule is reported, never
// quietly put right.
//
// Each rule names where the institution states or enforces it. The rest of
// the monitor's rules need the providers' state (pages, mail, refunds at the
// payment provider) or a full scan, and stay in the monitor.
// =============================================================================
import { query } from '../../db/client.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

export interface WatchedRule {
  id: string;
  rule: string;
  derivedFrom: string;
  /** Each violation as a sentence naming the row. Empty is kept. */
  check(founderId: string): Promise<string[]>;
}

/** The thinking bound before any charter is signed (institution/charter.ts PRE_CHARTER_THINKING_CENTS). */
async function preCharterCents(): Promise<number> {
  const { PRE_CHARTER_THINKING_CENTS } = await import('./charter.js');
  return PRE_CHARTER_THINKING_CENTS;
}

export const WATCHED_RULES: readonly WatchedRule[] = [
  {
    id: 'decided-inside-the-charter',
    rule: 'Every placed test was decided by the owner, or by a live charter he signed that carved it, and no charter carved more than it allows.',
    derivedFrom: 'CONSTITUTION.md "The charter"; charter.ts chartered() and carve(); hand.ts allowExperiment',
    async check(founderId) {
      const out: string[] = [];
      for (const r of await rows(`
        SELECT DISTINCT x.experiment_id, e.decided_by, e.decided_at
          FROM experiment_exposures x JOIN venture_experiments e ON e.id = x.experiment_id
         WHERE x.founder_id = ? AND x.evidence_mode = 'real'`, [founderId])) {
        const by = String(r.decided_by ?? '');
        if (by === `founder:${founderId}`) continue;
        const m = /^charter:(.+)$/.exec(by);
        if (!m) { out.push(`test ${String(r.experiment_id)} was placed, decided by "${by || 'nobody'}"`); continue; }
        const env = (await rows(`SELECT signed_by, expires_at FROM portfolio_envelopes WHERE id = ?`, [m[1]]))[0];
        if (!env || String(env.signed_by) !== `founder:${founderId}`) { out.push(`test ${String(r.experiment_id)} was decided under a charter the owner did not sign`); continue; }
        if (String(r.decided_at ?? '') > String(env.expires_at)) out.push(`test ${String(r.experiment_id)} was decided after its charter expired`);
        if ((await rows(`SELECT 1 FROM portfolio_envelope_carves WHERE experiment_id = ? AND envelope_id = ?`, [r.experiment_id, m[1]])).length === 0) {
          out.push(`test ${String(r.experiment_id)} was let in under a charter with no carve`);
        }
      }
      for (const e of await rows(`
        SELECT e.id, e.tests_total_cents, COALESCE(SUM(c.cents), 0) AS carved
          FROM portfolio_envelopes e LEFT JOIN portfolio_envelope_carves c ON c.envelope_id = e.id
         WHERE e.founder_id = ? GROUP BY e.id`, [founderId])) {
        if (Number(e.carved) > Number(e.tests_total_cents)) out.push(`charter ${String(e.id)} carved $${(Number(e.carved) / 100).toFixed(2)} of $${(Number(e.tests_total_cents) / 100).toFixed(2)}`);
      }
      return out;
    },
  },
  {
    id: 'owner-only-stays-owners',
    rule: 'No owner-only decision is taken by the institution: his policy rows, his charters, released holds and decided acts bear him (or, for an act on an absorbable rung, a charter he signed).',
    derivedFrom: 'CONSTITUTION.md "Only the owner decides" and the charter amendment (migration 319); legal-surface.ts supersedeOriginationPolicy; printable.ts releaseHeldPrintable',
    async check(founderId) {
      const out: string[] = [];
      const me = `founder:${founderId}`;
      for (const r of await rows(`SELECT requirement, set_by FROM origination_policy WHERE founder_id = ?`, [founderId])) {
        if (String(r.set_by) !== me) out.push(`the owner's policy "${String(r.requirement)}" was set by ${String(r.set_by)}`);
      }
      for (const r of await rows(`SELECT id, signed_by FROM portfolio_envelopes WHERE founder_id = ?`, [founderId])) {
        if (String(r.signed_by) !== me) out.push(`charter ${String(r.id)} was signed by ${String(r.signed_by)}`);
      }
      // EVERY company's acts, the reference one's too: this reads for a broken
      // rule, never for owner truth, and a rule broken in rehearsal is broken;
      // STANDING DOES NOT APPLY either: an experimental asset's act is an act.
      for (const r of await rows(`
        SELECT a.id, a.decided_by, a.rung FROM proposed_acts a JOIN products p ON p.id = a.product_id
         WHERE p.owner_id = ? AND a.decided_by IS NOT NULL`, [founderId])) {
        const by = String(r.decided_by);
        if (by === me) continue;
        if (!by.startsWith('charter:')) out.push(`act ${String(r.id)} was decided by ${by}`);
        else if (r.rung === 'legal' || r.rung === 'destructive') out.push(`act ${String(r.id)} on the ${String(r.rung)} rung was decided by a charter`);
      }
      for (const r of await rows(`SELECT experiment_id, body FROM experiment_materials WHERE founder_id = ? AND kind = 'offer_shape' AND body LIKE '%"releasedBy"%'`, [founderId])) {
        const by = /"releasedBy":"([^"]*)"/.exec(String(r.body))?.[1] ?? '';
        if (by !== me) out.push(`a held file for ${String(r.experiment_id)} was released by "${by}"`);
      }
      return out;
    },
  },
  {
    id: 'the-file-paid-for',
    rule: 'Every delivered file is the version the buyer paid for: the hash on the fulfilment is the hash the offer was selling when the payment arrived.',
    derivedFrom: 'products/printable.ts checkPrintable and downloadFor ("never a later one silently")',
    async check(founderId) {
      const out: string[] = [];
      for (const f of await rows(`
        SELECT f.id, f.experiment_id, f.delivered_files_json, b.recorded_at AS paid_at
          FROM experiment_fulfilments f JOIN business_outcome_events b ON b.id = f.payment_event_id
         WHERE f.founder_id = ? AND f.delivered_files_json IS NOT NULL`, [founderId])) {
        let sent: string | null = null;
        try { sent = (JSON.parse(String(f.delivered_files_json)) as Array<{ sha256?: string }>)[0]?.sha256 ?? null; } catch { sent = null; }
        if (!sent) { out.push(`fulfilment ${String(f.id)} records no file`); continue; }
        const shapes = await rows(`SELECT body, recorded_at FROM experiment_materials WHERE experiment_id = ? AND kind = 'offer_shape' ORDER BY recorded_at, rowid`, [f.experiment_id]);
        const selling = shapes.filter((s) => String(s.recorded_at) <= String(f.paid_at)).pop() ?? shapes[0];
        let sold: string | null = null;
        try { sold = (JSON.parse(String(selling?.body ?? '{}')) as { printable?: { sha256?: string } }).printable?.sha256 ?? null; } catch { sold = null; }
        if (sold !== null && sold !== sent) out.push(`fulfilment ${String(f.id)} delivered ${sent.slice(0, 12)} but the offer sold ${sold.slice(0, 12)}`);
      }
      return out;
    },
  },
  {
    id: 'refunds-asked-are-made',
    rule: 'A refund asked for through the signed link is made within a day of asking.',
    derivedFrom: 'the public promise "If you buy something and it is no use to you, you can have your money back" (scripts/audit-public-claims.mjs); hand.ts requestRefundByLink',
    async check(founderId) {
      return (await rows(`
        SELECT id, CAST((julianday('now') - julianday(refund_requested_at)) * 24 AS INTEGER) AS hours
          FROM experiment_fulfilments
         WHERE founder_id = ? AND refund_requested_at IS NOT NULL AND status <> 'refunded' AND refund_ref IS NULL
           AND julianday('now') - julianday(refund_requested_at) >= 1`, [founderId]))
        .map((f) => `fulfilment ${String(f.id)}: a refund asked for ${String(f.hours)} hours ago has not been made`);
    },
  },
  {
    id: 'found-nothing-is-not-support',
    rule: 'No candidate stands on fewer independent ways of knowing than promotion needs once searches that found nothing are left out.',
    derivedFrom: 'market-evidence.ts bearingAsRead (F1.7: "never counted as support"); seeds.ts promote / whatItWouldTakeToBelieve (two independent stances)',
    async check(founderId) {
      return (await rows(`
        SELECT s.seed, s.promoted_to,
               (SELECT COUNT(DISTINCT t.epistemic_stance) FROM market_claims c
                  JOIN market_observations o ON o.claim_id = c.id
                  JOIN market_source_types t ON t.source_type = o.source_type
                 WHERE c.seed_id = s.id AND o.evidence_mode <> 'reference' AND t.epistemic_stance <> 'rehearsal'
                   AND o.from_absence = 0) AS stances
          FROM opportunity_seeds s
         WHERE s.founder_id = ? AND s.promoted_to IS NOT NULL AND s.evidence_mode = 'real'`, [founderId]))
        .filter((r) => Number(r.stances) < 2)
        .map((r) => `candidate ${String(r.promoted_to)} ("${String(r.seed).slice(0, 60)}") stands on ${String(r.stances)} way(s) of knowing once searches that found nothing are left out`);
    },
  },
  {
    id: 'thinking-within-the-allowance',
    rule: 'A day\'s thinking stays within the charter\'s daily rate, or the bound before a charter, and no buyer is refunded more than they paid.',
    derivedFrom: 'institution/spending.ts thinkingToday (the binding ceiling); charter cognition_cents_per_day; hand.ts refundFulfilment',
    async check(founderId) {
      const out: string[] = [];
      const pre = await preCharterCents();
      const charters = await rows(`SELECT signed_at, expires_at, cognition_cents_per_day FROM portfolio_envelopes WHERE founder_id = ?`, [founderId]);
      for (const d of await rows(`SELECT date, spent_cents FROM ai_daily_spend WHERE scope = 'founder' AND scope_id = ?`, [founderId])) {
        const day = String(d.date).slice(0, 10);
        const standing = charters.filter((c) => String(c.signed_at).slice(0, 10) <= day && String(c.expires_at).slice(0, 10) >= day);
        const allowed = standing.length ? Math.max(...standing.map((c) => Number(c.cognition_cents_per_day))) : pre;
        // A cent of slack for a reservation's rounding; no more.
        if (Number(d.spent_cents) > allowed + 1) out.push(`thinking on ${String(d.date)} was $${(Number(d.spent_cents) / 100).toFixed(2)} against $${(allowed / 100).toFixed(2)} allowed`);
      }
      for (const f of await rows(`
        SELECT f.id, f.amount_cents, (SELECT COALESCE(SUM(ABS(amount_cents)), 0) FROM economic_events l WHERE l.fulfilment_id = f.id AND l.kind = 'refund') AS back
          FROM experiment_fulfilments f WHERE f.founder_id = ?`, [founderId])) {
        if (Number(f.back) > Number(f.amount_cents)) out.push(`fulfilment ${String(f.id)} returned $${(Number(f.back) / 100).toFixed(2)} of $${(Number(f.amount_cents) / 100).toFixed(2)} paid`);
      }
      return out;
    },
  },
];

/** Every watched rule this owner's rows break now, by rule. A rule whose reading throws is reported as broken: an unreadable rule is not a kept one. */
export async function brokenRules(founderId: string): Promise<Array<{ id: string; violations: string[] }>> {
  const out: Array<{ id: string; violations: string[] }> = [];
  for (const r of WATCHED_RULES) {
    let violations: string[];
    try { violations = await r.check(founderId); } catch (err) { violations = [`the rule could not be read: ${err instanceof Error ? err.message : String(err)}`]; }
    if (violations.length) out.push({ id: r.id, violations });
  }
  return out;
}
