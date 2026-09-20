// =============================================================================
// FOUNDRY - "Can I disappear for a week?" and "What happened while I was away?"
//
// The owner's acceptance test for safe leverage. Not maximum activity: the
// honest answer to the first question is a list of what Foundry carries, what
// it cannot, what authority it holds, what might need him, and what will wait
// - across every real company and the venture frontier - and the honest
// answer to the second is what happened, what was handled, what changed, what
// money moved, what reached the world, what came back from the world, what was
// learned, and what needs him now.
//
// EVERYTHING HERE IS A READ OVER RECORDS THAT ALREADY EXIST. Nothing is
// inferred from silence: a company nothing reports on is listed as a company
// Foundry cannot see, not as a quiet one. Reference companies never appear.
// =============================================================================

import { GRADE_SQL, outcomeFromRow, outcomeSentence, type OutcomeRow } from './what-happened.js';
import { query, realCompany } from '../../db/client.js';

export interface WeekAwayView {
  /** The one sentence at the top. */
  verdict: string;
  carries: string[];
  cannotCarry: string[];
  authority: string[];
  mightNeedYou: string[];
  willWait: string[];
  /** Companies Foundry is blind to, named, because quiet from them means nothing. */
  blind: string[];
}

function money(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

export async function canIDisappear(founderId: string): Promise<WeekAwayView> {
  const companies = (await query(
    `SELECT p.id, p.name, p.posture,
            (SELECT COUNT(*) FROM company_senses s
              WHERE s.product_id = p.id AND s.disconnected_at IS NULL) AS senses,
            (SELECT COUNT(*) FROM company_senses s
              WHERE s.product_id = p.id AND s.disconnected_at IS NULL AND s.last_error IS NOT NULL) AS failing
       FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
        AND ${realCompany('p')}
      ORDER BY p.created_at`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;

  const carries: string[] = [];
  const cannotCarry: string[] = [];
  const authority: string[] = [];
  const mightNeedYou: string[] = [];
  const willWait: string[] = [];
  const blind: string[] = [];

  const { getStepAwayHorizon, getSevenDayResponsibilitySummary } = await import(
    '../institution/absence-summary.js');
  const { getUncarriableResponsibilities } = await import('../institution/assisting-admission.js');
  const { allowanceFor } = await import('../institution/standing-intent.js');

  for (const c of companies) {
    const id = String(c.id);
    const name = String(c.name);
    if (Number(c.senses) === 0) blind.push(name);
    if (Number(c.failing) > 0) mightNeedYou.push(`${name}: something I watch has stopped reporting`);

    const summary = await getSevenDayResponsibilitySummary(id);
    const carried = Object.values(summary).flat()
      .filter((r) => r.state === 'assisting' || r.state === 'shadowing');
    for (const r of carried) carries.push(`${name}: ${r.title}`);
    for (const r of await getUncarriableResponsibilities(id)) {
      cannotCarry.push(`${name}: ${r.title}`);
    }
    const horizon = await getStepAwayHorizon(id);
    if (horizon.alreadyOverdue > 0) {
      mightNeedYou.push(`${name}: ${String(horizon.alreadyOverdue)} `
        + `${horizon.alreadyOverdue === 1 ? 'thing is' : 'things are'} already past its date`);
    }
    if (horizon.daysUntilSoonestDue !== null && horizon.daysUntilSoonestDue < 7) {
      mightNeedYou.push(`${name}: ${horizon.soonestDueTitle ?? 'something'} is due in `
        + `${String(horizon.daysUntilSoonestDue)} ${horizon.daysUntilSoonestDue === 1 ? 'day' : 'days'}`);
    }
    if (horizon.loopsStopped > 0) {
      mightNeedYou.push(`${name}: ${String(horizon.loopsStopped)} of my own routines `
        + 'for it are not running, so quiet from it would mean nothing');
    }
    const allowance = await allowanceFor(id);
    if (allowance) {
      authority.push(`${name}: I may spend up to ${money(allowance.remainingCents)} more `
        + `(${allowance.statement})`);
    } else {
      authority.push(`${name}: I cannot spend anything`);
    }
    const boundaries = (await query(
      `SELECT subject, mode FROM owner_boundaries
        WHERE (product_id = ? OR product_id IS NULL) AND lifted_at IS NULL`, [id]))
      .rows as unknown as Array<Record<string, unknown>>;
    const never = boundaries.filter((b) => String(b.mode) === 'never').map((b) => String(b.subject).replace(/_/g, ' '));
    const ask = boundaries.filter((b) => String(b.mode) === 'ask_first').map((b) => String(b.subject).replace(/_/g, ' '));
    if (never.length) authority.push(`${name}: I will not ${never.join(', ')}`);
    if (ask.length) authority.push(`${name}: I will ask before I ${ask.join(', ')}, so those wait`);
    const situation = (await query(
      `SELECT situation, headline FROM company_situations
        WHERE product_id = ? AND ended_at IS NULL`, [id]))
      .rows[0] as Record<string, unknown> | undefined;
    if (situation && String(situation.situation) !== 'steady' && String(situation.situation) !== 'growing') {
      mightNeedYou.push(`${name}: ${String(situation.headline)}`);
    }
    const waiting = Number(((await query(
      `SELECT COUNT(*) AS n FROM proposed_acts
        WHERE product_id = ? AND decision IS NULL AND datetime(expires_at) > datetime('now')`, [id]))
      .rows[0] as Record<string, unknown>).n);
    if (waiting > 0) willWait.push(`${name}: ${String(waiting)} `
      + `${waiting === 1 ? 'proposal' : 'proposals'} I will not act on until you decide`);
  }

  // THE FRONTIER. A search keeps running; nothing on it advances without him.
  const frontier = (await query(
    `SELECT
       (SELECT COUNT(*) FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL AND evidence_mode = 'real') AS searching,
       -- ONLY DESIGNED TESTS WAIT FOR HIM. An experiment with no design row
       -- says nothing about who, at what price, through which channel or
       -- what would stop it, so there is nothing in it to approve. Twenty-two
       -- of these sat in the queue as identical boilerplate across twenty
       -- unrelated opportunities.
       (SELECT COUNT(*) FROM venture_experiments e
          JOIN probe_designs d ON d.experiment_id = e.id
         WHERE e.founder_id = ? AND e.decision IS NULL AND e.evidence_mode = 'real') AS tests,
       (SELECT COUNT(*) FROM venture_opportunities WHERE founder_id = ? AND verdict IS NULL AND evidence_mode = 'real') AS candidates`,
    [founderId, founderId, founderId])).rows[0] as Record<string, unknown>;
  if (Number(frontier.searching) > 0) {
    carries.push('the search for another income stream keeps running; nothing on it becomes a '
      + 'company or spends anything without you');
  }
  if (Number(frontier.tests) > 0) {
    willWait.push(`${String(frontier.tests)} ${Number(frontier.tests) === 1 ? 'test' : 'tests'} `
      + 'on the frontier waiting for your go-ahead');
  }

  const verdict = companies.length === 0
    ? 'Yes. I hold nothing of yours yet, so there is nothing that could need you.'
    : mightNeedYou.length === 0 && cannotCarry.length === 0
      ? `Yes. ${carries.length === 0 ? 'I am watching, and I will not act' : 'I carry what is listed'}; `
        + 'nothing is due, nothing is broken, and everything I cannot decide will wait.'
      : mightNeedYou.length === 0
        ? 'Yes, with one caveat: there are things I cannot carry, listed below, and they will '
          + 'simply not be done while you are away.'
        : `Not without knowing this: ${mightNeedYou[0] ?? ''}. `
          + `${mightNeedYou.length > 1 ? `And ${String(mightNeedYou.length - 1)} more below. ` : ''}`
          + 'Everything else will wait.';
  return { verdict, carries, cannotCarry, authority, mightNeedYou, willWait, blind };
}

export interface ReturnLetter {
  since: string;
  happened: string[];
  handled: string[];
  changed: string[];
  money: string[];
  effects: string[];
  outcomes: string[];
  learned: string[];
  needsYou: string[];
}

/**
 * WHAT HAPPENED WHILE HE WAS AWAY - in the order the owner asked for it.
 *
 * Every line is a record: a situation that began or ended, a responsibility
 * that reached an outcome, a boundary or posture he set, spend, an effect that
 * left through the door, a test that came back, a candidate that was buried
 * with why. A week in which none of those happened produces a letter that says
 * so, not a letter padded with activity.
 */
export async function whileYouWereAway(founderId: string, days = 7): Promise<ReturnLetter> {
  const since = `-${String(days)} days`;
  const companies = (await query(
    `SELECT p.id, p.name FROM products p
      WHERE p.owner_id = ? AND p.status = 'active' AND p.standing = 'earned' AND p.deleted_at IS NULL
        AND ${realCompany('p')}`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const names = new Map(companies.map((c) => [String(c.id), String(c.name)]));
  const ids = [...names.keys()];
  const marks = ids.map(() => '?').join(',') || "''";

  const happened: string[] = [];
  const handled: string[] = [];
  const changed: string[] = [];
  const moneyLines: string[] = [];
  const effects: string[] = [];
  const outcomes: string[] = [];
  const learned: string[] = [];
  const needsYou: string[] = [];

  if (ids.length > 0) {
    for (const s of (await query(
      `SELECT product_id, situation, headline, began_at, ended_at, ended_as FROM company_situations
        WHERE product_id IN (${marks}) AND (began_at >= datetime('now', ?) OR ended_at >= datetime('now', ?))
        ORDER BY began_at`, [...ids, since, since]))
      .rows as unknown as Array<Record<string, unknown>>) {
      const name = names.get(String(s.product_id)) ?? '';
      if (s.ended_at != null) {
        happened.push(`${name}: stopped being ${String(s.situation).replace(/_/g, ' ')}`
          + `${s.ended_as ? ` and became ${String(s.ended_as).replace(/_/g, ' ')}` : ''}`);
      } else {
        happened.push(`${name}: ${String(s.headline)}`);
      }
    }
    for (const t of (await query(
      `SELECT r.product_id, r.title, t.to_state, t.reason FROM responsibility_transitions t
         JOIN institutional_responsibilities r ON r.id = t.responsibility_id
        WHERE r.product_id IN (${marks}) AND t.created_at >= datetime('now', ?)
        ORDER BY t.created_at`, [...ids, since]))
      .rows as unknown as Array<Record<string, unknown>>) {
      handled.push(`${names.get(String(t.product_id)) ?? ''}: ${String(t.title)} - now `
        + `${String(t.to_state)}${t.reason ? ` (${String(t.reason)})` : ''}`);
    }
    for (const b of (await query(
      `SELECT product_id, statement, set_at, lifted_at FROM owner_boundaries
        WHERE (product_id IN (${marks}) OR product_id IS NULL)
          AND (set_at >= datetime('now', ?) OR lifted_at >= datetime('now', ?))`,
      [...ids, since, since])).rows as unknown as Array<Record<string, unknown>>) {
      changed.push(`${b.product_id == null ? 'everywhere' : names.get(String(b.product_id)) ?? ''}: `
        + `${b.lifted_at != null ? 'you lifted' : 'you said'} "${String(b.statement)}"`);
    }
    for (const p of (await query(
      `SELECT product_id, to_posture, said FROM posture_changes
        WHERE product_id IN (${marks}) AND changed_at >= datetime('now', ?)`, [...ids, since]))
      .rows as unknown as Array<Record<string, unknown>>) {
      changed.push(`${names.get(String(p.product_id)) ?? ''}: now ${String(p.to_posture)} - "${String(p.said)}"`);
    }
    for (const m of (await query(
      `SELECT scope_id, SUM(spent_cents) AS c FROM ai_daily_spend
        WHERE scope = 'product' AND scope_id IN (${marks}) AND date >= date('now', ?)
        GROUP BY scope_id`, [...ids, since])).rows as unknown as Array<Record<string, unknown>>) {
      if (Number(m.c) > 0) moneyLines.push(`${names.get(String(m.scope_id)) ?? ''}: ${money(Number(m.c))} on AI`);
    }
    for (const e of (await query(
      `SELECT product_id, action_type, COUNT(*) AS n FROM audit_log
        WHERE product_id IN (${marks}) AND action_type LIKE 'gateway:%'
          AND outcome <> 'refused' AND created_at >= datetime('now', ?)
        GROUP BY product_id, action_type`, [...ids, since]))
      .rows as unknown as Array<Record<string, unknown>>) {
      effects.push(`${names.get(String(e.product_id)) ?? ''}: ${String(e.action_type).replace('gateway:', '').replace(/_/g, ' ')} `
        + `x${String(e.n)}`);
    }
    for (const d of (await query(
      `SELECT product_id, summary, decision FROM proposed_acts
        WHERE product_id IN (${marks}) AND decision IS NULL AND datetime(expires_at) > datetime('now')`,
      [...ids])).rows as unknown as Array<Record<string, unknown>>) {
      needsYou.push(`${names.get(String(d.product_id)) ?? ''}: ${String(d.summary)}`);
    }
  }

  for (const e of (await query(
    `SELECT e.id, e.what_we_do, e.what_we_expect, e.what_happened, e.verdict, e.cost_cents, e.ran_at,
            ${GRADE_SQL} AS grade
       FROM venture_experiments e
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.ran_at >= datetime('now', ?)`,
    [founderId, since])).rows as unknown as Array<Record<string, unknown>>) {
    // THE ONE VOCABULARY: "settled surprised", the same word as the page.
    const o = outcomeFromRow(e as OutcomeRow);
    outcomes.push(`${String(e.what_we_do)}: ${outcomeSentence(o)} ${o.meaning} I predicted: ${String(e.what_we_expect)}.`);
    // THE CEILING IS NOT THE SPEND. "$100 on a test" printed the amount
    // approved under a heading that read as money gone; the one reading of a
    // test's money says what was set aside and what of it actually went.
    if (Number(e.cost_cents) > 0) {
      const { moneyOfExperiment } = await import('./experiment-view.js');
      moneyLines.push(`a test, ${String(e.what_we_do)}: ${(await moneyOfExperiment(String(e.id))).sentence}`);
    }
  }
  // WHAT THE VENTURE DID, WHETHER OR NOT HE OWNS A COMPANY. Everything above
  // this line is scoped to owned companies, so with none the letter said
  // "nothing left the building" a week after 21 businesses were written to
  // under a test, "nothing you set changed" after he steered the search, and
  // "nothing settled" after a test settled. The venture's rows are his too.
  // STANDING DOES NOT APPLY: the join reaches each test's own asset, which is
  // experimental by nature — this reports what the tests sent, as the tests.
  for (const o of (await query(
    `SELECT e.what_we_do, COUNT(*) AS n,
            SUM(CASE WHEN o.status = 'executed' THEN 1 ELSE 0 END) AS sent
       FROM outbound_actions o
       JOIN products p ON p.id = o.product_id
       JOIN venture_experiments e ON e.id = p.from_experiment_id
      WHERE e.founder_id = ? AND o.action_type = 'send_email' AND ${realCompany('p')}
        AND COALESCE(o.executed_at, o.created_at) >= datetime('now', ?)
      GROUP BY e.id`, [founderId, since])).rows as unknown as Array<Record<string, unknown>>) {
    effects.push(`${String(o.sent)} of ${String(o.n)} messages sent to people under the test: ${String(o.what_we_do)}`);
  }
  // THE SEARCH RAN. Fifteen mornings of looking and finding nothing read as
  // nothing having happened; the mornings are what happened.
  const { mandateProgress } = await import('../venture/mandate.js');
  const search = await mandateProgress(founderId);
  if (search && search.mandate.evidenceMode === 'real') {
    happened.push(`the search "${search.mandate.statement}" ran each morning: ${String(search.looked)} looked at, `
      + `${String(search.open)} standing, ${String(search.rejected)} buried`);
  }
  for (const m of (await query(
    `SELECT statement, closed_reason,
            CASE WHEN closed_at IS NOT NULL AND closed_at >= datetime('now', ?) THEN 1 ELSE 0 END AS closed_lately
       FROM venture_mandates
      WHERE founder_id = ? AND evidence_mode = 'real'
        AND (opened_at >= datetime('now', ?) OR closed_at >= datetime('now', ?))
      ORDER BY opened_at`, [since, founderId, since, since])).rows as unknown as Array<Record<string, unknown>>) {
    changed.push(Number(m.closed_lately) === 1
      ? `the search "${String(m.statement)}" closed: ${String(m.closed_reason ?? '')}`
      : `a search opened: "${String(m.statement)}"`);
  }
  for (const g of (await query(
    `SELECT g.statement FROM venture_guidance g JOIN venture_mandates m ON m.id = g.mandate_id
      WHERE m.founder_id = ? AND g.given_at >= datetime('now', ?) ORDER BY g.rowid`, [founderId, since]))
    .rows as unknown as Array<Record<string, unknown>>) {
    changed.push(`you steered the search: "${String(g.statement)}"`);
  }
  for (const e of (await query(
    `SELECT e.what_we_do, e.verdict, e.ran_at, e.what_happened, d.cannot_prove, ${GRADE_SQL} AS grade
       FROM venture_experiments e
       LEFT JOIN probe_designs d ON d.experiment_id = e.id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.verdict IS NOT NULL
        AND e.ran_at >= datetime('now', ?)`, [founderId, since])).rows as unknown as Array<Record<string, unknown>>) {
    const o = outcomeFromRow(e as OutcomeRow);
    learned.push(`the test "${String(e.what_we_do)}" settled ${o.word}: ${o.meaning.replace(/\.$/, '')}`
      + `; it establishes ${o.establishes ?? ''} It does not establish ${o.doesNotEstablish ?? ''}`
      + ' The next design is written against that');
  }
  for (const c of (await query(
    `SELECT claim, settled_as, settled_by FROM market_claims
      WHERE founder_id = ? AND evidence_mode = 'real' AND settled_at >= datetime('now', ?)`,
    [founderId, since])).rows as unknown as Array<Record<string, unknown>>) {
    outcomes.push(`"${String(c.claim)}" ${String(c.settled_as) === 'held' ? 'held' : 'did not hold'}, settled by ${String(c.settled_by)}`);
  }
  for (const b of (await query(
    `SELECT headline, verdict_why, revisit_if FROM venture_opportunities
      WHERE founder_id = ? AND evidence_mode = 'real' AND verdict = 'rejected'
        AND decided_at >= datetime('now', ?)`, [founderId, since]))
    .rows as unknown as Array<Record<string, unknown>>) {
    learned.push(`buried ${String(b.headline)}: ${String(b.verdict_why)}`
      + `${b.revisit_if ? `; worth another look if ${String(b.revisit_if)}` : ''}`);
  }
  // DESIGNED TESTS ONLY, for the reason given in the frontier count above.
  for (const e of (await query(
    `SELECT e.what_we_do FROM venture_experiments e
       JOIN probe_designs d ON d.experiment_id = e.id
      WHERE e.founder_id = ? AND e.evidence_mode = 'real' AND e.decision IS NULL`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>) {
    needsYou.push(`a test waiting for your go-ahead: ${String(e.what_we_do)}`);
  }

  return {
    since: new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10),
    happened, handled, changed, money: moneyLines, effects, outcomes, learned, needsYou,
  };
}
