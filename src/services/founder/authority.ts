// =============================================================================
// HOW MUCH I DO ON MY OWN — READ, NEVER STORED.
//
// The owner asked for a dial: to look at a company and set the autopilot as
// heavy or as light as he wants. Foundry already has every primitive the dial
// could move — boundaries (never / ask first) on named subjects, one live
// allowance, responsibility-bound consents, delegations with a ceiling. What it
// did not have was one place that reads them back as ONE SETTING and lets him
// move it.
//
// So the setting is DERIVED, every time, from the rows that actually govern
// what the institution may do. There is no `autopilot_level` column, because a
// stored level and the rows it summarises would drift, and the day they
// disagreed the institution would act on one and show him the other. What he
// sees is what the gates read.
//
// Moving lighter composes the existing narrowing writes: a boundary set, an
// allowance withdrawn, a consent or delegation revoked — each a row with his
// reason on it. Moving heavier is never one tap: every widening is the explicit
// act it already was (a sentence through the door he confirms, a grant from the
// responsibility it belongs to), because "carry" is not a mode, it is a list of
// things he allowed, one at a time.
//
// And the thirty-day line is honest: when no act has been proposed here, no
// setting would have changed what happened, and it says so rather than
// projecting a number from nothing.
// =============================================================================
import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';
import {
  allowanceFor, boundariesFor, everySubject, type BoundaryMode, type LiveAllowance,
} from '../institution/standing-intent.js';

export type Setting = 'watch' | 'propose' | 'carry' | 'mixed';

export interface Door {
  subject: string; ownerWords: string;
  /** Which gate honours this subject, when one exists. Null: honoured as a refusal only. */
  door: string | null;
  mode: BoundaryMode | 'open';
  boundaryId: string | null; statement: string | null; everywhere: boolean;
}

export interface StandingGrant {
  kind: 'consent' | 'delegation'; id: string; what: string; until: string | null;
}

export interface Last30 {
  proposed: number; approved: number; refused: number;
  pendingOutbound: number; refusedForAuthority: number;
  thoughtCents: number; moneyCents: number;
}

export interface Move {
  to: 'watch' | 'propose';
  /** The exact sentences that will be written, in the order they will be. */
  would: string[];
}

export interface AuthorityReading {
  productId: string; name: string;
  setting: Setting; sentence: string;
  doors: Door[]; allowance: LiveAllowance | null; grants: StandingGrant[];
  last30: Last30;
  /** What each setting would have meant over the last thirty days, honestly. */
  projections: Array<{ setting: Exclude<Setting, 'mixed'>; label: string; sentence: string; current: boolean }>;
  lighter: Move[];
  /** Heavier moves are sentences he confirms one at a time, through the door. */
  heavier: Array<{ label: string; said: string; editable: boolean }>;
  fingerprint: string;
}

export const LABEL: Record<Setting, string> = {
  watch: 'Watch', propose: 'Propose', carry: 'Carry within limits', mixed: 'Some of each',
};

async function count(sql: string, params: unknown[]): Promise<number> {
  const r = (await query(sql, params)).rows[0] as Record<string, unknown> | undefined;
  return Number(r?.n ?? 0);
}

