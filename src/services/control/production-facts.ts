// =============================================================================
// FOUNDRY — production facts, and whether Foundry can sell on its own today
// (Roadmap 2027 R26).
//
// Every measure in the 90-day plan reads production, and Foundry could not see
// its own: whether the payment events can reach it, how many tests the charter
// allows and how many are running, which approved tests never reached a page,
// what the owner decided about per-sale minutes, and what correspondence does.
// The owner was asked for screenshots of things this machine already knows.
//
// A READER. It writes nothing and calls nothing outside this machine. Secrets
// are read by name only, as present or absent; no value is ever read out.
// "Can it sell?" is computed from these rows, never asserted: each blocker
// names what clears it and whose act that is.
// =============================================================================

import { modelDoorBlocker } from '../ai/model-door.js';
import { query } from '../../db/client.js';
import { CLAIM_LOOK_GIVES_UP_AFTER } from '../venture/market-evidence.js';

/** The claims the market-evidence routine has left: the ones its window leaves out, by the same test. */
const CLAIMS_LEFT = `c.founder_id = ? AND c.evidence_mode = 'real' AND c.settled_as IS NULL
          AND NOT EXISTS (SELECT 1 FROM market_observations o WHERE o.claim_id = c.id)
          AND (SELECT COUNT(*) FROM claim_look_failures f WHERE f.claim_id = c.id) >= ?`;

type Row = Record<string, unknown>;

/** The secrets a selling deployment depends on, by name, and what each one unblocks. */
export const SECRETS_THAT_MATTER: ReadonlyArray<{ name: string; unblocks: string }> = [
  { name: 'STRIPE_SECRET_KEY', unblocks: 'payment links, refunds and cancellations' },
  { name: 'STRIPE_WEBHOOK_SECRET', unblocks: 'hearing about a payment; without it every priced offer is refused' },
  { name: 'FOUNDRY_ENABLE_MONEY_TOOLS', unblocks: 'refunds and cancellations made by Foundry rather than by you in Stripe' },
  { name: 'RESEND_API_KEY', unblocks: 'delivering what a buyer paid for' },
  { name: 'OPENROUTER_API_KEY', unblocks: 'discovery and the forge' },
  { name: 'CLOUDFLARE_API_TOKEN', unblocks: 'publishing Workshop pages' },
  { name: 'CLOUDFLARE_ANALYTICS_TOKEN', unblocks: 'counting page opens (R36)' },
  { name: 'R2_ACCESS_KEY_ID', unblocks: 'the off-machine copy' },
  { name: 'BACKUP_ENCRYPTION_KEY', unblocks: 'sealing the off-machine copy' },
];

export interface ProductionFacts {
  secrets: Array<{ name: string; present: boolean; unblocks: string }>;
  /** The payment observation path, as the instrument reads it. */
  paymentEvents: { status: 'working' | 'not_working' | 'unknown'; detail: string };
  moneySwitchOn: boolean;
  charter: { probesInFlight: number; daysLeft: number; expiresAt: string } | null;
  /** Unsettled tests, under any of the owner's charters (R52). */
  inFlight: number;
  /** Real, approved Workshop tests that never reached a page and have no answer yet. */
  unplaced: Array<{ experimentId: string; decidedAt: string | null }>;
  frontLoadedAttention: { treatment: string; setBy: string; setAt: string; ownersOwn: boolean } | null;
  correspondence: string;
  subscriptionsAllowed: boolean;
  /** Whether the model answers, and how long its credit lasts (R33). */
  modelDoor: import('../ai/model-door.js').ModelDoorFacts;
  /** Payment events in the last thirty days that carried our tag and matched no test of ours (remediation 1.6). */
  unmatchedPaymentEvents: Array<{ eventId: string; because: string; at: string }>;
  /** Real market claims no source could read after four looks, now left (migration 389). */
  claimsLeft?: Array<{ claimId: string; claim: string; because: string }>;
  /** How many claims were left in all; `claimsLeft` shows the oldest ten. */
  claimsLeftTotal?: number;
}

