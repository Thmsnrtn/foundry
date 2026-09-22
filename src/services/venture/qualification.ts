// =============================================================================
// FOUNDRY — is this experiment ready for the world, and what is still missing
//
// THE OWNER'S PRINCIPLE, IN HIS WORDS: Foundry "must not begin consequential
// real-world economic experiments until the capabilities, operational
// responsibilities, safeguards, and observation paths required by those
// particular experiments have been adequately qualified." He does not want an
// institution that launches half-finished products, unproven external
// workflows, unsupported customer promises, or experiments whose results are
// distorted by defects in Foundry's own machinery.
//
// THIS IS A READING, NOT A REGISTER. He was equally explicit that this must not
// become "another universal checklist, bureaucratic approval system, or
// speculative institutional layer", and must not "duplicate the same facts
// across multiple ledgers". So nothing here stores a readiness verdict. Every
// condition is computed from the row that already decides it — the sealed
// design, the owner's decision, the allowance, the boundary, the capability's
// witnessed maturity, the exposure, the publication. Where a fact already has
// an instrument, that instrument answers: the Workshop-carried case defers
// wholesale to `publicationGate`, which has been the readiness gate for that
// mechanism since before the word was used.
//
// READINESS IS NOT AUTHORITY, and the two are kept apart on purpose. An
// experiment can be ready and unauthorised; it can be authorised and not
// ready. Both are required before anything consequential happens, and each is
// refused by its own machinery with its own words. Conflating them was the
// mistake that cost this campaign a day when a Stripe approval was read as
// consent to publish a page.
//
// AND THE CONDITIONS FOLLOW THE MECHANISM. A workbook sold on a marketplace
// and a brief sold through the Workshop's own checkout do not owe the same
// things. Asking a listing for a payment link, or a Workshop offer for a venue
// credential, is how a checklist becomes a ritual. Each mechanism is asked
// only what its own economics actually require.
// =============================================================================

import { query } from '../../db/client.js';

export type ConditionVerdict =
  /** The row that decides it says yes. */
  | 'met'
  /** It is absent, and something the institution can still do would supply it. */
  | 'missing'
  /** It exists but has not been shown to work where it matters. */
  | 'unproven'
  /** Only the owner can supply it: his decision, his account, his signature. */
  | 'waits_for_you'
  /** This mechanism does not owe this. */
  | 'not_applicable';

export interface QualificationCondition {
  /** Short enough to read in a list, specific enough to act on. */
  name: string;
  verdict: ConditionVerdict;
  /** The row that decided it, named. Never an adjective on its own. */
  because: string;
}

export type QualificationState =
  /** Still being built; nothing has been put to the owner. */
  | 'preparing'
  /** The operating capability it depends on has not been proven yet. */
  | 'testing_capability'
  /** Everything Foundry can settle is settled; it is his to look at. */
  | 'ready_for_review'
  /** Ready, and inside a charter that covers it. */
  | 'ready_within_charter'
  /** It is out there. */
  | 'operating'
  /** It was ready and something it depends on has failed. */
  | 'paused_dependency'
  /** Ready but for his word. */
  | 'needs_owner_authorisation'
  /** Ready but for an account only he can open or connect. */
  | 'needs_external_account';

export interface Qualification {
  state: QualificationState;
  /** How this thing actually makes its money, which decides what it owes. */
  mechanism: 'listing' | 'workshop' | 'unknown';
  conditions: QualificationCondition[];
  /** The conditions in the way, by name. Empty when nothing is. */
  blocking: string[];
}

const met = (name: string, because: string): QualificationCondition => ({ name, verdict: 'met', because });

/**
 * WHAT THIS EXPERIMENT OWES BEFORE IT TOUCHES ANYBODY, and which of those it
 * has. Reads; writes nothing; decides nothing the owner has decided.
 */
