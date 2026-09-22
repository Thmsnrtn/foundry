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
import type { ExperimentActKind } from '../institution/standing-intent.js';

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
  mechanism: 'listing' | 'workshop' | 'outreach' | 'unknown';
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
  // THREE MECHANISMS, AND THE THIRD IS THE OLDEST.
  //
  // This read `listing`, `workshop`, and `unknown` for everything else — and
  // everything else is OUTREACH, the shape of Experiment 001: no listing, no
  // page, Foundry's own hand carrying an offer to businesses under an approved
  // act. `OfferShapePlan` says so in as many words: `listing` is "absent for
  // one whose offer Foundry's hand carries".
  //
  // Calling that `unknown` produced a blocking condition, "how it reaches a
  // customer is decided", against the one experiment in this institution that
  // has actually run. It was harmless while nothing enforced the reading, and
  // it stopped being harmless the moment the door did: the laboratory's
  // Experiment 001 could not send a single offer. Which is the gate working —
  // it refused what the reader called unready — and the reader being wrong.
  //
  // `unknown` now means what it says: there is no plan at all.
  const mechanism: Qualification['mechanism'] = plan?.listing ? 'listing'
    : plan?.venue === 'workshop' ? 'workshop'
      : plan ? 'outreach' : 'unknown';

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

  }

  // AND THE OTHER INSTRUMENT THAT ALREADY EXISTS, FOR BOTH MECHANISMS THAT
  // SEND. `hand.readiness` answers the sending half — who may be written to,
  // and whether there is an identity to write as. Two readers, each
  // authoritative over its own half, and this one asks rather than re-deriving.
  //
  // Outreach owes this and NOT the publication gate, because nothing is
  // published: no page, no price on a page, no reply route to prove. Asking a
  // test for a page it was never going to have is the ritual this module's
  // header warns against, and the distinction is the mechanism rather than a
  // list of experiment ids.
  if (mechanism === 'workshop' || mechanism === 'outreach') {
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

    // WHICH SHOP IT WOULD ACT ON, AND WHETHER ANYONE HAS CHECKED.
    //
    // The owner renamed his Etsy shop from Printbls4YouStudio to ApexMicro and
    // said plainly: verify the actual shop URL and account identity during the
    // authorised connection rather than assuming the previous name remains
    // valid. So this asks for a connected credential that has READ the shop's
    // own id and name back from Etsy. A name in a document is not an identity;
    // a rename is exactly the event that turns a remembered name into a wrong
    // one, and acting on the wrong shop is not a mistake that can be undone by
    // noticing it afterwards.
    // The same scoping as the reading condition below, and for the same reason:
    // this pre-existed unscoped and the new code copied it rather than fixing
    // it, which a review caught.
    // A CONDITION WHOSE NAME SAID `confirmed` AND WHOSE EVIDENCE SAID
    // `connected`. It was `met` the moment a credential existed, on the
    // strength of a comment claiming "a connected Etsy account named its own
    // shop" — which a connected account may not have done, and which in any
    // case is Etsy's statement rather than his.
    //
    // Three facts, and the name of this condition has always meant the third:
    //
    //   connected  — a live credential exists
    //   verified   — Etsy answered which account it reaches (migration 346)
    //   confirmed  — HE said that account is the one he meant (migration 347)
    //
    // Etsy can be entirely truthful and the connection still wrong: a second
    // shop, one somebody else administers, a mis-click on a consent screen. No
    // provider answer detects that. So the condition asks for all three, and
    // because `qualificationStandsInTheWay` refuses on any blocking condition,
    // the recognition boundary is enforced AT THE OUTBOUND DOOR for every
    // origin — a route, a queued job, a retry, a scheduled pass, an agent —
    // rather than only being drawn on a page.
    //
    // NOT in the way of a delivery, a refund or a withdrawal: that gate returns
    // null for those before it ever reaches here, because somebody who has
    // already paid is owed their thing whatever has since gone wrong.
    const shopRow = productId ? (await query(
      `SELECT s.identity_verified_at, s.identity_confirmed_at,
              s.provider_account_label, s.provider_account_ref,
              s.identity_disputed_at, s.identity_disputed_ref,
              s.identity_confirmed_by, 'founder:' || p.owner_id AS the_owner
         FROM sense_credentials c
         JOIN company_senses s ON s.id = c.company_sense_id AND s.disconnected_at IS NULL
         JOIN products p ON p.id = c.product_id
        WHERE lower(c.provider) = lower(?) AND c.product_id = ? AND c.revoked_at IS NULL LIMIT 1`,
      [plan!.listing!.venue, productId])).rows[0] as Record<string, unknown> | undefined : undefined;
    const shopName = shopRow
      ? String(shopRow.provider_account_label ?? shopRow.provider_account_ref ?? 'an account')
      : null;
    // AND A RECOGNITION IS ABOUT ONE ACCOUNT (migration 348). The owner: "If the
    // provider subsequently reports a materially different account identity
    // … Foundry must not silently continue operating under the previous
    // recognition." A confirmed connection whose provider has started naming
    // somebody else is the MOST dangerous state this condition can be in — it
    // reads as fully recognised and is pointing somewhere he never agreed to —
    // so the disagreement is asked about before the confirmation is.
    //
    // It does not appear on a provider that merely went quiet. Nothing writes
    // these columns except a probe that answered and named a different stable
    // account reference; an outage, an unparseable answer and a rename each
    // leave them null by construction, in `identity-pass.ts`.
    conditions.push(!shopRow
      ? { name: 'the shop it would act on is confirmed', verdict: 'waits_for_you',
        because: `no ${venue} account is connected, so which shop this would act on has never been read back from ${venue} — and a shop that has been renamed is exactly the case a remembered name gets wrong` }
      : shopRow.identity_verified_at == null
        ? { name: 'the shop it would act on is confirmed', verdict: 'waits_for_you',
          because: `a ${venue} account is connected and has not yet told me which shop it opens` }
        : shopRow.identity_disputed_at != null
          ? { name: 'the shop it would act on is confirmed', verdict: 'waits_for_you',
            because: `${venue} has started naming a different account (${String(shopRow.identity_disputed_ref)}) than the ${shopName} recorded for this connection, so I do not know which shop this would act on` }
          : shopRow.identity_confirmed_at == null
            ? { name: 'the shop it would act on is confirmed', verdict: 'waits_for_you',
              because: `${venue} says this opens ${shopName}, and you have not said ${shopName} is your shop — a second account, or one somebody else administers, would look exactly like this from here` }
            // A RECOGNITION HAS AN AUTHOR, AND THE AUTHOR HAS TO BE THIS
            // COMPANY'S OWNER. `identity_confirmed_by` is written by the
            // confirm route as `founder:<id>` and was, until this line, a
            // column nothing consulted — provenance recorded for an incident
            // and never used to decide anything, which is how a recognition
            // made by one principal comes to confer authority to act for
            // another's company. Moot in a single-owner institution and
            // exactly the kind of thing that stops being moot without anybody
            // revisiting the code that assumed it.
            : shopRow.identity_confirmed_by !== shopRow.the_owner
              ? { name: 'the shop it would act on is confirmed', verdict: 'waits_for_you',
                because: `${shopName} was recognised by somebody who does not own this company, so that recognition is not authority to act here` }
              : met('the shop it would act on is confirmed',
                `${venue} named ${shopName} and you confirmed it is yours`));

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
    // AND IT IS THE READING CAPABILITY THAT ANSWERS THIS, NOT THE PUBLISHING
    // ONE. This keyed on the maturity of `list_on_marketplace` — the capability
    // that would PLACE the listing — which is the wrong row for the question
    // "can what the venue reports be read". They are different acts with
    // different credentials and different consequences, and tying them meant
    // the reading condition could never improve until the publishing one did.
    const eye = (await query(
      `SELECT p.maturity FROM capability_providers p
        WHERE p.capability_key = 'read_marketplace_account' AND lower(p.provider) = lower(?)`,
      [plan!.listing!.venue])).rows[0] as Record<string, unknown> | undefined;
    // SCOPED TO THIS ASSET, because a credential is connected to a company and
    // not to a deployment. Unscoped, one Etsy connection anywhere made every
    // listing experiment read as connected — while `readTheShop`, which
    // resolves the credential through `connectedSenses(productId)`, correctly
    // refused for the product that held none. The screen said connected and
    // the reader said no account.
    const connectedEye = productId ? (await query(
      `SELECT c.id FROM sense_credentials c
         JOIN company_senses s ON s.id = c.company_sense_id AND s.disconnected_at IS NULL
        WHERE lower(c.provider) = lower(?) AND c.product_id = ? AND c.revoked_at IS NULL LIMIT 1`,
      [plan!.listing!.venue, productId])).rows[0] as Record<string, unknown> | undefined : undefined;
    // What the venue tells this institution through the connection, as opposed
    // to what the owner typed off a statistics page.
    const readFor = (await query(
      `SELECT COUNT(*) AS n FROM market_observations o
         JOIN venture_experiments e ON e.claim_id = o.claim_id
        WHERE e.id = ? AND o.source LIKE ? AND o.retrieval_id IS NOT NULL`,
      [experimentId, `${plan!.listing!.venue}:shop:%`])).rows[0] as Record<string, unknown> | undefined;
    const readCount = Number(readFor?.n ?? 0);
    const typedCount = Number(readings?.n ?? 0);
    // THE LIMIT IS PART OF THE ANSWER, PERMANENTLY. Etsy exposes no
    // shop-statistics endpoint to anybody — no daily views, visits,
    // favourites, impressions or search queries — so no connection will ever
    // make those readable. Saying the venue "can be read" without that clause
    // would overstate what the best possible integration buys.
    const theLimit = `orders are what a connection can read; ${venue} reports no views, `
      + 'visits or impressions to anyone, so those stay yours to enter by hand';
    conditions.push(
      connectedEye && readCount > 0
        ? met('what the venue reports can be read',
          `${String(readCount)} readings taken from ${venue} itself — ${theLimit}`)
        : {
          name: 'what the venue reports can be read',
          verdict: connectedEye ? 'unproven'
            : eye && String(eye.maturity) !== 'declared' ? 'unproven' : 'waits_for_you',
          because: connectedEye
            ? `${venue} is connected and has not been read yet — ${theLimit}`
            : typedCount > 0
              ? `${String(typedCount)} readings, each entered by you — nothing here reads ${venue} on its own yet`
              : `nothing here reads ${venue} on its own, so an absence of sales would not be evidence of no sales`,
        });

    // AND THE REMEDY, WHICH IS THE PROMISE THE SITE ALREADY MAKES. Recorded as
    // a condition rather than as prose, because `/refunds` promises a refund
    // with no form and no time limit for a marketplace sale and nothing in the
    // institution can execute one.
    // NOT APPLICABLE TO *MY* READINESS, WHICH IS NOT THE SAME AS NOT REQUIRED.
    //
    // This was `waits_for_you`, unconditionally, on every listing experiment.
    // `blocking` and `stateFrom` both count anything that is neither `met` nor
    // `not_applicable`, so `blocked.length === 0` was unreachable and a
    // marketplace experiment could never read `ready_within_charter`. Worse:
    // `stateFrom` checks `decision === 'approved'` first and then falls to
    // `has('waits_for_you')`, so an experiment the owner HAD ALREADY APPROVED
    // reported that it was waiting for him to approve it — permanently, with
    // nothing he could do to clear it.
    //
    // The verdict is wrong because the question is. A refund on a marketplace
    // is not an unmet precondition on Foundry's competence; it is an act that
    // happens on the venue, by the person who holds the account there. The
    // promise on `/refunds` is unchanged and still honoured, and nothing here
    // claims an executor that does not exist — which is why this is
    // `not_applicable` rather than `met`. The sentence carries the whole truth
    // so the responsibility stays visible to the reader who needs it.
    conditions.push({
      name: 'a refund can be carried out',
      verdict: 'not_applicable',
      because: `a refund on ${venue} is your act there rather than a condition on my readiness; the only executor here is Stripe, and the site promises the refund either way`,
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
  experimentId: string; tool: string; kind?: ExperimentActKind | null;
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
  // THE ACT FIRST, AND THE FAMILY ONLY WHERE THERE IS NO ACT TO READ.
  //
  // This was keyed on the capability's FAMILY alone — `distribution` being the
  // family of putting something in front of people — and an independent review
  // found the hole that leaves. An offer and a delivery both go out through
  // `send_email`, whose family is `communication`, so the gate could not see an
  // offer at all: an experiment blocked on an unsealed prediction, a missing
  // allowance, an unrecorded boundary or a dead venue still sent offer mail to
  // strangers. The institution's own `distribution` capability for that act —
  // `reach_out` — has no provider and no tool, so it is never the tool at the
  // door, and the family could never have answered.
  //
  // `outbound_actions.experiment_act` is the fact the resolver already had: the
  // hand writes it when it plans the message, migration 284 makes it immutable,
  // and it says `offer` or `delivery` in exactly those words. Keyed on that,
  // the distinction the reasoning above depends on is a row rather than an
  // inference from which provider happens to carry the message.
  const kind = input.kind ?? null;
  // Never in the way of discharging what a customer is already owed, whatever
  // has since gone wrong with the machinery. This is the owner's rule — "Preserve
  // existing customer obligations even when new spending, outreach, publication,
  // or experiment authority is withdrawn" — and it is checked before anything
  // else so that no later clause can reach it. A withdrawal is here too: taking
  // an exposure DOWN because a test is not ready is the refusal doing the
  // opposite of its job.
  if (kind === 'delivery' || kind === 'refund' || kind === 'withdrawal') return null;
  if (kind !== 'offer') {
    // No act named this crossing — it was matched by an owner-approved
    // parameter fingerprint. Fall back to the family, which is what governs
    // listing on a marketplace and publishing a page.
    const fam = (await query(
      `SELECT c.family FROM capability_providers p
         JOIN capabilities c ON c.capability_key = p.capability_key
        WHERE p.tool = ?`, [input.tool])).rows[0] as Record<string, unknown> | undefined;
    if (!fam || String(fam.family) !== 'distribution') return null;
  }

  const r = await qualificationOf(input.experimentId);
  if (r.blocking.length === 0) return null;
  return {
    refusal: `the test is not ready for this: ${r.blocking.join('; ')}`,
    blocking: r.blocking,
  };
}
