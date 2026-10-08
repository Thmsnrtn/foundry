// =============================================================================
// FOUNDRY — your decisions, read from what is true (Roadmap 2027 R1; ROADMAP H1).
//
// The fortnight that unblocks everything is the owner's: eleven acts, in the
// order the roadmap gives them (ROADMAP_2027.md, Part III-H0). A checklist the
// owner ticks is a belief, and it goes stale the day it is written. So each act
// here is read from the state it changes — the charter row, the Clerk key's
// prefix, whether the off-machine copy is configured, the shop's connection and
// findability, the owner's stated costs, tax assumption and hour — and an act
// whose effect Foundry cannot see says so, rather than claiming either way.
//
// A READER. It writes nothing, calls nothing outside this machine, and grants
// nothing: it says what is done and what is open, and the owner does the rest.
// =============================================================================

import { query, realCompany } from '../../db/client.js';

type Row = Record<string, unknown>;

export type DecisionState = 'done' | 'open' | 'cannot_see';

export interface YourDecision {
  key: string;
  /** The act, in the owner's words. */
  act: string;
  /** What it unblocks. */
  unblocks: string;
  state: DecisionState;
  /** What was read to say so, or why it cannot be read. */
  seen: string;
}

/** THE OWNER'S ACTS, each read from the state it changes. */
export async function yourDecisions(founderId: string, env: NodeJS.ProcessEnv = process.env): Promise<YourDecision[]> {
  const out: YourDecision[] = [];
  const cannot = (key: string, act: string, unblocks: string, why: string): void => {
    out.push({ key, act, unblocks, state: 'cannot_see', seen: why });
  };

  cannot('credentials', 'Revoke the old trading key and rotate the keys pasted in chat', 'credentials that only you hold',
    'Foundry cannot see another service\'s keys. Mark it done for yourself once each is rotated.');

  const { clerkInstanceOf } = await import('../../lib/clerk-instance.js');
  const clerk = clerkInstanceOf(env);
  // PENDING 24, decided by the owner on 1 October 2026: one owner, so the
  // development instance stays until the phone week or the first sale gives a
  // reason to move. Development keys are that decision, not an open act; keys
  // from two instances, or none, are faults and stay open whatever was decided.
  out.push({ key: 'clerk', act: 'Decide which sign-in instance Foundry uses', unblocks: 'sign-in you have chosen, not inherited',
    state: clerk === 'production' || clerk === 'development' ? 'done' : 'open',
    seen: clerk === 'production' ? 'the sign-in keys are production keys'
      : clerk === 'development' ? 'development keys, by your decision of 1 October 2026; revisit after the phone week or the first sale'
        : clerk === 'mismatched' ? 'the two sign-in keys are from different instances' : 'sign-in is not configured' });

  const { awayConfig } = await import('../institution/sending-away.js');
  const away = awayConfig(env);
  out.push({ key: 'copy_away', act: 'Give the daily copy somewhere off this machine', unblocks: 'a copy that survives losing the machine',
    state: 'config' in away ? 'done' : 'open', seen: 'config' in away ? 'the off-machine copy is configured' : away.notConfigured });

  cannot('witness', 'Merge to the main branch, and push the archive tag', 'the outside watcher that checks Foundry every 15 minutes',
    'Foundry does not reach out to GitHub to check. The watcher\'s own emails will tell you once it runs.');

  const costs = Number(((await query(`SELECT COUNT(DISTINCT provider) AS n FROM foundry_cost_lines WHERE founder_id = ?`, [founderId]))
    .rows[0] as Row).n ?? 0);
  const { policyInForce } = await import('../economy/ledger.js');
  const tax = await policyInForce(founderId, 'tax_reserve');
  const { hourValueOf } = await import('../economy/projection.js');
  const hour = await hourValueOf(founderId);
  const missing = [costs === 0 ? 'the monthly bills' : null, tax ? null : 'a tax assumption', hour ? null : 'what an hour is worth']
    .filter((x): x is string => x !== null);
  out.push({ key: 'money', act: 'Enter the bills, a tax assumption and what an hour of yours is worth', unblocks: 'Foundry\'s own line, and what is yours to take',
    state: missing.length === 0 ? 'done' : 'open',
    seen: missing.length === 0 ? `${String(costs)} bills, a tax assumption and an hour's worth are stated`
      : `not yet stated: ${missing.join(', ')}` });

  out.push({ key: 'sentry', act: 'Turn on off-machine error reports, or decide not to', unblocks: 'errors seen somewhere other than this machine',
    state: (env.SENTRY_DSN ?? '').trim() ? 'done' : 'open',
    seen: (env.SENTRY_DSN ?? '').trim() ? 'error reports are configured' : 'error reports are not configured' });

  cannot('phone', 'Use Foundry on your phone for a week, and say where it lied', 'every change made for the phone',
    'Only you can say how it felt to use.');
  cannot('pending', 'Decide the open questions: Experiment 001\'s result, the next product, free or licensed tests, the public disclosure', 'the record, and the next product',
    'They are written in the decisions record, which is yours to answer.');
  cannot('refunds', 'Say how a refund is given, and by whom', 'a refund promise you can keep',
    'Etsy refunds are made in Etsy by you; Foundry cannot see them.');

  // WHAT SELLING DEPENDS ON (R26), each read from where it is true. The
  // payment events are 'done' only when a live-mode event has actually
  // arrived in the last 30 days: a configured secret alone proves nothing,
  // and a test-mode event proves the machinery, not the live route.
  const { paymentObservationPath } = await import('../venture/the-instrument.js');
  const heard = await paymentObservationPath();
  out.push({ key: 'stripe_events', act: 'Point one Stripe endpoint at Foundry and give it the signing secret', unblocks: 'hearing about a payment; without it every priced offer is refused',
    state: heard.status === 'working' ? 'done' : 'open', seen: heard.detail });
  const money = env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true';
  out.push({ key: 'money_switch', act: 'Turn on the money switch in the Fly secrets', unblocks: 'refunds and cancellations made by Foundry, only on its own tagged charges',
    state: money ? 'done' : 'open', seen: money ? 'the money switch is on' : 'the money switch is off, so every refund and cancellation is yours in Stripe' });
  const { correspondenceMode } = await import('../public-workshop/correspondence.js');
  const mode = await correspondenceMode(founderId);
  out.push({ key: 'correspondence', act: 'Set correspondence to "drafts" (Foundry drafts, you approve)', unblocks: 'buyer email off your hands',
    state: mode === 'off' ? 'open' : 'done', seen: mode === 'off' ? 'correspondence is off, so every buyer email is yours' : `correspondence is in ${mode} mode` });

  // SUBSCRIPTIONS (PENDING 31). The first-proof policy refuses recurring
  // billing, and only the owner, signed in, may supersede it — the database
  // refuses any other principal (migration 277). Read from his own row.
  const recurring = await subscriptionsAllowed(founderId);
  out.push({ key: 'subscriptions', act: 'Allow subscriptions, or keep refusing them', unblocks: 'tests that charge every week, with a cancel link in every email',
    state: recurring.allowed ? 'done' : 'open',
    seen: recurring.allowed ? `allowed by you on ${recurring.on ?? 'a recorded date'}; a recurring charge still counts against a design`
      : recurring.on ? `refused again by you on ${recurring.on}` : 'the first-proof rule still refuses recurring billing' });

  // PLACING OFFERS THAT STILL COST HIM MINUTES PER SALE (PENDING 32, R23).
  // Every forge-made offer honestly says it is not yet attention spent once:
  // refunds are his while the money switch is off, buyer email is his while
  // correspondence is off. Only he may let such an offer be placed, and his
  // answer reaches every future offer of any kind, so it is shown again when
  // either condition differs from the one he decided under.
  const attention = await frontLoadedAttentionChoice(founderId, env);
  out.push({ key: 'front_loaded_attention', act: 'Let Foundry place offers that still take some of your minutes per sale, or keep refusing them',
    unblocks: 'any offer the forge makes reaching a page; it applies to every future offer of any kind',
    state: attention.decided && !attention.conditionsChanged ? 'done' : 'open',
    seen: `${attention.decided
      ? `${attention.allowed ? 'allowed' : 'refused'} by you on ${attention.on ?? 'a recorded date'}${attention.conditionsChanged ? ', decided when ' + (attention.decidedUnder ?? 'conditions were different') + '; they differ now' : ''}`
      : 'the first-proof rule still refuses them, so no forge-made offer can be placed'}. Per sale today: ${attention.now}` });

  // PRINTABLE FILES MADE BY THE HANDS (PENDING 41). Built and off: only his
  // own `make_printable_pdf` row turns it on, and a machine with no Chromium
  // cannot print whatever he says (products/printable.ts).
  // DONE IS HIS ANSWER, not the machine's: once he has said yes the act is
  // his and made, and a machine with no Chromium is said as the reason it
  // still cannot print, rather than as a decision he has yet to make.
  const { mayMakePrintables, printablesChoice } = await import('../venture/products/printable.js');
  const printing = await mayMakePrintables(founderId, env);
  out.push({ key: 'printables', act: 'Let Foundry make printable files itself, or keep refusing them',
    unblocks: 'tests that sell a file the hands wrote, printed and checked, delivered by a download link; a clear panel yes ships, a split one waits for you',
    state: (await printablesChoice(founderId)).allowed ? 'done' : 'open', seen: printing.because });

  const { liveCharter } = await import('../institution/charter.js');
  const charter = await liveCharter(founderId);
  out.push({ key: 'charter', act: 'Sign the charter, with the smallest envelope that lets a test seal', unblocks: 'tests that can seal, and thinking above $1 a day',
    state: charter ? 'done' : 'open', seen: charter ? 'a charter is in force' : 'no charter is signed' });

  // FINDABLE: connected to the shop, the owner says buyers can find it, and
  // the venue's own last word is not "on vacation".
  // STANDING DOES NOT APPLY: the listing is an experimental asset by nature.
  const listed = (await query(
    `SELECT DISTINCT s.product_id, s.provider FROM company_senses s JOIN products p ON p.id = s.product_id
      WHERE p.owner_id = ? AND p.deleted_at IS NULL AND s.disconnected_at IS NULL AND s.mode = 'real' AND ${realCompany('p')}
        AND s.provider = 'etsy'`, [founderId])).rows as unknown as Row[];
  const { findabilityOf, venueSaysOnVacation } = await import('../venture/findability.js');
  let findable = false; let seen = 'the shop is not connected';
  for (const l of listed) {
    const said = await findabilityOf(String(l.product_id), String(l.provider));
    const venue = await venueSaysOnVacation(String(l.product_id), String(l.provider));
    if (said?.findable && venue?.onVacation !== true) { findable = true; seen = 'connected; you said buyers can find it, and Etsy does not say otherwise'; break; }
    seen = said?.findable === false ? 'connected; you said it is hidden' : venue?.onVacation ? 'connected; Etsy says the shop is on vacation'
      : 'connected; you have not said whether buyers can find it';
  }
  out.push({ key: 'findable', act: 'Get the shop findable again, and tell Foundry the day', unblocks: 'the thirty days that test whether anybody buys',
    state: findable ? 'done' : 'open', seen });
  return out;
}