function dollars(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/**
 * THE SENTENCE THAT, SAID THROUGH THE DOOR, SETS THIS SUBJECT TO THIS MODE.
 * Built from words `interpret` reads back to the same subject — "spend your
 * money", the subject's own owner-words, is not one the reader knows, so the
 * heavier moves (which go through the door) would have come back "unclear".
 * The test holds every sentence here to the reader.
 */
const READABLE: Record<string, string> = { spend_money: 'spend money' };
export function sentenceFor(mode: BoundaryMode, door: Pick<Door, 'subject' | 'ownerWords'>, name: string): string {
  const words = READABLE[door.subject] ?? door.ownerWords;
  return mode === 'never'
    ? `Never ${words} for ${name}.`
    : `Ask me first before you ${words} for ${name}.`;
}

export async function authorityOf(founderId: string, productId: string): Promise<AuthorityReading | null> {
  const p = (await query(
    'SELECT id, name FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL',
    [productId, founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!p) return null;
  const name = String(p.name);

  const [subjects, live, allowance] = await Promise.all([
    everySubject(), boundariesFor(productId), allowanceFor(productId),
  ]);
  const doors: Door[] = subjects.map((s) => {
    // A company's own boundary outranks a global one on the same subject only
    // in the sense that both are in force; the stricter reading is the truth.
    const mine = live.filter((b) => b.subject === s.subject);
    const strictest = mine.find((b) => b.mode === 'never') ?? mine[0] ?? null;
    return {
      subject: s.subject, ownerWords: s.ownerWords, door: s.door,
      mode: strictest ? strictest.mode : 'open',
      boundaryId: strictest?.id ?? null, statement: strictest?.statement ?? null,
      everywhere: strictest?.everywhere ?? false,
    };
  });

  const consents = (await query(
    `SELECT id, capability, accepted_at FROM autonomy_consents
      WHERE product_id = ? AND to_mode = 'act' AND revoked_at IS NULL
        AND (expires_at IS NULL OR datetime(expires_at) > datetime('now')) ORDER BY accepted_at DESC`,
    [productId])).rows as unknown as Array<Record<string, unknown>>;
  const delegations = (await query(
    `SELECT d.id, d.purpose, d.ceiling, d.expires_at, a.display_name AS actor
       FROM delegations d JOIN business_actors a ON a.id = d.actor_id
      WHERE d.product_id = ? AND d.founder_id = ? AND d.revoked_at IS NULL
        AND (d.expires_at IS NULL OR datetime(d.expires_at) > datetime('now')) ORDER BY d.granted_at DESC`,
    [productId, founderId])).rows as unknown as Array<Record<string, unknown>>;
  const grants: StandingGrant[] = [
    ...consents.map((c) => ({ kind: 'consent' as const, id: String(c.id),
      what: `act on ${String(c.capability).replaceAll('_', ' ')} without asking each time`, until: null })),
    ...delegations.map((d) => ({ kind: 'delegation' as const, id: String(d.id),
      what: `${String(d.actor)} may ${String(d.purpose)}, up to ${String(d.ceiling).replaceAll('_', ' ')} consequence`,
      until: d.expires_at ? String(d.expires_at).slice(0, 10) : null })),
  ];

  const gated = doors.filter((d) => d.door !== null);
  const carries = (allowance !== null && allowance.remainingCents > 0) || grants.length > 0;
  const anyNever = gated.some((d) => d.mode === 'never');
  // WATCH is not "every door shut"; it is "nothing lets me act and nothing
  // asks me to ask". A door nobody has spoken about is open in name only:
  // with no allowance behind it the institution cannot go through, and with
  // no ask-first on it the institution does not raise proposals. Saying
  // "propose" for a company he has never spoken to would be a promise.
  const setting: Setting = !carries
    ? (gated.some((d) => d.mode === 'ask_first') ? 'propose' : 'watch')
    : (anyNever ? 'mixed' : 'carry');

  const last30: Last30 = {
    proposed: await count(`SELECT COUNT(*) AS n FROM proposed_acts WHERE product_id = ?
      AND proposed_at >= datetime('now','-30 day')`, [productId]),
    approved: await count(`SELECT COUNT(*) AS n FROM proposed_acts WHERE product_id = ?
      AND decision = 'approved' AND proposed_at >= datetime('now','-30 day')`, [productId]),
    refused: await count(`SELECT COUNT(*) AS n FROM proposed_acts WHERE product_id = ?
      AND decision = 'refused' AND proposed_at >= datetime('now','-30 day')`, [productId]),
    pendingOutbound: await count(`SELECT COUNT(*) AS n FROM outbound_actions WHERE product_id = ?
      AND status = 'pending_approval'`, [productId]),
    refusedForAuthority: await count(`SELECT COUNT(*) AS n FROM responsibility_signals WHERE product_id = ?
      AND kind = 'refused_for_authority' AND noted_at >= datetime('now','-30 day')`, [productId]),
    thoughtCents: await (await import('../ai/spend-ledger.js')).spentThinkingAbout(productId, 30),
    moneyCents: Math.round(Number(((await query(
      `SELECT COALESCE(SUM(amount_cents),0) AS cents FROM asset_money_spent WHERE product_id = ?
        AND recorded_at >= datetime('now','-30 day')`, [productId])).rows[0] as Record<string, unknown>).cents)),
  };

  const openDoors = gated.filter((d) => d.mode === 'open');
  const askDoors = gated.filter((d) => d.mode === 'ask_first');
  const neverDoors = gated.filter((d) => d.mode === 'never');
  const list = (ds: Door[]): string => ds.map((d) => d.ownerWords).join(' or ');

  const sentence = setting === 'watch'
    ? `I watch ${name} and tell you what I see. ${neverDoors.length ? `I never ${list(neverDoors)} here. ` : ''}${
      openDoors.length ? `Nothing is allowed behind the ${openDoors.length === 1 ? 'door' : 'doors'} to ${list(openDoors)}, so I cannot go through on my own, and I will not ask to unless you tell me to ask first.` : ''}`.trim()
    : setting === 'propose'
      ? `I watch ${name} and tell you what I see. ${askDoors.length ? `Before I ${list(askDoors)}, I ask; each act needs your yes. ` : ''}${
        openDoors.length ? `Nothing is allowed behind the ${openDoors.length === 1 ? 'door' : 'doors'} to ${list(openDoors)}, so I cannot go through ${openDoors.length === 1 ? 'it' : 'them'} on my own. ` : ''}${
        neverDoors.length ? `I never ${list(neverDoors)} here.` : ''}`.trim()
      : setting === 'carry'
        ? `I carry what you allowed for ${name}, within its limits, and tell you what I did${
          allowance ? `: up to ${dollars(allowance.amountCents)}, ${dollars(allowance.remainingCents)} of it left` : ''}${
          grants.length ? `; ${String(grants.length)} standing ${grants.length === 1 ? 'grant' : 'grants'}` : ''}. ${
          askDoors.length ? `Before I ${list(askDoors)}, I still ask.` : ''}`.trim()
        : `Some of each for ${name}: I never ${list(neverDoors)}, and I carry what you allowed elsewhere${
          allowance ? ` (${dollars(allowance.remainingCents)} of ${dollars(allowance.amountCents)} left)` : ''}${
          grants.length ? `, with ${String(grants.length)} standing ${grants.length === 1 ? 'grant' : 'grants'}` : ''}.`;

  // ── the honest thirty days ──────────────────────────────────────────────
  const nothingHappened = last30.proposed === 0 && last30.pendingOutbound === 0 && last30.refusedForAuthority === 0;
  const thought = last30.thoughtCents > 0 ? ` I spent ${dollars(last30.thoughtCents)} thinking about it, which no setting changes.` : '';
  const projections = (['watch', 'propose', 'carry'] as const).map((s) => ({
    setting: s, label: LABEL[s], current: s === setting,
    sentence: nothingHappened
      ? `No act has been proposed here in thirty days, so this would have changed nothing that happened.${thought}`
      : s === 'watch'
        ? `The ${String(last30.proposed)} ${last30.proposed === 1 ? 'act' : 'acts'} I proposed would not have been raised${
          last30.pendingOutbound ? `, and the ${String(last30.pendingOutbound)} waiting for you would not exist` : ''}.${thought}`
        : s === 'propose'
          ? `You would have been asked ${String(last30.proposed + last30.pendingOutbound)} ${last30.proposed + last30.pendingOutbound === 1 ? 'time' : 'times'}; you said yes to ${String(last30.approved)} and no to ${String(last30.refused)}.${
            last30.refusedForAuthority ? ` ${String(last30.refusedForAuthority)} more ${last30.refusedForAuthority === 1 ? 'was' : 'were'} refused for want of authority and would still have been.` : ''}${thought}`
          : `The ${String(last30.approved)} you approved would have gone without asking, within what you allowed${
            last30.moneyCents ? ` (${dollars(last30.moneyCents)} actually left)` : ''}; the ${String(last30.refused)} you refused would have gone too.${
            last30.refusedForAuthority ? ` ${String(last30.refusedForAuthority)} refused for want of authority would have needed a grant, not a setting.` : ''}${thought}`,
  }));

  // ── moves ───────────────────────────────────────────────────────────────
  const lighter: Move[] = [];
  const toWatch = [
    ...gated.filter((d) => d.mode !== 'never').map((d) => sentenceFor('never', d, name)),
    ...(allowance ? [`Take back the allowance of ${dollars(allowance.amountCents)}.`] : []),
    ...grants.map((g) => `Revoke: ${g.what}.`),
  ];
  if (toWatch.length) lighter.push({ to: 'watch', would: toWatch });
  if (setting === 'carry' || setting === 'mixed') {
    lighter.push({ to: 'propose', would: [
      ...openDoors.map((d) => sentenceFor('ask_first', d, name)),
      ...(allowance ? [`Take back the allowance of ${dollars(allowance.amountCents)}.`] : []),
      ...grants.map((g) => `Revoke: ${g.what}.`),
    ] });
  }
  const heavier = [
    ...neverDoors.map((d) => ({ label: `Let me ask before I ${d.ownerWords}`,
      said: sentenceFor('ask_first', d, name), editable: false })),
    ...(allowance ? [] : [{ label: 'Allow me to spend', said: `Spend up to $25 on what ${name} needs.`, editable: true }]),
  ];

  const fingerprint = createHash('sha256').update(JSON.stringify({
    setting, doors: doors.map((d) => [d.subject, d.mode, d.boundaryId]),
    allowance: allowance?.id ?? null, grants: grants.map((g) => g.id),
  })).digest('hex').slice(0, 24);

  return { productId, name, setting, sentence, doors, allowance, grants, last30, projections, lighter, heavier, fingerprint };
}

/**
 * MOVE LIGHTER, BY THE ROWS THAT GOVERN. Applies exactly the sentences the
 * preview showed — the caller has already checked the fingerprint — through
 * the writers that already exist. Returns what was written, for the record.
 */
export async function moveLighter(input: {
  founderId: string; productId: string; to: 'watch' | 'propose'; fingerprint: string;
}): Promise<{ applied: string[] } | { stale: true }> {
  const now = await authorityOf(input.founderId, input.productId);
  if (!now || now.fingerprint !== input.fingerprint) return { stale: true };
  const move = now.lighter.find((m) => m.to === input.to);
  if (!move) return { stale: true };
  const intent = await import('../institution/standing-intent.js');
  const applied: string[] = [];
  const because = `you set me to ${LABEL[input.to].toLowerCase()} on ${now.name}`;
  for (const d of now.doors.filter((x) => x.door !== null)) {
    const want: BoundaryMode | null = input.to === 'watch'
      ? (d.mode === 'never' ? null : 'never')
      : (d.mode === 'open' ? 'ask_first' : null);
    if (!want) continue;
    const statement = sentenceFor(want, d, now.name);
    await intent.setBoundary({ productId: input.productId, subject: d.subject, statement, mode: want });
    applied.push(statement);
  }
  if (now.allowance) {
    await intent.withdrawAllowance(now.allowance.id, because);
    applied.push(`Took back the allowance of ${dollars(now.allowance.amountCents)}.`);
  }
  for (const g of now.grants) {
    if (g.kind === 'consent') {
      const row = (await query('SELECT capability FROM autonomy_consents WHERE id = ?', [g.id])).rows[0] as Record<string, unknown> | undefined;
      if (row) {
        const { revokeConsent } = await import('../autopilot/consent.js');
        await revokeConsent(input.productId, String(row.capability));
      }
    } else {
      const { revokeDelegation } = await import('../institution/acting.js');
      await revokeDelegation(g.id, because);
    }
    applied.push(`Revoked: ${g.what}.`);
  }
  return { applied };
}
