// =============================================================================
// FOUNDRY — what a button would actually do, said on the button
//
// On 10 September the owner opened Foundry to authorise one thing and pressed
// nine buttons in one hundred and thirty-seven seconds. Every one of them read
// "Go ahead — nothing" or "Go ahead — $100.00". Eight were internal tests. The
// ninth was Experiment 001, whose text begins "Write once to each approved
// Massachusetts millwork business as Thomas Norton". The only visible difference
// between those two classes of authority was the price string after the dash.
//
// He was not careless. The interface asked nine identical-looking questions and
// one of them meant something else.
//
// THE COST IS NOT THE RISK. "$0" is a statement about a budget, not about
// consequence: a free test that ends with a real person reading a real message
// is not an internal test. So cost never appears alone here, and effect class is
// never derived from money.
//
// AND A DECISION THAT CANNOT BE CLASSIFIED IS NOT OFFERED. `cannotSay` is a
// real return value with no button attached. An institution that renders a
// control it cannot describe is asking for a signature on a blank page.
// =============================================================================

import { query } from '../../db/client.js';

/**
 * WHERE THE ACT LANDS. Not how much it costs, not how hard it is, not how
 * confident anybody is — who or what is on the other end of it.
 *
 * `internal` nothing leaves Foundry
 * `provider`  a third-party service is called, or a resource created there
 * `account`   something the owner holds elsewhere changes
 * `public`    a page the world can read appears or changes
 * `person`    a human being receives something
 */
export type EffectClass = 'internal' | 'provider' | 'account' | 'public' | 'person';

/** Plainer than the act ladder's four words, because he is reading it once. */
export type HowReversible = 'reversible' | 'partly_reversible' | 'irreversible';

export interface Consequence {
  /** What happens if he presses it, in one sentence, in his words. */
  what: string;
  effect: EffectClass;
  /** Who or what is on the other end. Named, or 'nobody'. */
  touches: string;
  expectedCents: number;
  maxCents: number;
  /** When the authority ends, in words. Null only where nothing is authorised. */
  expires: string | null;
  reversibility: HowReversible;
  /** What pressing it does NOT authorise. The list is the point. */
  doesNotAuthorise: string[];
  /**
   * When this decision belongs to a surface of its own, where that is. A
   * general control must never present itself as an equivalent alternative to
   * a dedicated authorisation.
   */
  dedicated: { path: string; why: string } | null;
}

export interface CannotSay { cannotSay: string }

export function isCannotSay(c: Consequence | CannotSay): c is CannotSay {
  return (c as CannotSay).cannotSay !== undefined;
}

const WORDS: Record<EffectClass, string> = {
  internal: 'internal',
  provider: 'provider-facing',
  account: 'account-facing',
  public: 'public',
  person: 'person-facing',
};

export function effectInWords(e: EffectClass): string { return WORDS[e]; }

function money(cents: number): string {
  return cents === 0 ? '$0' : `$${(cents / 100).toFixed(2)}`;
}

/**
 * THE LABEL IS THE CONSEQUENCE, and it is built here so that no page can
 * assemble one that leaves out the part he needed.
 *
 * Three facts, always, in the same order: what it does, where it lands, what it
 * can cost. "Continue internal investigation · $0 · nobody contacted" cannot be
 * mistaken for "Authorize outreach to 2 businesses · person-facing · up to
 * $100.00", which is the entire point.
 */
export function labelFor(c: Consequence): string {
  const where = c.effect === 'internal' && c.touches === 'nobody'
    ? 'nobody contacted' : `${WORDS[c.effect]} · ${c.touches}`;
  const cost = c.maxCents === 0 ? money(0)
    : c.expectedCents === c.maxCents ? money(c.maxCents)
      : `up to ${money(c.maxCents)}`;
  return c.effect === 'internal' && c.touches === 'nobody'
    ? `${c.what} · ${cost} · ${where}`
    : `${c.what} · ${where} · ${cost}`;
}

/**
 * WHAT APPROVING THIS TEST WOULD DO — read from the test, not from its price.
 *
 * The classification turns on one question: is there anybody or anything
 * outside Foundry on the other end of this approval *as it stands today*. A
 * test that names businesses to write to, or already has a public page, is not
 * internal however little it costs. A test that names nothing is internal
 * however much it is budgeted, and stays internal until a separate act says
 * otherwise — which is why `doesNotAuthorise` is on every one of them.
 */
export async function consequenceOfApproving(experimentId: string): Promise<Consequence | CannotSay> {
  const e = (await query(
    `SELECT id, founder_id, decision, cost_cents, evidence_mode, needs_workshop,
            what_we_do, retired_at
       FROM venture_experiments WHERE id = ?`, [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  if (!e) return { cannotSay: 'there is no such test' };
  if (e.retired_at != null) return { cannotSay: 'this test has been retired' };

  const recipients = Number((await query(
    'SELECT count(*) AS n FROM experiment_recipients WHERE experiment_id = ?',
    [experimentId])).rows[0]?.n ?? 0);
  const publicIdentity = (await query(
    'SELECT slug FROM public_experiments WHERE experiment_id = ?',
    [experimentId])).rows[0] as Record<string, unknown> | undefined;

  const maxCents = Number(e.cost_cents ?? 0);

  // ── A test with people on the other end owns its own decision surface ──
  //
  // This is the collision of 10 September stated as a rule. An experiment that
  // already names businesses, or already has a page written for strangers, is
  // not something a general "approve this test" control may decide. The general
  // control's job here is to say so and point at the right door.
  if (recipients > 0 || publicIdentity) {
    return {
      what: recipients > 0
        ? `Authorize writing to ${recipients === 1 ? 'a business' : `${recipients} businesses`}`
        : 'Authorize publishing this offer',
      effect: recipients > 0 ? 'person' : 'public',
      touches: recipients > 0
        ? `${recipients} named ${recipients === 1 ? 'business' : 'businesses'}`
        : 'anybody on the internet',
      expectedCents: 0,
      maxCents,
      expires: null,
      reversibility: 'irreversible',
      doesNotAuthorise: [],
      dedicated: {
        path: `/foundry/experiments/${String(e.id)}`,
        why: recipients > 0
          ? 'this test names real businesses, and who may be written to is decided on its own page'
          : 'this test has a page written for strangers, and publishing it is decided on its own page',
      },
    };
  }

  // ── Otherwise: approving builds something to test with, and nothing else ──
  return {
    what: 'Continue internal investigation',
    effect: 'internal',
    touches: 'nobody',
    expectedCents: 0,
    maxCents,
    // The horizon the asset's allowance actually carries, so the sentence he
    // reads and the row the spend door reads are the same fourteen days.
    expires: maxCents === 0 ? 'nothing to spend' : '14 days after you approve',
    reversibility: 'reversible',
    doesNotAuthorise: [
      'contacting anybody',
      'publishing anything',
      'spending outside Foundry',
      'creating a paid resource at a provider',
      'acting as you',
      'changing an account you hold elsewhere',
      'entering into a commitment',
    ],
    dedicated: null,
  };
}
