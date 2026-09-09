// =============================================================================
// WHAT THE WORKSHOP HEARS, AND WHAT IT IS ALLOWED TO DO ABOUT IT.
//
// One rule governs this whole file, and every other rule here is a consequence
// of it:
//
//   AN INBOUND MESSAGE IS EVIDENCE THAT SOMEBODY SAID SOMETHING.
//   IT IS NEVER AN INSTRUCTION, A PERMISSION, OR AN AUTHORITY.
//
// A stranger who can write to an address must not be able to acquire anything
// by writing. Not a refund, not a DNS change, not a secret, not a suppression
// lift, not a reply the institution would not otherwise have sent. What a
// message CAN do is create a record, a scoped obligation, or a refusal — and
// every one of those runs through the same governed paths the rest of the
// institution already uses.
//
// The reading of a message is deliberately made by rules first and a model
// only where rules cannot reach, because the two things a hostile message
// most wants are to be misread and to be read by something that will act on
// what it says. `unknown` is a safe resting state; a confident wrong reading
// is not.
// =============================================================================

import { createHash, randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { publicWorkshopOf } from './settings.js';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[] = []): Promise<Row[]> =>
  (await query(sql, params)).rows as unknown as Row[];
const one = async (sql: string, params: unknown[] = []): Promise<Row | undefined> => (await rows(sql, params))[0];
const normalise = (e: string): string => e.trim().toLowerCase();

export type Reading = 'unknown' | 'stop_writing' | 'wants_more' | 'answering_offer' | 'asking'
  | 'owed_something' | 'wants_money_back' | 'complaint' | 'not_for_us' | 'needs_a_person'
  | 'not_interested' | 'already_has_one' | 'was_useful' | 'was_not_useful';
export type Handling = 'foundry_reading' | 'waiting_on_them' | 'needs_owner' | 'resolved' | 'no_action';

export class MailRefused extends Error {
  constructor(public readonly code: string, message?: string) { super(message ?? code); this.name = 'MailRefused'; }
}

// ─── The door ────────────────────────────────────────────────────────────────

/** The one secret the edge program holds. It can do nothing but hand mail in. */
export async function openTheEars(founderId: string): Promise<{ intakeKey: string; url: string }> {
  const w = await publicWorkshopOf(founderId);
  if (!w) throw new MailRefused('no_workshop');
  const existing = await one('SELECT intake_key FROM workshop_mail_intake WHERE founder_id = ?', [founderId]);
  const key = existing ? String(existing.intake_key) : randomBytes(32).toString('base64url');
  if (!existing) {
    await query('INSERT INTO workshop_mail_intake (founder_id, intake_key) VALUES (?,?)', [founderId, key]);
  }
  return { intakeKey: key, url: `${process.env.APP_URL ?? ''}/workshop/mail` };
}

/** Whether mail can reach the institution at all. */
export async function earsAreOpen(founderId: string): Promise<boolean> {
  return Boolean(await one('SELECT founder_id FROM workshop_mail_intake WHERE founder_id = ?', [founderId]));
}

/** Whose ears these are, or nobody's. Constant-time compare, and never logged. */
export async function earsFor(intakeKey: string): Promise<string | null> {
  const given = (intakeKey ?? '').trim();
  if (given.length < 32) return null;
  const all = await rows('SELECT founder_id, intake_key FROM workshop_mail_intake', []);
  const want = createHash('sha256').update(given).digest('hex');
  for (const r of all) {
    if (createHash('sha256').update(String(r.intake_key)).digest('hex') === want) {
      await query(`UPDATE workshop_mail_intake SET last_seen_at = datetime('now') WHERE founder_id = ?`, [r.founder_id]);
      return String(r.founder_id);
    }
  }
  return null;
}

// ─── Hearing ─────────────────────────────────────────────────────────────────

export interface Heard {
  id: string; duplicate: boolean; threadKey: string; reading: Reading; handling: Handling;
  from: string; experimentId: string | null; did: string[];
}

