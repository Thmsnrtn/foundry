// =============================================================================
// FOUNDRY — An economic object is a place, and this is its geography.
//
// A company page was one long scroll: banner, hero, advice, proposals, asks,
// numbers, and ten folds. Everything was there and nothing had an address, so
// "where are the experiments for this" had no answer except "somewhere below".
//
// This reads the institutional rows a company has and projects them into a
// fixed geography: an identity line (what this object is, in the fewest chips
// that answer it) and DIMENSIONS — Overview, Work, Economics, Customers,
// Experiments, Evidence — in an order that never changes. A dimension exists
// only when the institution actually holds rows for it; it is never drawn
// empty to look complete. But once it exists, it is always in the same place.
//
// GENERIC BY CONSTRUCTION. Nothing here knows any particular company. Every
// chip and every count is read from a table any economic object can have
// rows in, so a farm-software company, an API and a test asset with a budget
// all get the same geography, differently filled. No composite score is ever
// computed: a chip is a fact with a row behind it, or it is not shown.
// =============================================================================
import { query, realCompany } from '../../db/client.js';
import { POSTURE_IN_PLAIN_WORDS } from './burden.js';

export type DimensionKey =
  'overview' | 'work' | 'economics' | 'customers' | 'experiments' | 'evidence';

export interface Dimension {
  key: DimensionKey;
  label: string;
  href: string;
  /** What is in it, said as a number where a number is honest; null otherwise. */
  count: number | null;
}

export interface CompanyPlace {
  id: string;
  name: string;
  /** Identity, in chips: form · reality · standing · layer · posture · what Foundry is doing. */
  chips: string[];
  /** One line: is Foundry doing anything here, and does anything need him. */
  doing: string;
  needsHim: number;
  dimensions: Dimension[];
}

/** The fixed order. A dimension never appears anywhere but its slot. */
const ORDER: Array<{ key: DimensionKey; label: string; path: string }> = [
  { key: 'overview', label: 'Overview', path: '' },
  { key: 'work', label: 'Work', path: '/work' },
  { key: 'economics', label: 'Economics', path: '/economics' },
  { key: 'customers', label: 'Customers', path: '/customers' },
  { key: 'experiments', label: 'Experiments', path: '/experiments' },
  { key: 'evidence', label: 'Evidence', path: '/evidence' },
];

/** Senses whose readings are about people who pay, not about the machine. */
export const CUSTOMER_SENSES = new Set(['customers', 'support', 'intercom', 'product_usage', 'posthog', 'plausible']);

async function one(sql: string, params: unknown[]): Promise<number> {
  const rows = (await query(sql, params)).rows as unknown as Array<Record<string, unknown>>;
  return Number(rows[0]?.n ?? 0);
}

/**
 * Read the geography of one company. Null when it is not his or does not exist:
 * a company of someone else's and one that never was answer the same.
 */
