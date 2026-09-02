// =============================================================================
// FOUNDRY — senses: what it can learn, from where, and what that never grants
//
// A SENSE IS NOT AN INTEGRATION. An integration is a credential and a cadence.
// A sense is the institution knowing what it is trying to learn, why that
// matters, who could supply it, how fresh it is, what remains invisible, and —
// the load-bearing one — what connecting it does NOT allow.
//
// The owner's rule, which this file exists to keep structural: reading a
// repository never grants permission to modify it; seeing revenue never grants
// permission to move money. Every disclosure here says both halves, and the
// second half is not a reassurance written into a page — it is
// `senses.never_grants`, constitutional and immutable, shown at the moment he
// decides and stored verbatim on the connection so a later widening of the
// vocabulary cannot retroactively change what he agreed to.
//
// ONE CONTRACT, THREE SOURCE MODES. The mandate is explicit that downstream
// intelligence must not fork on whether a source is real. So `mode` decides
// exactly ONE thing — which observation channel a reading is written to — and
// nothing that reasons about a company ever asks. Replacing a sandbox source
// with a real one later is a row, not a rebuild.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type SourceMode = 'real' | 'sandbox' | 'reference';

/**
 * A PROVIDER'S NAME AS A PERSON WOULD SAY IT.
 *
 * `reference_world` is a key. It appeared verbatim in a sentence the owner
 * reads — "from reference_world" — which is exactly the kind of machinery
 * leaking into the product that this whole effort exists to stop. Everything
 * else is already a name people use, so this map is deliberately tiny rather
 * than a full display layer nobody needs.
 */
export function providerName(provider: string): string {
  return provider === 'reference_world' ? 'the reference world' : provider;
}

/** The observation channel a reading from this mode belongs on. */
export function channelForMode(mode: SourceMode): string {
  return mode === 'reference' ? 'reference_metric_ingest'
    : mode === 'sandbox' ? 'sandbox_metric_ingest'
      : 'external_metric_ingest';
}

/** The event-type prefix that matches it. Derived from one place, so the
 *  channel and the prefix cannot drift apart. */
export function prefixForMode(mode: SourceMode): string {
  return mode === 'reference' ? 'reference_metric:'
    : mode === 'sandbox' ? 'sandbox_metric:' : 'external_metric:';
}

export interface Sense {
  key: string;
  cannotSee: string;
  wouldLearn: string;
  neverGrants: string;
  channels: string[];
}

export interface SenseOffer extends Sense {
  provider: string;
  mode: SourceMode;
  reads: string;
  handsOver: string;
}

export interface ConnectedSense {
  id: string;
  senseKey: string;
  cannotSee: string;
  wouldLearn: string;
  neverGrants: string;
  provider: string;
  mode: SourceMode;
  connectedAt: string;
  lastObservedAt: string | null;
  lastError: string | null;
  channels: string[];
}

function senseFromRow(r: Record<string, unknown>): Sense {
  return {
    key: String(r.sense_key), cannotSee: String(r.cannot_see),
    wouldLearn: String(r.would_learn), neverGrants: String(r.never_grants),
    channels: JSON.parse(String(r.channels_json)) as string[],
  };
}

export async function everySense(): Promise<Sense[]> {
  return ((await query(
    `SELECT sense_key, cannot_see, would_learn, never_grants, channels_json
       FROM senses ORDER BY sort_order`, [])).rows as unknown as Array<Record<string, unknown>>)
    .map(senseFromRow);
}

/** What this company can see right now. */
export async function connectedSenses(productId: string): Promise<ConnectedSense[]> {
  return ((await query(
    `SELECT c.id, c.sense_key, c.provider, c.mode, c.connected_at,
            c.last_observed_at, c.last_error,
            s.cannot_see, s.would_learn, s.never_grants, s.channels_json
       FROM company_senses c
       JOIN senses s ON s.sense_key = c.sense_key
      WHERE c.product_id = ? AND c.disconnected_at IS NULL
      ORDER BY s.sort_order`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    id: String(r.id), senseKey: String(r.sense_key),
    cannotSee: String(r.cannot_see), wouldLearn: String(r.would_learn),
    neverGrants: String(r.never_grants),
    provider: String(r.provider), mode: String(r.mode) as SourceMode,
    connectedAt: String(r.connected_at).slice(0, 10),
    lastObservedAt: r.last_observed_at == null ? null : String(r.last_observed_at),
    lastError: r.last_error == null ? null : String(r.last_error),
    channels: JSON.parse(String(r.channels_json)) as string[],
  }));
}

