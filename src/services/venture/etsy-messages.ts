// =============================================================================
// A BUYER ON ETSY: HEARD BY FOUNDRY, ANSWERED BY A PERSON.
//
// Etsy publishes no way for a program to read or send a shop's messages, and
// the listing promises "Questions are welcome through Etsy messages and are
// answered by a person". So Foundry does the two things it legitimately can:
//
//   1. HEAR. Etsy emails the owner when a buyer writes. Forwarded to the
//      Workshop's address, that email reaches the ordinary mail door, and is
//      recognised here before the Workshop's own correspondence can see it —
//      that machinery answers by email, and the address it would answer is
//      Etsy's notifier.
//
//   2. SUGGEST. Rules, not a model, pick which saved reply fits, and say which
//      of OUR words matched. Every saved reply quotes the listing, the how-to
//      or the owner's acts it rests on, and a test holds the quote to the text.
//      Nothing is composed from what a buyer wrote, so nothing a buyer writes
//      can put words in the owner's mouth.
//
// WHAT IS KEPT. The shop's privacy policy says its records hold "the order
// number and the amount, never your name or email". So a buyer's name,
// address, subject line and words are read here and dropped: what is stored is
// that somebody wrote, when, and the suggestion (migration 378).
//
// WHAT IS NOT DONE, BY CONSTRUCTION: nothing is sent, to Etsy or anyone. The
// owner reads the message on Etsy and replies there.
// =============================================================================

import { createHash } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import type { EdgeMessage } from '../public-workshop/edge-record.js';
import type { Heard } from '../public-workshop/mail.js';

type Row = Record<string, unknown>;

export type SavedReplyKey = 'refund' | 'download' | 'google_sheets' | 'opens_in'
  | 'not_for_that' | 'how_to_start' | 'thanks';

export interface SavedReply {
  key: SavedReplyKey;
  /** What it is called in Etsy's saved replies. */
  title: string;
  text: string;
  /** Said to the owner, not the buyer: what must be true before it is sent. */
  beforeSending: string | null;
  /** The published passage this reply restates. Held to the text by a test. */
  source: { doc: 'listing' | 'how_to' | 'owner_acts'; quote: string };
}

const SIGN = '— Thomas, Apex Micro';

/**
 * THE SAVED REPLIES, each one a restatement of something already promised.
 * Kept short enough to read on a phone and paste into Etsy's saved replies.
 */
export const SAVED_REPLIES: readonly SavedReply[] = [
  {
    key: 'refund', title: 'Refund',
    text: `Hi, I've refunded your order in full through Etsy. You don't need to explain or send anything back. Sorry it wasn't what you needed. ${SIGN}`,
    beforeSending: 'Refund the order in Etsy first (open the order, then Refund), then send this.',
    source: { doc: 'listing', quote: 'If it is no use to you, you can have your money back. Message me through Etsy or use the refunds page at apexmicro.ai/refunds. No form and no time limit.' },
  },
  {
    key: 'download', title: 'Can\'t find the file',
    text: `Hi, thank you for buying the Bid Decision Workbook. The Etsy app itself does not download files, so open etsy.com in a browser (Safari or Chrome), sign in, go to You → Purchases, find the workbook and tap Download Files. It is one .xlsx file. If it still doesn't come through, reply here and I'll sort it out. ${SIGN}`,
    beforeSending: null,
    source: { doc: 'owner_acts', quote: 'Open etsy.com in a browser (Safari or Chrome), sign in, go to You → Purchases, find the Bid Decision Workbook and tap Download Files. The Etsy app itself does not download files.' },
  },
  {
    key: 'google_sheets', title: 'Google Sheets',
    text: `Hi, yes, it works in Google Sheets. In Sheets, choose File → Import → Upload, pick the .xlsx file, then choose "Replace spreadsheet". The drop-downs, formulas and chart carry over, and nothing needs re-entering. ${SIGN}`,
    beforeSending: null,
    source: { doc: 'how_to', quote: 'File → Import → Upload → choose this file → "Replace spreadsheet". Drop-downs, formulas and the chart carry over. Nothing needs re-entering.' },
  },
  {
    key: 'opens_in', title: 'Will it open in my program?',
    text: `Hi, it is one .xlsx file. It opens in Excel 2010 or later, LibreOffice and Google Sheets. There are no macros, no add-ins and no account to make. If you use something else, tell me what and I'll say honestly whether it will work. ${SIGN}`,
    beforeSending: null,
    source: { doc: 'listing', quote: 'Opens in Excel 2010 or later, LibreOffice, and Google Sheets' },
  },
  {
    key: 'not_for_that', title: 'Does it do estimates or invoices?',
    text: `Hi, thanks for asking first. It is one workbook for one decision: whether a bid is worth your time. It does not price or estimate a job, write proposals or invoices, schedule work, or track costs on a job. If you need one of those, this isn't the right file. ${SIGN}`,
    beforeSending: null,
    source: { doc: 'listing', quote: 'It does not price or estimate a job, write proposals or invoices, schedule work, or track costs on a job.' },
  },
  {
    key: 'how_to_start', title: 'How do I start?',
    text: `Hi, the Start-here sheet has a five-minute how-to. In short: on Settings, enter your bidding hourly rate, your monthly capacity and a starting guess at your win rate. On Bids, delete the grey example rows and add your own bids, one per row. The Signal column is a signal, not an instruction. Read Summary once a month. ${SIGN}`,
    beforeSending: null,
    source: { doc: 'how_to', quote: 'Enter your bidding hourly rate' },
  },
  {
    key: 'thanks', title: 'Thank you',
    text: `Hi, thank you, that's kind of you to say. If anything in the workbook doesn't work the way you expect, reply here and I'll help. ${SIGN}`,
    beforeSending: null,
    source: { doc: 'listing', quote: 'Questions are welcome through Etsy messages and are answered by a person.' },
  },
];

