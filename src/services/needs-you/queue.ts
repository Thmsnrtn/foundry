// =============================================================================
// FOUNDRY — Needs you: everything that waits on the owner, answered.
//
// The owner's directive (30 September 2026): one inbox of judgment, and every
// item in it answers six questions before it asks for a yes — what it is, why
// now, what yes does, the most it can cost, whether it can be undone, and what
// happens if he does nothing.
//
// ONE QUEUE, EXTENDED, NOT A SECOND ONE. `waitingOn` (founder/attention.ts)
// already assembles what waits on him from ten sources in consequence order,
// and Home and this page render it. This adds the two things it left out —
// mail only he can answer, and Missions whose limits he set have been crossed
// — and the six answers, derived from each item's kind and the consequence
// already computed for it. And it lets him say "not now" to what can wait:
// never to what a buyer is owed, never past a date the item itself carries.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { waitingOn, type AttentionItem } from '../founder/attention.js';

type Row = Record<string, unknown>;

export interface SixAnswers {
  what: string;
  whyNow: string;
  ifYes: string;
  mostItCanCost: string;
  undo: string;
  ifNothing: string;
}

export interface NeedsYouItem {
  /** `kind:id` — stable across visits, so "not now" can be remembered. */
  key: string;
  level: 'needs_you' | 'urgent';
  /** The attention item underneath, when there is one; its yes and no are the buttons. */
  item: AttentionItem | null;
  summary: string;
  companyName: string;
  href: string;
  answers: SixAnswers;
  /** Whether "not now" is allowed, and when it would lapse at the latest. */
  snoozable: boolean;
  snoozedUntil: string | null;
}

const EFFECT_COST: Record<NonNullable<AttentionItem['effect']>, string> = {
  internal: 'Nothing outside Foundry: only its own records change.',
  provider: 'A change at one of your providers.',
  account: 'A change in one of your accounts.',
  public: 'Something becomes public.',
  person: 'Something reaches a real person.',
};

/** The six answers for one item, from its kind and what it already says. Pure. */
export function answersFor(i: AttentionItem): SixAnswers {
  const expires = /Expires (\d{4}-\d{2}-\d{2})/.exec(i.detail)?.[1] ?? null;
  const cost = i.effect ? EFFECT_COST[i.effect] : null;
  switch (i.kind) {
    case 'act': return {
      what: i.summary, whyNow: `${i.companyName} needs your yes before I can do it${expires ? `; it expires ${expires}` : ''}.`,
      ifYes: `${i.yes.label}.`, mostItCanCost: cost ?? 'I cannot say more than the act itself says; that is a reason to open it.',
      undo: 'You can take the approval back until I use it.',
      ifNothing: expires ? `It lapses on ${expires} and I do not act.` : 'It waits, and I do not act.',
    };
    case 'advice': return {
      what: i.summary, whyNow: `I noticed a situation at ${i.companyName}.`,
      ifYes: 'I take it on as work. Anything that would act still comes to you first.',
      mostItCanCost: 'Nothing: agreeing starts nothing that acts.', undo: 'Yes: you can stop the work at any time.',
      ifNothing: 'It stays here, and nothing happens.',
    };
    case 'noticed': return {
      what: i.summary, whyNow: `Something at ${i.companyName} looks like it needs looking after.`,
      ifYes: 'I start watching it for you. Anything that would act still comes to you first.',
      mostItCanCost: 'Nothing: watching is not acting.', undo: 'Yes: you can hand it back at any time.',
      ifNothing: 'It stays here, and nothing happens.',
    };
    case 'experiment': if (i.id === 'forge-designs-waiting') {
      return {
        what: i.summary, whyNow: i.detail,
        ifYes: 'The next forge pass takes each up again against what is true now: it is sealed if nothing stands in the way, and stays here, with why, if something does.',
        mostItCanCost: 'A model call for each the attacker is asked about again; nothing reaches anybody until a design is sealed and let in.',
        undo: 'Taking them up again changes no design; retiring them cannot be undone, and their designs stay on record.',
        ifNothing: 'They wait. Each is taken up again on its own when what it was refused on changes, and is retired after its fourth refusal.',
      };
    } return {
      what: i.summary, whyNow: i.id === 'workshop' ? 'Something only you can supply is missing.' : 'A real test is ready, or needs something only you can do.',
      ifYes: i.open ? `You open it: ${i.open.label}.` : 'The test starts, inside its own limits.',
      mostItCanCost: i.id === 'workshop' ? 'Nothing by itself.' : 'Its authorised cost, and the people its design names — both on its page.',
      undo: 'You can stop it from its page; anything already sent stays sent.',
      ifNothing: 'It does not start, and I keep asking.',
    };
    case 'charter': return {
      what: i.summary, whyNow: 'The charter ends on its date.',
      ifYes: `${i.yes.label}: it continues as signed.`, mostItCanCost: 'No more than the charter already allows, for another term.',
      undo: 'Yes: you can withdraw the charter at any time.',
      ifNothing: 'It lapses, and every real test waits for you again.',
    };
    case 'obligation': return {
      what: i.summary, whyNow: 'Somebody is owed something.',
      ifYes: 'You open the test and see exactly what is owed.', mostItCanCost: 'A buyer’s trust, and possibly a refund.',
      undo: 'What is owed does not go away by waiting.', ifNothing: 'The buyer keeps waiting.',
    };
    default: return { what: i.summary, whyNow: i.detail, ifYes: `${i.yes.label}.`, mostItCanCost: cost ?? 'Not stated.', undo: 'Not stated.', ifNothing: 'It waits.' };
  }
}

