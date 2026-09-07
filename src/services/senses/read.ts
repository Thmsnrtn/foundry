// =============================================================================
// A SENSE THAT WAS LET SEE, READS.
//
// The sense path (migration 226 onward) gave a company an honest vocabulary for
// what Foundry may look at, and 231 gave each sense a credential that renews
// and is probed. What it never had was a reader: the one Stripe reader in the
// repository is the legacy hourly sync over the `integrations` table, which a
// sense connection does not populate. So "connected" was true and "has ever
// reported" was never true, and the numbers page could not tell the owner
// which.
//
// This is that reader, and deliberately nothing more:
//
//   - one provider (Stripe), because it is the one whose read half already
//     existed and only needed separating from its write half;
//   - one snapshot per sense per day, deduplicated on `last_observed_at`, so
//     the job is idempotent within a day and the ledger of observations is not
//     padded by re-runs;
//   - the same observation channel every provider sync reports through, so a
//     sandbox sense's movements stay test evidence — and a sandbox sense NEVER
//     writes the level (`mrr_cents`), because the level is what the portfolio
//     reads to say what a company earns, and test-mode money is not earnings;
//   - a cursor from the sense's own last reading, so expansion and contraction
//     are "since I last looked", not the account's whole history every day;
//   - a refused page THROWS in the read half, and a throw here writes the
//     error on the sense, bumps the credential's failures, and writes NO
//     snapshot. A revoked key produces a blind sense the owner can see, not a
//     zero he would believe.
//
// It is a read. It changes nothing at Stripe. It is not a Hand, it is not a
// generic autonomous tick, and it does not advance anything by model.
// =============================================================================
import { query, realCompany } from '../../db/client.js';
import { createLogger } from '../../lib/logger.js';
import { readStripeRevenue, writeStripeSnapshot } from '../integrations/stripe.js';
import { invalidateSignalCache } from '../signal.js';
import { recordProviderSyncObservations } from '../institution/external-observation.js';
import { recordCompanyLoopOutcome } from '../institution/loop-health.js';
import { withSenseSecret } from './credentials.js';
import { noteSenseObserved } from './index.js';

const logger = createLogger({ service: 'sense_read' });

export interface SenseReadOutcome {
  read: number; nothingToDo: number; blind: number; failed: number;
  broke: Array<{ productId: string; provider: string; why: string }>;
}

/** The providers this leg can read through, and the read for each. */
interface ReadContext { productId: string; mode: 'real' | 'sandbox'; since: string | null }
const READERS: Record<string, (secret: Record<string, unknown>, ctx: ReadContext) => Promise<string[]>> = {
  stripe: async (secret, ctx) => {
    const accessToken = String(secret.access_token ?? secret.accessToken ?? '');
    const accountId = secret.stripe_account_id ?? secret.stripe_user_id ?? secret.accountId ?? null;
    if (!accessToken) throw new Error('credential holds no access token');
    const reading = await readStripeRevenue(
      { access_token: accessToken, stripe_account_id: accountId ? String(accountId) : undefined }, ctx.since, true);
    return writeStripeSnapshot(ctx.productId, reading, { level: ctx.mode === 'real' });
  },
};

/**
 * Read once, today, through every live sense whose provider this leg can read.
 * Exported for the job and for the test; the job adds only a log line.
 */
export async function readSenses(): Promise<SenseReadOutcome> {
  const outcome: SenseReadOutcome = { read: 0, nothingToDo: 0, blind: 0, failed: 0, broke: [] };
  // ONE READ PER COMPANY AND PROVIDER. Stripe is offered as two senses
  // (revenue, customers) and both rows share one credential and one report;
  // reading twice would write the same snapshot twice and count it twice.
  // Real companies only: a reference company's senses are reference-mode and
  // already excluded, and this is the row that says so. STANDING DOES NOT
  // APPLY: an experimental asset with a connected sense is a test the world is
  // settling, and reading what its provider reports is how the prediction
  // gets settled. A read spends nothing and acts on nothing.
  const due = (await query(
    `SELECT cs.id, cs.product_id, cs.provider, cs.mode,
            MAX(cs.last_observed_at) AS last_observed_at
       FROM company_senses cs
       JOIN products p ON p.id = cs.product_id AND p.deleted_at IS NULL AND p.status = 'active'
      WHERE cs.disconnected_at IS NULL
        AND cs.mode IN ('real', 'sandbox')
        AND cs.provider IN (${Object.keys(READERS).map(() => '?').join(', ')})
        AND (cs.last_observed_at IS NULL OR date(cs.last_observed_at) < date('now'))
        AND EXISTS (SELECT 1 FROM sense_credentials sc
                     WHERE sc.company_sense_id = cs.id AND sc.revoked_at IS NULL)
        AND ${realCompany('p')}
      GROUP BY cs.product_id, cs.provider
      ORDER BY MIN(cs.connected_at)`,
    Object.keys(READERS))).rows as unknown as Array<Record<string, unknown>>;
  if (!due.length) { outcome.nothingToDo = 1; return outcome; }

  for (const sense of due) {
    const senseId = String(sense.id);
    const productId = String(sense.product_id);
    const provider = String(sense.provider);
    const reader = READERS[provider];
    if (!reader) continue;
    const mode = String(sense.mode) === 'real' ? 'real' as const : 'sandbox' as const;
    // Since the last reading, as Stripe counts time. A first reading has no
    // "since" and reads what the account holds, as the legacy sync's first
    // run did.
    const lastAt = sense.last_observed_at ? Date.parse(`${String(sense.last_observed_at).replace(' ', 'T')}Z`) : NaN;
    const since = Number.isFinite(lastAt) ? String(Math.floor(lastAt / 1000)) : null;
    try {
      const written = await withSenseSecret(senseId, (secret) => reader(secret, { productId, mode, since }));
      if (written === null) {
        // A live sense row with no readable credential: blind, and said so.
        outcome.blind += 1;
        await noteSenseObserved(productId, provider, 'no live credential to read through');
        continue;
      }
      await recordProviderSyncObservations({ productId, provider, fieldsWritten: written });
      invalidateSignalCache(productId);
      await noteSenseObserved(productId, provider, null);
      await recordCompanyLoopOutcome(productId, 'sense_read_tick', null);
      outcome.read += 1;
    } catch (err) {
      const why = err instanceof Error ? err.message : String(err);
      outcome.failed += 1;
      outcome.broke.push({ productId, provider, why });
      await noteSenseObserved(productId, provider, why);
      await query(
        `UPDATE sense_credentials SET failures = failures + 1, last_failure = ?
          WHERE company_sense_id = ? AND revoked_at IS NULL`, [why.slice(0, 300), senseId]);
      await recordCompanyLoopOutcome(productId, 'sense_read_tick', err);
      logger.warn(`sense_read_tick: ${provider} for ${productId} could not be read: ${why}`);
    }
  }
  return outcome;
}