export async function qualificationOf(experimentId: string): Promise<Qualification> {
  const e = (await query(
    `SELECT e.id, e.founder_id, e.decision, e.validity, e.ran_at,
            (SELECT p.id FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL) AS product_id
       FROM venture_experiments e WHERE e.id = ?`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) {
    return {
      state: 'preparing', mechanism: 'unknown', blocking: ['there is no such test'],
      conditions: [{ name: 'there is no such test', verdict: 'missing', because: 'no row' }],
    };
  }

  const { offerShapePlanOf, materialOf } = await import('./hand.js');
  const plan = await offerShapePlanOf(experimentId);
  const mechanism: Qualification['mechanism'] = plan?.listing ? 'listing' : plan?.venue === 'workshop' ? 'workshop'
    : plan ? 'unknown' : 'unknown';

  const conditions: QualificationCondition[] = [];

  // ─── What every mechanism owes ─────────────────────────────────────────────

  // THE PRODUCT ITSELF, BEFORE ANY PLATFORM. The owner: "The fact that Foundry
  // can publish a product does not establish that the product deserves
  // publication… Do not use customers as involuntary testers of basic product
  // functionality."
  const deliverable = await materialOf(experimentId, 'deliverable');
  conditions.push(deliverable
    ? met('there is something to deliver', `the deliverable on record is "${deliverable.title}"`)
    : { name: 'there is something to deliver', verdict: 'missing', because: 'no deliverable is recorded for this test' });

  const offerText = await materialOf(experimentId, 'offer_template');
  conditions.push(offerText
    ? met('the offer is written', 'the offer text is on record')
    : { name: 'the offer is written', verdict: 'missing', because: 'no offer text is recorded' });

  const { designOf } = await import('./probe-design.js');
  const design = await designOf(experimentId);
  conditions.push(design?.sealedAt
    ? met('the prediction is sealed', `sealed ${String(design.sealedAt).slice(0, 10)}, so the result cannot be narrated afterwards`)
    : { name: 'the prediction is sealed', verdict: 'missing', because: 'the design is not sealed, so any result could be read as the expected one' });

  conditions.push(String(e.decision ?? '') === 'approved'
    ? met('you approved it', 'the decision on the row is yours')
    : { name: 'you approved it', verdict: 'waits_for_you', because: `the test is ${String(e.decision ?? 'undecided')}` });

  const productId = e.product_id == null ? null : String(e.product_id);
  if (productId) {
    const allowance = (await query(
      `SELECT amount_cents FROM owner_allowances WHERE product_id = ? AND withdrawn_at IS NULL`, [productId]))
      .rows[0] as Record<string, unknown> | undefined;
    conditions.push(allowance
      ? met('there is a bounded amount to spend', `$${(Number(allowance.amount_cents) / 100).toFixed(2)} stands for it`)
      : { name: 'there is a bounded amount to spend', verdict: 'waits_for_you', because: 'no allowance stands for this test' });

    const boundaries = (await query(
      `SELECT COUNT(*) AS n FROM owner_boundaries WHERE product_id = ? AND lifted_at IS NULL`, [productId]))
      .rows[0] as Record<string, unknown>;
    conditions.push(Number(boundaries.n) > 0
      ? met('what it must not do is recorded', `${String(boundaries.n)} standing boundaries in your words`)
      : { name: 'what it must not do is recorded', verdict: 'missing', because: 'no standing boundary names what this test may not do' });
  }

  // ─── What this mechanism owes, and nothing else's ──────────────────────────

  if (mechanism === 'workshop') {
    // THE INSTRUMENT THAT ALREADY EXISTS ANSWERS. `publicationGate` has been
    // the readiness gate for a Workshop-carried offer since before the word
    // was used: the page published and seen and current, a price, a way to
    // pay, a postal address, a reply route that has proven itself. Restating
    // its conditions here would be the second ledger he asked for none of.
    const { publicationGate } = await import('../public-workshop/publication.js');
    const gate = await publicationGate(experimentId, { verifyLive: false });
    conditions.push(gate.ok
      ? met('the page a buyer arrives at is up and current', 'the publication gate passes')
      : { name: 'the page a buyer arrives at is up and current', verdict: 'unproven', because: gate.failures.join('; ') });

    // AND THE OTHER INSTRUMENT THAT ALREADY EXISTS. `hand.readiness` answers
    // the sending half — who may be written to, and whether there is an
    // identity to write as. Two readers, each authoritative over its own half,
    // and this one asks rather than re-deriving.
    const { readiness: sendingReadiness } = await import('./hand.js');
    const send = await sendingReadiness(experimentId);
    conditions.push(send.ok
      ? met('there is somebody to write to, and an identity to write as', `${String(send.reachable)} reachable, sending ${send.sending.status}`)
      : { name: 'there is somebody to write to, and an identity to write as', verdict: 'missing', because: send.missing.join('; ') });
  }

  if (mechanism === 'listing') {
    const venue = plan!.listing!.venueName;
    // CAN THE INSTITUTION OPERATE THE VENUE AT ALL. Not "is there code" — the
    // witnessed maturity of the capability, which is the only thing in this
    // schema that can say a provider has done something in the world.
    const provider = (await query(
      `SELECT p.maturity, p.provider FROM capability_providers p
         JOIN capabilities c ON c.capability_key = p.capability_key
        WHERE c.capability_key = 'list_on_marketplace' AND lower(p.provider) = lower(?)`,
      [plan!.listing!.venue])).rows[0] as Record<string, unknown> | undefined;
    if (!provider) {
      conditions.push({
        name: `${venue} can be operated`, verdict: 'missing',
        because: `nothing in the capability registry lists ${venue} as a way to place a listing, so every step of it is yours by hand`,
      });
    } else if (String(provider.maturity) === 'declared') {
      conditions.push({
        name: `${venue} can be operated`, verdict: 'waits_for_you',
        because: `the ${venue} capability is declared and has never been given an account to act through`,
      });
    } else if (String(provider.maturity) === 'available') {
      conditions.push({
        name: `${venue} can be operated`, verdict: 'unproven',
        because: `the ${venue} capability exists and has been exercised in tests, and has not yet done anything in the world`,
      });
    } else {
      conditions.push(met(`${venue} can be operated`, `the ${venue} capability is ${String(provider.maturity)}`));
    }

    const exposure = (await query(
      `SELECT exposure_ref, withdrawn_at FROM experiment_exposures
        WHERE experiment_id = ? ORDER BY placed_at DESC, rowid DESC LIMIT 1`, [experimentId]))
      .rows[0] as Record<string, unknown> | undefined;
    conditions.push(exposure && exposure.withdrawn_at == null
      ? met('the listing is live and its address is recorded', String(exposure.exposure_ref))
      : { name: 'the listing is live and its address is recorded', verdict: 'waits_for_you',
        because: exposure ? 'the listing was placed and has been taken down' : `nothing has been placed on ${venue} yet` });

    // WHAT THE EXPERIMENT INTENDS TO LEARN, AND WHETHER IT COULD. The owner:
    // "Do not use the absence of recorded events as evidence of no external
    // activity when the observation path was unavailable." A venue Foundry
    // cannot read is a venue whose silence means nothing.
    // A VENUE READING IS AN OBSERVATION, not a table of its own: `recordVenueReading`
    // writes it through `observe` against the test's claim, sourced
    // `<venue>:stats:<date>`. Counting those is counting what the venue has
    // actually told this institution.
    const readings = (await query(
      `SELECT COUNT(*) AS n FROM market_observations o
         JOIN venture_experiments e ON e.claim_id = o.claim_id
        WHERE e.id = ? AND o.source LIKE ?`, [experimentId, `${plan!.listing!.venue}:stats:%`]))
      .rows[0] as Record<string, unknown> | undefined;
    conditions.push({
      name: 'what the venue reports can be read',
      verdict: provider && String(provider.maturity) !== 'declared' ? 'unproven' : 'waits_for_you',
      because: readings && Number(readings.n) > 0
        ? `${String(readings.n)} readings, each entered by you — nothing here reads ${venue} on its own`
        : `nothing here reads ${venue} on its own, so an absence of sales would not be evidence of no sales`,
    });

    // AND THE REMEDY, WHICH IS THE PROMISE THE SITE ALREADY MAKES. Recorded as
    // a condition rather than as prose, because `/refunds` promises a refund
    // with no form and no time limit for a marketplace sale and nothing in the
    // institution can execute one.
    conditions.push({
      name: 'a refund can be carried out',
      verdict: 'waits_for_you',
      because: `a refund on ${venue} is your act there; the only executor here is Stripe, and the site promises the refund either way`,
    });
  }

  if (mechanism === 'unknown') {
    conditions.push({
      name: 'how it reaches a customer is decided', verdict: 'missing',
      because: plan ? 'the offer names no venue and no listing' : 'no offer shape is recorded',
    });
  }

  const blocking = conditions.filter((c) => c.verdict !== 'met' && c.verdict !== 'not_applicable').map((c) => c.name);

  return { state: stateFrom(conditions, e), mechanism, conditions, blocking };
}

/**
 * ONE WORD FOR THE WHOLE THING, for the screen where he does not want a
 * checklist. The order matters: the most specific true statement wins, so
 * "needs an account only you can open" beats "not ready", which would be true
 * and useless.
 */
function stateFrom(conditions: QualificationCondition[], e: Record<string, unknown>): QualificationState {
  const has = (v: ConditionVerdict) => conditions.some((c) => c.verdict === v);
  const blocked = conditions.filter((c) => c.verdict !== 'met' && c.verdict !== 'not_applicable');

  if (String(e.decision ?? '') !== 'approved') {
    // Not yet his to authorise unless everything else is settled.
    return blocked.length > 1 ? 'preparing' : 'needs_owner_authorisation';
  }
  if (e.ran_at != null) return 'operating';
  if (blocked.length === 0) return 'ready_within_charter';

  const account = conditions.find((c) => c.verdict === 'waits_for_you' && /can be operated|listing is live/.test(c.name));
  if (account) return 'needs_external_account';
  if (has('unproven')) return 'testing_capability';
  if (has('waits_for_you')) return 'needs_owner_authorisation';
  return 'preparing';
}

/**
 * THE REFUSAL, FOR THE DOOR.
 *
 * The owner: a readiness assessment "must not be merely a checklist displayed
 * in the owner interface. The actual action must be refused when a required
 * condition is missing" — and refused identically whether it came from Ask, a
 * screen, an agent, a routine, an integration, a Sprite or a direct call. The
 * outbound door is the one place all of those meet, so it is the only place
 * this can honestly live.
 *
 * NARROW ON PURPOSE. It applies where a consequential act is bound to an
 * experiment, which is exactly where "this experiment is not ready" is a
 * sentence about the act in front of it. Nothing else is asked, because a
 * readiness rule that fires on unrelated calls is a ritual, and this campaign
 * has already learned once what over-reach at the door costs.
 */
export async function qualificationStandsInTheWay(input: {
  experimentId: string; tool: string;
}): Promise<{ refusal: string; blocking: string[] } | null> {
  // IT GATES WHAT BEGINS EXPOSURE, AND NEVER WHAT DISCHARGES AN OBLIGATION.
  //
  // This is the trap in the idea and it is worth naming where somebody will
  // read it. An experiment's approved act also covers the deliveries and
  // refunds of purchases taken on while it stood — `experimentActFor` says so
  // in as many words — so a readiness rule that fired on every act bound to an
  // experiment would refuse a refund the moment a venue credential expired.
  // That is the owner's rule exactly inverted: "Preserve existing customer
  // obligations even when new spending, outreach, publication, or experiment
  // authority is withdrawn." Somebody who has already paid is owed their thing
  // whatever has since gone wrong with the machinery.
  //
  // So the rule is keyed on the capability's FAMILY, which is a row rather
  // than a guess: `distribution` is the family of putting something in front
  // of people — listing on a marketplace, publishing a page, reaching out,
  // buying attention. Commerce and communication are not asked, because a
  // refund and a delivery belong to a customer who already exists.
  const fam = (await query(
    `SELECT c.family FROM capability_providers p
       JOIN capabilities c ON c.capability_key = p.capability_key
      WHERE p.tool = ?`, [input.tool])).rows[0] as Record<string, unknown> | undefined;
  if (!fam || String(fam.family) !== 'distribution') return null;

  const r = await qualificationOf(input.experimentId);
  if (r.blocking.length === 0) return null;
  return {
    refusal: `the test is not ready for this: ${r.blocking.join('; ')}`,
    blocking: r.blocking,
  };
}