/** Obligations to people, and the charter's last days, cannot be put off. */
const MAY_WAIT = (i: AttentionItem): boolean => i.kind !== 'obligation' && i.kind !== 'charter';

/**
 * EVERYTHING THAT NEEDS HIM, IN ONE LIST: the attention queue in its own
 * consequence order, then mail only he can answer, then Missions whose limits
 * were crossed. Items he said "not now" to are returned apart, until they lapse.
 */
export async function needsYou(founderId: string, now: Date = new Date()): Promise<{ items: NeedsYouItem[]; later: NeedsYouItem[] }> {
  const snoozes = new Map<string, string>();
  for (const s of (await query(
    `SELECT item_key, until FROM needs_you_snoozes WHERE founder_id = ? AND until > ? ORDER BY said_at, rowid`,
    [founderId, now.toISOString()])).rows as unknown as Row[]) snoozes.set(String(s.item_key), String(s.until));

  const all: NeedsYouItem[] = (await waitingOn(founderId)).map((i) => ({
    key: `${i.kind}:${i.id}`, level: i.kind === 'obligation' ? 'urgent' : 'needs_you', item: i,
    summary: i.summary, companyName: i.companyName, href: i.open?.href ?? i.href, answers: answersFor(i),
    snoozable: MAY_WAIT(i), snoozedUntil: null,
  }));

  // MAIL ONLY HE CAN ANSWER. It was a count on a door and nowhere in the queue.
  const { needsTheOwner } = await import('../public-workshop/mail.js');
  for (const m of await needsTheOwner(founderId)) {
    const who = m.fromName ?? m.from;
    const subject = m.subject ?? '(no subject)';
    all.push({
      key: `mail:${m.id}`, level: 'needs_you', item: null,
      summary: `${who} wrote: ${subject}`, companyName: 'The Workshop', href: `/foundry/inbox?show=needs`,
      answers: {
        what: `A message from ${who}: ${subject}`, whyNow: 'I read it and could not answer it on my own.',
        ifYes: 'You open it and answer, or tell me how.', mostItCanCost: 'Nothing by opening it.',
        undo: 'Opening it changes nothing.', ifNothing: 'They keep waiting for a reply.',
      },
      snoozable: true, snoozedUntil: null,
    });
  }

  // A BUYER WROTE ON ETSY. Heard from Etsy's own email, forwarded; read and
  // answered on Etsy, by him. Like anything a buyer is owed, it cannot be put
  // off (services/venture/etsy-messages.ts).
  const { buyersWaiting } = await import('../venture/etsy-messages.js');
  for (const b of await buyersWaiting(founderId)) {
    all.push({
      key: `etsy:${b.id}`, level: 'urgent', item: null,
      summary: b.suggested ? `A buyer wrote on Etsy. The "${b.suggested.title}" reply looks like it fits.` : 'A buyer wrote on Etsy.',
      companyName: 'Etsy shop', href: '/foundry/etsy-messages',
      answers: {
        what: 'A message from a buyer, on Etsy.', whyNow: `Etsy told you on ${b.heardAt.slice(0, 16).replace('T', ' ')} UTC, and they are waiting.`,
        ifYes: 'You read it on Etsy, reply there, and tell me it is answered.',
        mostItCanCost: 'Nothing by opening it. A refund is yours to give, in Etsy.',
        undo: 'A reply sent on Etsy stays sent.', ifNothing: 'The buyer keeps waiting.',
      },
      snoozable: false, snoozedUntil: null,
    });
  }

  // MISSIONS WHOSE LIMITS HE SET WERE CROSSED. Foundry watches the limit and
  // says so here; it never acts on it (services/mission/read.ts).
  const { missionsOf } = await import('../mission/read.js');
  for (const m of (await missionsOf(founderId, now)).filter((x) => x.tripped !== null)) {
    all.push({
      key: `mission:${m.key}`, level: m.terms?.interruptAt === 'urgent' ? 'urgent' : 'needs_you', item: null,
      summary: `${m.goal}: ${m.tripped === 'budget' ? 'over the budget you set' : 'past the end date you set'}`,
      companyName: m.company?.name ?? 'Your portfolio', href: `/foundry/missions/${encodeURIComponent(m.key)}`,
      answers: {
        what: m.goal, whyNow: m.statusDetail, ifYes: 'You open it, and stop it or give it more room.',
        mostItCanCost: 'Nothing from this: I do not act on your limit, I only bring it to you.',
        undo: 'Limits can be changed at any time.', ifNothing: 'It carries on inside your charter, and I keep showing it here.',
      },
      snoozable: true, snoozedUntil: null,
    });
  }

  const items: NeedsYouItem[] = [];
  const later: NeedsYouItem[] = [];
  for (const n of all) {
    const until = n.snoozable ? snoozes.get(n.key) ?? null : null;
    if (until) later.push({ ...n, snoozedUntil: until }); else items.push(n);
  }
  // URGENT FIRST, then the queue's own consequence order, which it already is.
  items.sort((a, b) => (a.level === b.level ? 0 : a.level === 'urgent' ? -1 : 1));
  return { items, later };
}

/** How many things need him right now. The one count every surface shows. */
export async function needsYouCount(founderId: string): Promise<number> {
  return (await needsYou(founderId)).items.length;
}

export class SnoozeRefused extends Error {}

/**
 * "NOT NOW." Until tomorrow at the latest, and never for what a buyer is owed
 * or the charter's last days. The item must be one that needs him now: a key
 * he made up snoozes nothing.
 */
export async function snooze(founderId: string, key: string, hours = 24, now: Date = new Date()): Promise<string> {
  const { items } = await needsYou(founderId, now);
  const it = items.find((i) => i.key === key);
  if (!it) throw new SnoozeRefused('That is not something waiting on you.');
  if (!it.snoozable) throw new SnoozeRefused(it.level === 'urgent' ? 'Somebody is owed this; it cannot be put off.' : 'This one has its own date and cannot be put off past it.');
  const until = new Date(now.getTime() + Math.min(Math.max(hours, 1), 72) * 3_600_000).toISOString();
  await query(`INSERT INTO needs_you_snoozes (id, founder_id, item_key, until) VALUES (?,?,?,?)`,
    [`ns_${nanoid(12)}`, founderId, key, until]);
  return until;
}