/**
 * WHAT FOUNDRY STILL CANNOT SEE, AND WHO COULD FIX IT.
 *
 * The connection experience begins here rather than at a provider list, because
 * the owner cannot answer "which integrations do you want" and can answer "may
 * I see your revenue". A gap is a sense with no live connection; the offers are
 * the declared providers for it, in the modes this company is allowed to use.
 *
 * A REFERENCE COMPANY IS OFFERED ONLY THE REFERENCE WORLD, and a real company
 * is never offered it. The schema refuses the other combinations anyway
 * (migration 226); filtering here means he is never shown a door that would
 * close in his face.
 */
export interface SenseGap extends Sense { offers: SenseOffer[] }

export async function whatItCannotSee(productId: string): Promise<SenseGap[]> {
  const isReference = String(((await query(
    'SELECT reality FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, unknown> | undefined)?.reality ?? 'real') === 'reference';
  const allowed = isReference ? ['reference'] : ['real', 'sandbox'];

  const rows = (await query(
    `SELECT s.sense_key, s.cannot_see, s.would_learn, s.never_grants, s.channels_json,
            p.provider, p.mode, p.reads, p.hands_over
       FROM senses s
       LEFT JOIN sense_providers p ON p.sense_key = s.sense_key
      WHERE NOT EXISTS (
        SELECT 1 FROM company_senses c
         WHERE c.product_id = ? AND c.sense_key = s.sense_key
           AND c.disconnected_at IS NULL)
      ORDER BY s.sort_order, p.mode, p.provider`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const gaps = new Map<string, SenseGap>();
  for (const row of rows) {
    const key = String(row.sense_key);
    if (!gaps.has(key)) gaps.set(key, { ...senseFromRow(row), offers: [] });
    if (row.provider == null) continue;
    const mode = String(row.mode) as SourceMode;
    if (!allowed.includes(mode)) continue;
    gaps.get(key)?.offers.push({
      ...senseFromRow(row), provider: String(row.provider), mode,
      reads: String(row.reads), handsOver: String(row.hands_over),
    });
  }
  // A sense nothing can supply is still a gap worth naming: "I cannot see what
  // it costs to run, and nothing I can connect would tell me" is a true and
  // useful sentence, and hiding it would make the list look complete.
  return [...gaps.values()];
}

/**
 * THE DISCLOSURE, ASSEMBLED SERVER-SIDE.
 *
 * Built here and stored on the connection rather than composed in a template,
 * for two reasons. It is what he agreed to, so it has to survive a later change
 * to the wording. And a page that assembles its own disclosure is a page that
 * can be changed without anyone noticing the promise changed with it.
 */
export function disclosureFor(offer: SenseOffer, companyName: string): string {
  const world = offer.mode === 'reference'
    ? ' Nothing here is real: this company does not exist.'
    : offer.mode === 'sandbox'
      ? ` This is ${offer.provider}'s test mode — the whole path, none of the world.`
      : '';
  return `Connecting ${offer.provider} would let me understand ${offer.wouldLearn} `
    + `for ${companyName}. It reads ${offer.reads}. It would NOT let me `
    + `${offer.neverGrants}.${world}`;
}

export async function offerFor(
  senseKey: string, provider: string, mode: SourceMode,
): Promise<SenseOffer | null> {
  const row = (await query(
    `SELECT s.sense_key, s.cannot_see, s.would_learn, s.never_grants, s.channels_json,
            p.provider, p.mode, p.reads, p.hands_over
       FROM sense_providers p JOIN senses s ON s.sense_key = p.sense_key
      WHERE p.sense_key = ? AND p.provider = ? AND p.mode = ?`,
    [senseKey, provider, mode])).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  return {
    ...senseFromRow(row), provider: String(row.provider),
    mode: String(row.mode) as SourceMode,
    reads: String(row.reads), handsOver: String(row.hands_over),
  };
}

/**
 * Give a company a sense.
 *
 * The disclosure is recomputed here from the constitutional vocabulary — never
 * taken from the caller — so what is stored as "what he agreed to" is what the
 * institution would have shown him, not what a form said it showed him.
 */
export async function connectSense(input: {
  productId: string; companyName: string;
  senseKey: string; provider: string; mode: SourceMode;
  integrationId?: string | null;
}): Promise<{ id: string; disclosure: string } | null> {
  const offer = await offerFor(input.senseKey, input.provider, input.mode);
  if (!offer) return null;
  const disclosure = disclosureFor(offer, input.companyName);
  const id = nanoid();
  await query(
    `INSERT INTO company_senses
       (id, product_id, sense_key, provider, mode, integration_id, disclosure)
     VALUES (?,?,?,?,?,?,?)`,
    [id, input.productId, input.senseKey, input.provider, input.mode,
      input.integrationId ?? null, disclosure]);
  return { id, disclosure };
}

export async function disconnectSense(id: string, reason: string): Promise<void> {
  await query(
    `UPDATE company_senses SET disconnected_at = datetime('now'), disconnect_reason = ?
      WHERE id = ? AND disconnected_at IS NULL`, [reason, id]);
}

/**
 * WHICH CHANNEL THIS COMPANY'S READINGS BELONG ON.
 *
 * Replaces the reality-only answer with the one the sense system actually
 * knows. Order matters and is not arbitrary:
 *
 *   1. A reference company is always the reference channel, whatever any row
 *      says. That is the guarantee migration 222 exists for and it is not
 *      negotiable by configuration.
 *   2. Otherwise the mode of the LIVE SENSE that supplies this reading. A
 *      Stripe test-mode connection writes the sandbox channel; a real one
 *      writes the world's.
 *   3. With no sense to consult — the owner's own `POST /ingest/:token` push,
 *      which is him reporting his own company — the world's channel, because
 *      that is what it is.
 */
export async function channelFor(
  productId: string, opts?: { provider?: string; senseKey?: string },
): Promise<{ mode: SourceMode; source: string; prefix: string }> {
  const reality = String(((await query(
    'SELECT reality FROM products WHERE id = ?', [productId]))
    .rows[0] as Record<string, unknown> | undefined)?.reality ?? 'real');
  if (reality === 'reference') {
    return { mode: 'reference', source: channelForMode('reference'),
      prefix: prefixForMode('reference') };
  }

  if (opts?.provider != null || opts?.senseKey != null) {
    const row = (await query(
      `SELECT mode FROM company_senses
        WHERE product_id = ? AND disconnected_at IS NULL
          AND (? IS NULL OR provider = ?) AND (? IS NULL OR sense_key = ?)
        ORDER BY rowid LIMIT 1`,
      [productId, opts.provider ?? null, opts.provider ?? null,
        opts.senseKey ?? null, opts.senseKey ?? null]))
      .rows[0] as Record<string, unknown> | undefined;
    if (row) {
      const mode = String(row.mode) as SourceMode;
      return { mode, source: channelForMode(mode), prefix: prefixForMode(mode) };
    }
  }
  return { mode: 'real', source: channelForMode('real'), prefix: prefixForMode('real') };
}

/** A sense reported. Recorded so freshness is a fact rather than an inference. */
export async function noteSenseObserved(
  productId: string, provider: string, error?: string | null,
): Promise<void> {
  await query(
    `UPDATE company_senses
        SET last_observed_at = datetime('now'), last_error = ?
      WHERE product_id = ? AND provider = ? AND disconnected_at IS NULL`,
    [error ?? null, productId, provider]);
}

/**
 * WHAT IT USED TO BE ABLE TO SEE.
 *
 * Disconnecting is as reversible as lifting a boundary, and for the same
 * reason: the record kept everything and no surface offered it back, so
 * "disconnect" read as "forget". He should be able to see what he turned off,
 * why, and turn it on again without reconstructing which provider it was.
 */
export interface LostSense {
  senseKey: string; cannotSee: string; provider: string; mode: SourceMode;
  disconnectedAt: string; reason: string;
}

export async function whatItStoppedSeeing(productId: string): Promise<LostSense[]> {
  return ((await query(
    `SELECT c.sense_key, c.provider, c.mode, c.disconnected_at, c.disconnect_reason,
            s.cannot_see
       FROM company_senses c
       JOIN senses s ON s.sense_key = c.sense_key
      WHERE c.product_id = ? AND c.disconnected_at IS NOT NULL
        -- Only while nothing has replaced it. A sense he turned off and
        -- reconnected is simply live, and offering it back would be offering
        -- him something he already has.
        AND NOT EXISTS (
          SELECT 1 FROM company_senses live
           WHERE live.product_id = c.product_id AND live.sense_key = c.sense_key
             AND live.disconnected_at IS NULL)
      ORDER BY c.disconnected_at DESC, c.rowid DESC`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    senseKey: String(r.sense_key), cannotSee: String(r.cannot_see),
    provider: String(r.provider), mode: String(r.mode) as SourceMode,
    disconnectedAt: String(r.disconnected_at).slice(0, 10),
    reason: String(r.disconnect_reason),
  }));
}