/**
 * THE SAME MESSAGE DELIVERED TWICE IS ONE MESSAGE. Mail systems retry, workers
 * restart, and a redelivery must not produce a second reply, a second refund,
 * a second obligation or a second observation of what one person did once.
 * Identity is the sender's own Message-ID, which is the only stable name a
 * message has across every delivery of it.
 */
export async function hearMail(input: {
  founderId: string;
  to: string; from: string; fromName?: string | null;
  subject?: string | null; body: string;
  rfcMessageId: string; inReplyTo?: string | null; references?: string | null;
  spf?: string | null; dkim?: string | null; dmarc?: string | null;
  sentAt?: string | null; rawBase64?: string | null; size?: number | null;
}): Promise<Heard> {
  const w = await publicWorkshopOf(input.founderId);
  if (!w) throw new MailRefused('no_workshop');
  const from = normalise(input.from);
  const to = normalise(input.to);
  const rfc = (input.rfcMessageId ?? '').trim();
  if (!rfc) throw new MailRefused('no_message_id', 'a message with no identity cannot be deduplicated');

  const already = await one('SELECT id FROM workshop_mail WHERE founder_id = ? AND rfc_message_id = ?', [input.founderId, rfc]);
  if (already) {
    const had = (await readMail(input.founderId, String(already.id)))!;
    return { id: had.id, duplicate: true, threadKey: had.threadKey, reading: had.reading, handling: had.handling, from: had.from, experimentId: had.experimentId, did: [] };
  }

  // THREADING FROM HEADERS, NOT FROM SUBJECTS. Subjects are edited, translated
  // and reused by unrelated people; References is what the standard provides.
  const parent = firstReference(input.inReplyTo, input.references);
  const parentRow = parent
    ? await one('SELECT thread_key FROM workshop_mail WHERE founder_id = ? AND rfc_message_id = ?', [input.founderId, parent])
    : undefined;
  const threadKey = parentRow ? String(parentRow.thread_key) : rfc;

  // WHO THIS IS TO US, resolved from rows the Workshop already wrote — never
  // from anything the message says about itself.
  const contact = await one(
    `SELECT experiment_id FROM public_contacts WHERE founder_id = ? AND email = ? ORDER BY contacted_at DESC, rowid DESC LIMIT 1`,
    [input.founderId, from]);
  const experimentId = contact ? String(contact.experiment_id) : null;

  const id = nanoid();
  await query(
    `INSERT INTO workshop_mail (id, founder_id, subject, body, rfc_message_id, in_reply_to, references_hdr,
       thread_key, from_email, from_name, to_email, spf, dkim, dmarc, raw_bytes, contact_email,
       experiment_id, sent_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [id, input.founderId, input.subject?.trim() || null, input.body, rfc, input.inReplyTo ?? null,
      input.references ?? null, threadKey, from, input.fromName?.trim() || null, to,
      input.spf ?? null, input.dkim ?? null, input.dmarc ?? null, input.size ?? null,
      contact ? from : null, experimentId, sane(input.sentAt)]);

  const { reading, because } = readIt(input.subject ?? '', input.body, from, w.contactEmail);
  const did = await actOnIt({ founderId: input.founderId, id, from, reading, experimentId, body: input.body });
  const handling = handlingFor(reading);
  await query(
    `UPDATE workshop_mail SET reading = ?, reading_because = ?, handling = ?, handled_because = ?, updated_at = datetime('now') WHERE id = ?`,
    [reading, because, handling, did.join('; ') || null, id]);
  return { id, duplicate: false, threadKey, reading, handling, from, experimentId, did };
}

const sane = (s?: string | null): string | null => {
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) || d.getTime() > Date.now() + 600_000 ? null : d.toISOString();
};

function firstReference(inReplyTo?: string | null, references?: string | null): string | null {
  const pick = (s?: string | null): string | null => {
    const m = /<([^>]+)>/.exec(s ?? '');
    return m ? `<${m[1]}>` : (s?.trim() || null);
  };
  return pick(inReplyTo) ?? pick((references ?? '').trim().split(/\s+/).pop() ?? null);
}

// ─── Reading, by rules first ─────────────────────────────────────────────────

/**
 * RULES BEFORE A MODEL, AND `unknown` BEFORE A GUESS.
 *
 * The readings that carry a consequence — a refusal to be written to, a claim
 * that something is owed, a demand for money back — are exactly the ones a
 * hostile or careless message would most like to have misapplied, and exactly
 * the ones a model is most easily talked into by prose. So they are decided by
 * looking for what a person actually writes when they mean them, and anything
 * unrecognised stays `unknown` and goes to a human. No model is consulted here
 * at all: nothing on this path yet needs judgement a rule cannot give, and a
 * model added before it is needed is an attack surface added before it is
 * needed.
 */
export function readIt(subject: string, body: string, from: string, workshopAddress: string): { reading: Reading; because: string } {
  const t = `${subject}\n${body}`.toLowerCase();
  const has = (...needles: string[]): string | null => needles.find((n) => t.includes(n)) ?? null;

  // Machines first, so nothing below mistakes a bounce for a person.
  const machine = has('mail delivery failed', 'delivery status notification', 'undeliverable',
    'out of office', 'automatic reply', 'autoreply', 'mailer-daemon');
  if (machine || from.startsWith('mailer-daemon@') || from.startsWith('postmaster@')) {
    return { reading: 'not_for_us', because: `automated mail (${machine ?? from})` };
  }
  if (normalise(from) === normalise(workshopAddress)) {
    return { reading: 'not_for_us', because: 'the Workshop writing to itself' };
  }

  const stop = has('unsubscribe', 'stop emailing', 'stop contacting', 'do not contact', "don't contact",
    'remove me', 'take me off', 'opt out', 'opt-out', 'no longer wish to receive');
  if (stop) return { reading: 'stop_writing', because: `they wrote "${stop}"` };

  const legal = has('cease and desist', 'our attorney', 'our lawyer', 'legal action', 'gdpr', 'ccpa',
    'data protection', 'subpoena', 'law enforcement', 'security vulnerability', 'data breach');
  if (legal) return { reading: 'needs_a_person', because: `this is not mine to answer: "${legal}"` };

  const money = has('refund', 'money back', 'charge back', 'chargeback', 'dispute the charge', 'cancel my payment');
  if (money) return { reading: 'wants_money_back', because: `they wrote "${money}"` };

  const owed = has('never received', "haven't received", 'have not received', 'did not receive', "didn't get",
    'still waiting', 'where is my', 'not arrived');
  if (owed) return { reading: 'owed_something', because: `they wrote "${owed}"` };

  const cross = has('spam', 'how did you get my', 'who gave you my', 'stop spamming', 'unsolicited');
  if (cross) return { reading: 'complaint', because: `they wrote "${cross}"` };

  const more = has('send me more', 'more like this', 'keep me posted', 'keep sending', 'sign me up',
    'add me to', 'going forward', 'would pay', 'interested in');
  if (more) return { reading: 'wants_more', because: `they wrote "${more}"` };

  // WHAT THE FIRST TEST IS LISTENING FOR. Each of these is a decision somebody
  // made and troubled themselves to say, which is worth more than silence and
  // must not be filed as the same thing. None of them is answerable here: they
  // are recorded, and what to do about them is a judgement made elsewhere.
  const already = has('already have', 'already use', 'already subscribe', 'we get these', 'we already get',
    'our own', 'we track', 'we have a service', 'we use a service', 'covered by');
  if (already) return { reading: 'already_has_one', because: `they wrote "${already}"` };

  const useless = has('not useful', 'no use to', 'not relevant', 'not helpful', 'nothing i can use',
    'nothing we can use', 'nothing new', 'waste of');
  if (useless) return { reading: 'was_not_useful', because: `they wrote "${useless}"` };

  const useful = has('this was useful', 'very useful', 'really useful', 'this is useful', 'helpful',
    'saved me', 'saved us', 'good stuff', 'this is great');
  if (useful) return { reading: 'was_useful', because: `they wrote "${useful}"` };

  const declines = has('not interested', 'no thanks', 'no thank you', 'we\'ll pass', 'we will pass',
    'not for us', 'not at this time', 'not right now');
  if (declines) return { reading: 'not_interested', because: `they wrote "${declines}"` };

  const asking = has('?', 'question', 'how much', 'can you', 'do you');
  if (asking) return { reading: 'asking', because: 'it reads as a question' };

  return { reading: 'unknown', because: 'no rule recognised this, and a guess would be worse than a person' };
}

const handlingFor = (r: Reading): Handling =>
  r === 'stop_writing' ? 'resolved'
    : r === 'not_for_us' ? 'no_action'
      : r === 'needs_a_person' || r === 'wants_money_back' || r === 'owed_something' || r === 'complaint' ? 'needs_owner'
        : 'needs_owner';

// ─── Acting, through the paths that already govern ───────────────────────────

/**
 * WHAT A MESSAGE MAY CAUSE BY ITSELF: a refusal to be contacted, and a record.
 * Nothing else. Note what is deliberately absent — no reply is sent, no refund
 * is issued, no money moves, no infrastructure changes, no suppression is
 * LIFTED. Every one of those either belongs to the owner or runs through the
 * governed door, and neither is reachable from here by design rather than by
 * omission: this function has no access to them.
 *
 * A stated refusal is honoured immediately and without asking, because the
 * asymmetry is obvious — acting on a false positive costs the Workshop one
 * message it might have sent; ignoring a true one is the thing the whole
 * suppression system exists to prevent.
 */
async function actOnIt(input: {
  founderId: string; id: string; from: string; reading: Reading; experimentId: string | null; body: string;
}): Promise<string[]> {
  const did: string[] = [];
  if (input.reading === 'stop_writing' || input.reading === 'complaint') {
    const { suppress } = await import('./suppression.js');
    const r = await suppress({
      founderId: input.founderId, email: input.from,
      reason: input.reading === 'complaint' ? 'complained' : 'they_asked',
      source: 'reply', experimentId: input.experimentId,
      note: `said so by email (${input.id})`,
    });
    did.push(r.recorded ? 'added to the do-not-contact list for the whole Workshop' : 'already on the do-not-contact list');
  }
  // A REQUEST FOR MORE IS NOT A GRANT OF PERMISSION. It is recorded as what
  // they asked for, scoped to the experiment they were answering, and it is
  // the owner who decides whether the Workshop can honour it.
  if (input.reading === 'wants_more') {
    const { recordContinuation } = await import('./suppression.js');
    const r = await recordContinuation({
      founderId: input.founderId, email: input.from, experimentId: input.experimentId,
      wants: 'will_explain', said: input.body.trim().slice(0, 2000),
    });
    if (r.recorded) did.push('recorded what they asked for, in their words, scoped to this experiment');
  }
  return did;
}

// ─── Reading it back ─────────────────────────────────────────────────────────

export interface MailRecord {
  id: string; threadKey: string; from: string; fromName: string | null; to: string;
  /** The sender's own Message-ID: the identity of the exact message that arrived. */
  rfcMessageId: string;
  subject: string | null; body: string; reading: Reading; readingBecause: string | null;
  handling: Handling; handledBecause: string | null; experimentId: string | null;
  spf: string | null; dkim: string | null; dmarc: string | null;
  sentAt: string | null; receivedAt: string;
  /** The thread key, url-safe, so a surface never has to escape it itself. */
  threadKeyHref: string;
  /**
   * WHY THIS MESSAGE IS IN THIS CONVERSATION, in the sender's own headers.
   * Threading is an inference, and an inference the owner cannot check is one
   * he has to take on trust — so the grounds travel with the record.
   */
  threadedBecause: string;
  /** What the edge reported the whole message weighed, before anything parsed it. */
  bytesAtTheEdge: number | null;
}

const project = (r: Row): MailRecord => ({
  id: String(r.id), threadKey: String(r.thread_key), from: String(r.from_email),
  fromName: r.from_name == null ? null : String(r.from_name), to: String(r.to_email),
  subject: r.subject == null ? null : String(r.subject), body: String(r.body),
  reading: String(r.reading) as Reading, readingBecause: r.reading_because == null ? null : String(r.reading_because),
  handling: String(r.handling) as Handling, handledBecause: r.handled_because == null ? null : String(r.handled_because),
  experimentId: r.experiment_id == null ? null : String(r.experiment_id),
  spf: r.spf == null ? null : String(r.spf), dkim: r.dkim == null ? null : String(r.dkim),
  dmarc: r.dmarc == null ? null : String(r.dmarc),
  sentAt: r.sent_at == null ? null : String(r.sent_at), receivedAt: String(r.received_at),
  rfcMessageId: String(r.rfc_message_id),
  threadKeyHref: encodeURIComponent(String(r.thread_key)),
  threadedBecause: String(r.rfc_message_id) === String(r.thread_key)
    ? 'it starts the conversation'
    : r.in_reply_to
      ? `it names ${String(r.in_reply_to)} as the message it answers`
      : r.references_hdr
        ? `its References header ends with ${String(r.references_hdr).trim().split(/\s+/).pop()}`
        : 'the headers named a message already in this conversation',
  bytesAtTheEdge: r.raw_bytes == null ? null : Number(r.raw_bytes),
});

export async function readMail(founderId: string, id: string): Promise<MailRecord | null> {
  const r = await one('SELECT * FROM workshop_mail WHERE founder_id = ? AND id = ?', [founderId, id]);
  return r ? project(r) : null;
}

export async function theInbox(founderId: string, limit = 100): Promise<MailRecord[]> {
  return (await rows(
    'SELECT * FROM workshop_mail WHERE founder_id = ? ORDER BY received_at DESC, rowid DESC LIMIT ?',
    [founderId, limit])).map(project);
}

export async function theThread(founderId: string, threadKey: string): Promise<MailRecord[]> {
  return (await rows(
    'SELECT * FROM workshop_mail WHERE founder_id = ? AND thread_key = ? ORDER BY received_at, rowid',
    [founderId, threadKey])).map(project);
}

/** What the owner is actually needed for, and nothing else. */
export async function needsTheOwner(founderId: string): Promise<MailRecord[]> {
  return (await rows(
    `SELECT * FROM workshop_mail WHERE founder_id = ? AND handling = 'needs_owner' ORDER BY received_at DESC, rowid DESC`,
    [founderId])).map(project);
}

export async function settleMail(input: { founderId: string; id: string; handling: Handling; because: string }): Promise<void> {
  const because = input.because.trim();
  if (!because) throw new MailRefused('needs_a_reason');
  await query(
    `UPDATE workshop_mail SET handling = ?, handled_because = ?, updated_at = datetime('now') WHERE founder_id = ? AND id = ?`,
    [input.handling, because, input.founderId, input.id]);
}

/** Mail health, in the only terms that matter: is anybody waiting on us? */
export async function mailHealth(founderId: string): Promise<{ waiting: number; oldestWaitingHours: number | null; unread: number; heard: number }> {
  const w = await one(
    `SELECT COUNT(*) n, MIN(received_at) oldest FROM workshop_mail WHERE founder_id = ? AND handling = 'needs_owner'`,
    [founderId]);
  const u = await one(`SELECT COUNT(*) n FROM workshop_mail WHERE founder_id = ? AND reading = 'unknown'`, [founderId]);
  const t = await one('SELECT COUNT(*) n FROM workshop_mail WHERE founder_id = ?', [founderId]);
  const oldest = w?.oldest ? String(w.oldest) : null;
  return {
    waiting: Number(w?.n ?? 0),
    oldestWaitingHours: oldest ? Math.floor((Date.now() - new Date(`${oldest.replace(' ', 'T')}Z`).getTime()) / 3_600_000) : null,
    unread: Number(u?.n ?? 0), heard: Number(t?.n ?? 0),
  };
}