export async function productionFacts(founderId: string, env: NodeJS.ProcessEnv = process.env): Promise<ProductionFacts> {
  const secrets = SECRETS_THAT_MATTER.map((s) => ({ ...s, present: String(env[s.name] ?? '').trim() !== '' }));
  const { paymentObservationPath } = await import('../venture/the-instrument.js');
  const paymentEvents = await paymentObservationPath();
  const { liveCharter } = await import('../institution/charter.js');
  const live = await liveCharter(founderId);
  const inFlight = Number(((await query(
    `SELECT COUNT(*) AS n FROM portfolio_envelope_carves c
       JOIN portfolio_envelopes e ON e.id = c.envelope_id
       JOIN venture_experiments x ON x.id = c.experiment_id
      WHERE e.founder_id = ? AND x.what_happened IS NULL AND x.retired_at IS NULL AND x.validity = 'valid'
        AND x.superseded_by IS NULL AND coalesce(x.decision, '') <> 'declined'`, [founderId])).rows[0] as Row).n ?? 0);
  const unplaced = ((await query(
    `SELECT x.id, x.decided_at FROM venture_experiments x
      WHERE x.founder_id = ? AND x.evidence_mode = 'real' AND x.decision = 'approved'
        AND x.ran_at IS NULL AND x.retired_at IS NULL AND x.validity = 'valid' AND x.superseded_by IS NULL
        AND NOT EXISTS (SELECT 1 FROM experiment_exposures p WHERE p.experiment_id = x.id)
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = x.id AND m.kind = 'offer_shape'
                      AND m.superseded_at IS NULL AND m.body LIKE '%"venue":"workshop"%')
      ORDER BY x.decided_at, x.rowid`, [founderId])).rows as unknown as Row[])
    .map((r) => ({ experimentId: String(r.id), decidedAt: r.decided_at == null ? null : String(r.decided_at) }));
  const { originationPolicyFor } = await import('../venture/legal-surface.js');
  const fla = (await originationPolicyFor(founderId)).find((p) => p.requirement === 'front_loaded_attention') ?? null;
  const { correspondenceMode } = await import('../public-workshop/correspondence.js');
  const { subscriptionsAllowed } = await import('./decisions.js');
  return {
    secrets, paymentEvents,
    moneySwitchOn: env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true',
    charter: live ? { probesInFlight: live.probesInFlight, daysLeft: live.daysLeft, expiresAt: live.expiresAt } : null,
    inFlight, unplaced,
    frontLoadedAttention: fla ? { treatment: fla.treatment, setBy: fla.setBy, setAt: fla.setAt, ownersOwn: fla.ownersOwn } : null,
    correspondence: await correspondenceMode(founderId),
    subscriptionsAllowed: (await subscriptionsAllowed(founderId)).allowed,
    modelDoor: await (await import('../ai/model-door.js')).modelDoorFacts(),
    claimsLeft: ((await query(
      `SELECT c.id AS claim_id, c.claim,
              (SELECT f2.because FROM claim_look_failures f2 WHERE f2.claim_id = c.id ORDER BY f2.failed_at DESC, f2.rowid DESC LIMIT 1) AS because
         FROM market_claims c
        WHERE ${CLAIMS_LEFT}
        ORDER BY c.formed_at, c.rowid LIMIT 10`, [founderId, CLAIM_LOOK_GIVES_UP_AFTER])).rows as unknown as Array<Record<string, unknown>>)
      .map((r) => ({ claimId: String(r.claim_id), claim: String(r.claim), because: String(r.because ?? '') })),
    claimsLeftTotal: Number(((await query(
      `SELECT COUNT(*) AS n FROM market_claims c WHERE ${CLAIMS_LEFT}`, [founderId, CLAIM_LOOK_GIVES_UP_AFTER])).rows[0] as Record<string, unknown> | undefined)?.n ?? 0),
    unmatchedPaymentEvents: ((await query(
      `SELECT event_id, unmatched_because, processed_at FROM stripe_webhook_events
        WHERE unmatched_because IS NOT NULL AND datetime(processed_at) >= datetime('now', '-30 days')
        ORDER BY processed_at DESC LIMIT 10`, [])).rows as unknown as Row[])
      .map((r) => ({ eventId: String(r.event_id), because: String(r.unmatched_because), at: String(r.processed_at) })),
  };
}