export const savedReply = (key: string | null): SavedReply | null =>
  SAVED_REPLIES.find((s) => s.key === key) ?? null;

// ─── Recognising Etsy ────────────────────────────────────────────────────────

const ETSY_ADDRESS = /@(?:[a-z0-9-]+\.)*etsy\.com$/i;
/** A forwarded block names its original sender on a `From:` line of its own. */
const FORWARDED_FROM_ETSY = /^[ \t>]*From:[^\n]*@(?:[a-z0-9-]+\.)*etsy\.com\b/im;

/**
 * WHETHER THIS IS ETSY'S MAIL. An etsy.com sender (an automatic forward keeps
 * the original From), or a hand-forwarded email whose own From line is
 * Etsy's. A display name or a word in the body is not a sender.
 *
 * Not authentication, and it need not be: nothing here acts or sends, and the
 * owner reads the message itself on Etsy. A forged one costs him one look.
 */
export function isEtsyMail(from: string, body: string): boolean {
  return ETSY_ADDRESS.test(from.trim()) || FORWARDED_FROM_ETSY.test(body);
}

// ─── Reading, by rules ───────────────────────────────────────────────────────

/** Mail often arrives quoted-printable; `re=\nfund` is the word refund. */
function unquote(text: string): string {
  if (!/=\r?\n|=[0-9A-F]{2}/.test(text)) return text;
  return text.replace(/=\r?\n/g, '').replace(/(?:=[0-9A-F]{2})+/g, (m) => {
    try { return Buffer.from(m.replace(/=/g, ''), 'hex').toString('utf8'); } catch { return m; }
  });
}

/**
 * ETSY'S OWN WORDS ARE NOT THE BUYER'S. A footer that says "Download the Etsy
 * app" must not be read as a buyer who cannot find their download. Lines that
 * belong to the envelope, the forward, or Etsy's furniture are set aside
 * before any rule looks. The real template has not been seen here; a wrong
 * reading is visible because the grounds are shown.
 */
const NOT_THE_BUYER = /etsy app|etsy, inc|unsubscribe|privacy|help cent|notification|reply on etsy|view (the )?(message|conversation)|sent you a message|forwarded message|^\s*>?\s*(from|to|subject|date|sent|cc):/i;

const SECURITY = /\b(sign[- ]?in|security|verification|confirmation|login) code\b|\bpassword\b|two-factor|\b2fa\b|verify your|confirm your email|new sign[- ]?in/i;
const A_MESSAGE = /\bmessage\b|\bconvo\b|conversation|sent you/i;

const RULES: ReadonlyArray<{ key: SavedReplyKey; needles: string[] }> = [
  { key: 'refund', needles: ['refund', 'money back', 'chargeback', 'cancel my order', 'cancel the order', 'return it'] },
  { key: 'download', needles: ["can't find", 'cannot find', "can't download", 'cannot download', "didn't get", 'did not get',
    'never received', "haven't received", 'not received', 'where is the file', 'no file', 'download'] },
  { key: 'google_sheets', needles: ['google sheets', 'google sheet', 'google drive'] },
  { key: 'opens_in', needles: ["won't open", "can't open", 'cannot open', 'excel', 'numbers', 'libreoffice', 'mac',
    'compatible', 'macros', 'open it', 'open the file'] },
  { key: 'not_for_that', needles: ['estimate', 'estimates', 'estimating', 'invoice', 'invoices', 'proposal', 'proposals',
    'schedule', 'scheduling', 'job cost', 'job costs', 'quote a job'] },
  { key: 'how_to_start', needles: ['how do i', 'how to use', 'instructions', 'get started', 'set it up', 'set up'] },
  { key: 'thanks', needles: ['thank you', 'thanks', 'love it', 'works great', 'really useful', 'very useful'] },
];