/**
 * WHETHER HE HAS ALLOWED SUBSCRIPTIONS: his own live row for
 * `no_recurring_billing`, and only a non-binding treatment counts as allowed.
 * No row of his means the institutional default, which refuses.
 */
export async function subscriptionsAllowed(founderId: string): Promise<{ allowed: boolean; on: string | null }> {
  const row = (await query(
    `SELECT treatment, set_at FROM origination_policy
      WHERE founder_id = ? AND requirement = 'no_recurring_billing' AND superseded_at IS NULL
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [founderId])).rows[0] as Row | undefined;
  if (!row) return { allowed: false, on: null };
  const binding = String(row.treatment) === 'refuse' || String(row.treatment) === 'require';
  return { allowed: !binding, on: String(row.set_at).slice(0, 10) };
}


/**
 * THE CONDITIONS A PER-SALE MINUTE DEPENDS ON, AS ONE SENTENCE. Written into
 * his decision's reason when he makes it, and compared with the same sentence
 * now, so a choice made while refunds were his is shown again once they are
 * not (and the other way round).
 */
export async function perSaleConditions(founderId: string, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const { money, mode } = await perSaleReading(founderId, env);
  return `the money switch was ${money ? 'on' : 'off'} and correspondence was ${mode}`;
}

async function perSaleReading(founderId: string, env: NodeJS.ProcessEnv): Promise<{ money: boolean; mode: string; said: string }> {
  const { correspondenceMode } = await import('../public-workshop/correspondence.js');
  const money = env.FOUNDRY_ENABLE_MONEY_TOOLS === 'true';
  const mode = await correspondenceMode(founderId);
  const said = `${money ? 'refunds and cancellations are Foundry\'s' : 'every refund and cancellation is yours, in Stripe'}; `
    + `${mode === 'off' ? 'every buyer email is yours' : `buyer email is in ${mode} mode`}`;
  return { money, mode, said };
}

/**
 * HIS ANSWER ON `front_loaded_attention`: his own live row, never the
 * institutional default. Allowed means a non-binding treatment.
 */
export async function frontLoadedAttentionChoice(founderId: string, env: NodeJS.ProcessEnv = process.env): Promise<{
  decided: boolean; allowed: boolean; on: string | null; decidedUnder: string | null; conditionsChanged: boolean; now: string;
}> {
  const nowUnder = await perSaleConditions(founderId, env);
  const now = (await perSaleReading(founderId, env)).said;
  const row = (await query(
    `SELECT treatment, why, set_at FROM origination_policy
      WHERE founder_id = ? AND requirement = 'front_loaded_attention' AND superseded_at IS NULL
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [founderId])).rows[0] as Row | undefined;
  if (!row) return { decided: false, allowed: false, on: null, decidedUnder: null, conditionsChanged: false, now };
  const binding = String(row.treatment) === 'refuse' || String(row.treatment) === 'require';
  const under = /\[decided when (.+?)\]/.exec(String(row.why))?.[1] ?? null;
  return { decided: true, allowed: !binding, on: String(row.set_at).slice(0, 10), decidedUnder: under,
    conditionsChanged: under !== null && under !== nowUnder, now };
}