export async function placeOf(founderId: string, productId: string): Promise<CompanyPlace | null> {
  // NO REALITY PREDICATE, AND THIS IS THE ONE PLACE THAT IS RIGHT: he is on
  // the company's own page. `reality` is read and becomes the first chip, so
  // an invented company is disclosed before anything else is said about it.
  const rows = (await query(
    `SELECT id, name, reality, standing, posture, form, from_opportunity_id
       FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`,
    [productId, founderId])).rows as unknown as Array<Record<string, unknown>>;
  const p = rows[0];
  if (!p) return null;
  const id = String(p.id);
  const opportunityId = p.from_opportunity_id ? String(p.from_opportunity_id) : null;

  const [proposals, advice, asks, responsibilities, workspaces, ventureTests, legacyTests,
    numbers, allowance, spend, customerSenses, legal, facts, resolutions, mrr] = await Promise.all([
    one(`SELECT COUNT(*) AS n FROM proposed_acts WHERE product_id = ? AND decision IS NULL
           AND revoked_at IS NULL AND expires_at > CURRENT_TIMESTAMP`, [id]),
    one(`SELECT COUNT(*) AS n FROM situation_recommendations WHERE product_id = ? AND decided_at IS NULL`, [id]),
    one(`SELECT COUNT(*) AS n FROM responsibility_candidates WHERE product_id = ? AND status = 'pending'`, [id]),
    one(`SELECT COUNT(*) AS n FROM institutional_responsibilities WHERE product_id = ? AND state <> 'unknown'`, [id]),
    one(`SELECT COUNT(*) AS n FROM workspaces WHERE subject_kind = 'company' AND subject_id = ?
           AND destroyed_at IS NULL`, [id]),
    opportunityId
      ? one(`SELECT COUNT(*) AS n FROM venture_experiments WHERE opportunity_id = ?`, [opportunityId])
      : Promise.resolve(0),
    one(`SELECT COUNT(*) AS n FROM experiments WHERE product_id = ?`, [id]),
    one(`SELECT COUNT(*) AS n FROM metric_snapshots WHERE product_id = ?`, [id]),
    one(`SELECT COUNT(*) AS n FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL`, [id])
      .catch(() => 0),
    one(`SELECT COUNT(*) AS n FROM asset_money_spent WHERE product_id = ?`, [id]),
    one(`SELECT COUNT(*) AS n FROM company_senses WHERE product_id = ? AND disconnected_at IS NULL
           AND sense_key IN (${[...CUSTOMER_SENSES].map(() => '?').join(',')})`, [id, ...CUSTOMER_SENSES]),
    one(`SELECT COUNT(*) AS n FROM legal_surfaces WHERE subject_kind = 'company' AND subject_id = ?
           AND retired_at IS NULL`, [id]),
    one(`SELECT COUNT(*) AS n FROM structural_facts WHERE subject_kind = 'company' AND subject_id = ?
           AND superseded_at IS NULL`, [id]),
    opportunityId
      ? one(`SELECT COUNT(*) AS n FROM prediction_resolutions WHERE prediction_id IN
               (SELECT id FROM venture_experiments WHERE opportunity_id = ?)`, [opportunityId])
      : Promise.resolve(0),
    (async () => {
      const r = (await query(
        `SELECT mrr_cents FROM metric_snapshots WHERE product_id = ? AND mrr_cents IS NOT NULL
            AND snapshot_date >= date('now','-45 day') ORDER BY snapshot_date DESC LIMIT 1`, [id]))
        .rows as unknown as Array<Record<string, unknown>>;
      return r[0]?.mrr_cents == null ? null : Number(r[0].mrr_cents);
    })(),
  ]);

  // ── identity ────────────────────────────────────────────────────────────
  const chips: string[] = [];
  if (String(p.reality) === 'reference') chips.push('invented');
  if (String(p.standing) === 'experimental') chips.push('a test, not a company');
  if (p.form) chips.push(String(p.form));
  if (String(p.reality) === 'real' && String(p.standing) === 'earned') {
    chips.push(mrr === null ? 'not reporting revenue' : mrr >= 100_000 ? 'anchor' : 'tributary');
  }
  const posture = String(p.posture);
  if (posture !== 'grow') {
    chips.push(`you have me ${POSTURE_IN_PLAIN_WORDS[posture as keyof typeof POSTURE_IN_PLAIN_WORDS] ?? posture}`);
  }

  const needsHim = proposals + advice + asks;
  const doing = needsHim > 0
    ? `${String(needsHim)} ${needsHim === 1 ? 'thing needs' : 'things need'} you`
    : responsibilities > 0 || workspaces > 0
      ? `looking after ${String(responsibilities)} ${responsibilities === 1 ? 'thing' : 'things'}`
        + (workspaces > 0 ? `, ${String(workspaces)} ${workspaces === 1 ? 'workspace' : 'workspaces'} live` : '')
      : 'watching, not acting';
  chips.push(doing);

  // ── dimensions, present only where rows are ────────────────────────────
  const present: Partial<Record<DimensionKey, number | null>> = {
    overview: null,
    // Work always exists: "is Foundry doing anything here" must have an
    // address even when the answer is no.
    work: needsHim + responsibilities + workspaces + ventureTests,
  };
  if (numbers > 0 || allowance > 0 || spend > 0 || mrr !== null) present.economics = null;
  if (customerSenses > 0) present.customers = customerSenses;
  if (ventureTests + legacyTests > 0) present.experiments = ventureTests + legacyTests;
  if (legal + facts + resolutions > 0) present.evidence = legal + facts + resolutions;

  const dimensions = ORDER.filter((d) => d.key in present).map((d) => ({
    key: d.key, label: d.label, href: `/foundry/companies/${id}${d.path}`,
    count: present[d.key] ?? null,
  }));

  return { id, name: String(p.name), chips, doing, needsHim, dimensions };
}

/**
 * THE PORTFOLIO AS A MAP. Every company he owns with the one line that
 * locates it: what it is, what state it is in, whether it needs him. Read
 * for the map view, where the question is "what exactly do I own and how do I
 * reach it" rather than "what shape is my cash flow".
 */
export interface MapEntry {
  id: string; name: string; reference: boolean; experimental: boolean;
  form: string | null; posture: string;
  situation: string; headline: string; days: number;
  needsHim: number; watching: boolean; testing: boolean; canSee: number;
}

export async function mapOf(founderId: string): Promise<MapEntry[]> {
  const rows = (await query(
    `SELECT p.id, p.name, p.reality, p.standing, p.posture, p.form, p.from_opportunity_id,
            (SELECT COUNT(*) FROM proposed_acts a WHERE a.product_id = p.id AND a.decision IS NULL
                AND a.revoked_at IS NULL AND a.expires_at > CURRENT_TIMESTAMP)
            + (SELECT COUNT(*) FROM situation_recommendations r WHERE r.product_id = p.id AND r.decided_at IS NULL)
            + (SELECT COUNT(*) FROM responsibility_candidates rc WHERE rc.product_id = p.id AND rc.status = 'pending')
              AS needs,
            (SELECT COUNT(*) FROM institutional_responsibilities ir WHERE ir.product_id = p.id AND ir.state <> 'unknown') AS watching,
            (SELECT COUNT(*) FROM company_senses cs WHERE cs.product_id = p.id AND cs.disconnected_at IS NULL) AS can_see,
            (SELECT COUNT(*) FROM venture_experiments ve WHERE ve.opportunity_id = p.from_opportunity_id
                AND ve.decision = 'approved' AND ve.ran_at IS NULL) AS testing,
            s.situation, s.headline, s.began_at
       FROM products p
       LEFT JOIN company_situations s ON s.product_id = p.id AND s.ended_at IS NULL
      WHERE p.owner_id = ? AND ${realCompany('p')} AND p.status = 'active' AND p.deleted_at IS NULL
      ORDER BY needs DESC, p.name COLLATE NOCASE`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  return rows.map((r) => ({
    id: String(r.id), name: String(r.name),
    reference: String(r.reality) === 'reference', experimental: String(r.standing) === 'experimental',
    form: r.form ? String(r.form) : null, posture: String(r.posture),
    situation: r.situation ? String(r.situation) : 'unknown',
    headline: r.headline ? String(r.headline) : 'I have not looked at it yet.',
    days: r.began_at
      ? Math.max(0, Math.floor((Date.now() - new Date(String(r.began_at)).getTime()) / 86_400_000)) : 0,
    needsHim: Number(r.needs), watching: Number(r.watching) > 0,
    testing: Number(r.testing) > 0, canSee: Number(r.can_see),
  }));
}
