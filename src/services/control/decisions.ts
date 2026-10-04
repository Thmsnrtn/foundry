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

/** THE ELEVEN ACTS, each read from the state it changes. */
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

  // SUBSCRIPTIONS (PENDING 31). The first-proof policy refuses recurring
  // billing, and only the owner, signed in, may supersede it — the database
  // refuses any other principal (migration 277). Read from his own row.
  const recurring = await subscriptionsAllowed(founderId);
  out.push({ key: 'subscriptions', act: 'Allow subscriptions, or keep refusing them', unblocks: 'tests that charge every week, with a cancel link in every email',
    state: recurring.allowed ? 'done' : 'open',
    seen: recurring.allowed ? `allowed by you on ${recurring.on ?? 'a recorded date'}; a recurring charge still counts against a design`
      : recurring.on ? `refused again by you on ${recurring.on}` : 'the first-proof rule still refuses recurring billing' });

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