export interface EtsyReading {
  kind: 'buyer_message' | 'not_a_buyer';
  suggested: SavedReplyKey | null;
  /** In Foundry's words: the needle that matched, or why nothing did. */
  because: string;
}

/** What an Etsy email is, and which saved reply fits. Pure. */
export function readEtsyMail(subject: string, body: string): EtsyReading {
  const all = unquote(`${subject}\n${body}`).replace(/[’‘]/g, "'");
  if (SECURITY.test(all)) {
    return { kind: 'not_a_buyer', suggested: null, because: 'an Etsy account email, so nothing of it is kept' };
  }
  if (!A_MESSAGE.test(all)) {
    return { kind: 'not_a_buyer', suggested: null, because: 'an Etsy email that is not a buyer\'s message' };
  }
  const theirs = unquote(body).replace(/[’‘]/g, "'").split(/\r?\n/)
    .filter((line) => !NOT_THE_BUYER.test(line)).join('\n').toLowerCase();
  for (const rule of RULES) {
    // Whole words only, so "mac" is not "machine" and "excel" not "excellent".
    const hit = rule.needles.find((n) => new RegExp(`(^|[^a-z'])${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^a-z'])`).test(theirs));
    if (hit) return { kind: 'buyer_message', suggested: rule.key, because: `they wrote “${hit}”` };
  }
  return { kind: 'buyer_message', suggested: null, because: 'no rule recognised it, so read it on Etsy and choose' };
}

// ─── Hearing ─────────────────────────────────────────────────────────────────

const hashOf = (rfc: string): string => createHash('sha256').update(rfc.trim()).digest('hex');

/** Whether this email was already heard: the replay's cheap question. */
export async function heardFromEtsyAlready(founderId: string, rfcMessageId: string): Promise<boolean> {
  return ((await query('SELECT 1 FROM etsy_mail_heard WHERE founder_id = ? AND rfc_hash = ?',
    [founderId, hashOf(rfcMessageId)])).rows.length) > 0;
}

/**
 * Keep that Etsy wrote, and nothing it said. The same email twice is one
 * record, by the hash of its own Message-ID.
 */
export async function hearEtsyMail(founderId: string, m: EdgeMessage): Promise<Heard> {
  const rfcHash = hashOf(m.rfcMessageId);
  const reading = readEtsyMail(m.subject ?? '', m.body);
  const id = `etsy_${nanoid()}`;
  const inserted = await query(
    `INSERT INTO etsy_mail_heard (id, founder_id, rfc_hash, kind, suggested_reply, because)
     VALUES (?,?,?,?,?,?) ON CONFLICT (founder_id, rfc_hash) DO NOTHING`,
    [id, founderId, rfcHash, reading.kind, reading.suggested, reading.because]);
  const duplicate = Number(inserted.rowsAffected ?? 0) === 0;
  const row = (await query('SELECT id, kind FROM etsy_mail_heard WHERE founder_id = ? AND rfc_hash = ?',
    [founderId, rfcHash])).rows[0] as Row;
  const buyer = String(row.kind) === 'buyer_message';
  return {
    id: String(row.id), duplicate, threadKey: `etsy:${rfcHash.slice(0, 16)}`, reading: 'unknown',
    handling: buyer ? 'needs_owner' : 'no_action', from: 'etsy', experimentId: null,
    did: duplicate ? [] : [buyer ? 'kept that a buyer wrote on Etsy, and which reply fits' : 'kept that Etsy wrote, and nothing it said'],
  };
}

// ─── What the owner reads, and says ──────────────────────────────────────────

export interface BuyerWaiting {
  id: string; heardAt: string; suggested: SavedReply | null; because: string;
}

/** Buyers who wrote and whom the owner has not said he answered, oldest first. */
export async function buyersWaiting(founderId: string): Promise<BuyerWaiting[]> {
  const rows = (await query(
    `SELECT id, heard_at, suggested_reply, because FROM etsy_mail_heard
      WHERE founder_id = ? AND kind = 'buyer_message' AND answered_at IS NULL
      ORDER BY heard_at, rowid`, [founderId])).rows as unknown as Row[];
  return rows.map((r) => ({
    id: String(r.id), heardAt: String(r.heard_at),
    suggested: savedReply(r.suggested_reply == null ? null : String(r.suggested_reply)),
    because: String(r.because),
  }));
}

/** The owner says he answered it on Etsy. His word; Foundry cannot see Etsy's side. */
export async function markAnswered(founderId: string, id: string): Promise<boolean> {
  const r = await query(
    `UPDATE etsy_mail_heard SET answered_at = datetime('now')
      WHERE id = ? AND founder_id = ? AND kind = 'buyer_message' AND answered_at IS NULL`, [id, founderId]);
  return Number(r.rowsAffected ?? 0) > 0;
}