/**
 * CAN FOUNDRY SELL ON ITS OWN TODAY? Blockers stop a forge-made offer from
 * reaching a buyer at all; costs let it sell but leave minutes per sale with
 * the owner. Each names what clears it. An empty `blockers` is the only "yes".
 */
export function canSellOnItsOwn(f: ProductionFacts): { yes: boolean; blockers: string[]; costs: string[] } {
  const blockers: string[] = [];
  const costs: string[] = [];
  if (!f.secrets.find((s) => s.name === 'STRIPE_SECRET_KEY')?.present) blockers.push('no payment provider is configured');
  if (f.paymentEvents.status === 'not_working') {
    blockers.push('nothing can hear a payment, so every priced offer is refused: add STRIPE_WEBHOOK_SECRET from the one Foundry endpoint in Stripe');
  }
  if (!f.frontLoadedAttention || !f.frontLoadedAttention.ownersOwn || f.frontLoadedAttention.treatment === 'require' || f.frontLoadedAttention.treatment === 'refuse') {
    blockers.push('no forge-made offer may be placed until you allow offers that still take some of your minutes per sale (Your decisions)');
  }
  if (!f.charter) blockers.push('no charter is signed, so nothing is let in without you');
  else if (f.charter.daysLeft < 16) blockers.push(`the charter has ${String(f.charter.daysLeft)} days left, too few to read a new test; renew it`);
  else if (f.inFlight >= f.charter.probesInFlight) blockers.push(`all ${String(f.charter.probesInFlight)} places are taken by tests still running`);
  // THE MODEL DOOR (R33): nothing new is found or designed without it.
  const m = f.modelDoor;
  const doorDown = modelDoorBlocker(m);
  if (doorDown) blockers.push(doorDown);
  if (m.daysLeft !== null && m.daysLeft < 3) blockers.push(`about ${String(m.daysLeft)} days of model credit left at the last week's spend: add OpenRouter credit`);
  else if (m.daysLeft !== null && m.daysLeft < 14) costs.push(`about ${String(m.daysLeft)} days of model credit left at the last week's spend; fourteen is the margin`);
  if (m.readOn === null) costs.push(`the model credit has not been read yet${m.lastReadFailed ? `: ${m.lastReadFailed}` : '; it is read once a day'}`);
  const unmatched = f.unmatchedPaymentEvents ?? [];
  if (unmatched.length > 0) {
    costs.push(`${String(unmatched.length)} payment event${unmatched.length === 1 ? '' : 's'} in the last thirty days carried Foundry's tag and matched no test (the latest: ${unmatched[0]!.because}); any payment among them is still read from Stripe's own list each day`);
  }
  if (f.paymentEvents.status === 'unknown') costs.push(`the payment route is not yet proved live: ${f.paymentEvents.detail}`);
  if (!f.moneySwitchOn) costs.push('every refund and cancellation is yours in Stripe until the money switch is on');
  if (f.correspondence === 'off') costs.push('every buyer email is yours until correspondence is at least "drafts"');
  if (f.unplaced.length > 0) costs.push(`${String(f.unplaced.length)} approved test${f.unplaced.length === 1 ? '' : 's'} never reached a page; stop or re-allow ${f.unplaced.length === 1 ? 'it' : 'them'}`);
  return { yes: blockers.length === 0, blockers, costs };
}
