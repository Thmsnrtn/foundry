// =============================================================================
// THE REPLY ROUTE PROVES ITSELF.
//
// Nineteen people were invited to answer an address that was not routed, and
// every check the institution had would have passed that morning: the rule
// existed, the program was deployed, the store had an id. None of them was
// the question. The question is whether a message sent to the advertised
// address arrives, and the only thing that answers it is one arriving.
//
// So the Workshop sends one to itself, carrying a nonce, through the same
// governed door and the same sender rule a real message meets — and then
// looks for it. What arrives is recognised before anything else touches it:
// it never becomes a conversation, never reaches the Inbox or the owner's
// attention, is never answered, never counted as outreach, never a business
// outcome, never a suppression. It is an instrument reading, and the only
// thing it changes is what the institution believes about its own path.
//
// WHAT IT PROVES DEPENDS ON WHERE IT CAME FROM, and this module never reduces
// that to a boolean. A message from the Workshop's own identity leaves the
// provider, resolves the domain's MX and crosses the routing rule, the edge
// program and the intake — real inbound infrastructure, genuinely exercised.
// It does not prove that mail from an arbitrary third-party sender is
// accepted. A message from a separately controlled mailbox proves that too.
// The owner's instruction is that the second may not be claimed on the
// strength of the first.
// =============================================================================

import { randomBytes } from 'node:crypto';
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import { invoke } from '../outbound/gateway.js';
import { publicWorkshopOf } from './settings.js';

type Row = Record<string, unknown>;

/** How long a probe has to arrive before its silence means something. */
export const PROBE_ARRIVES_WITHIN_MINUTES = 30;
/** How often one is sent. A diagnostic that runs hourly is a mailing list. */
export const PROBE_EVERY_HOURS = 24;
/** A hard ceiling, so a loop cannot turn a diagnostic into a campaign. */
export const PROBE_MOST_PER_DAY = 4;

/**
 * What the subject carries. Deliberately unmistakable to a person reading a
 * mailbox, and exactly matchable by a machine reading a subject line.
 */
export const PROBE_SUBJECT = (nonce: string): string => `[Foundry reply-route check ${nonce}]`;
const NONCE_IN_SUBJECT = /\[Foundry reply-route check ([A-Za-z0-9_-]{8,})\]/;

export type ProbeRoute = 'self' | 'external';
export type ReplyRouteGrade = 'proven_external' | 'proven_self' | 'sent_not_arrived' | 'never_sent';

export interface ReplyRouteEvidence {
  grade: ReplyRouteGrade;
  /** When the evidence was made, or null when there is none. */
  at: string | null;
  /** In the owner's words: what is known, and what it does not cover. */
  sentence: string;
  /** What this evidence does not establish, or null when it establishes it all. */
  doesNotCover: string | null;
}

/**
 * THE ADVERTISED REPLY ADDRESS: the one a stranger would answer to, which is
 * the Workshop's contact address and the From line of everything it sends.
 */
async function advertisedAddress(founderId: string): Promise<{ to: string; productId: string } | null> {
  const w = await publicWorkshopOf(founderId);
  return w?.contactEmail ? { to: w.contactEmail, productId: w.productId } : null;
}

/** Whether a probe may be sent now: not too recently, and not too often today. */
export async function probeIsDue(founderId: string, now = new Date()): Promise<boolean> {
  const recent = (await query(
    `SELECT COUNT(*) AS n FROM reply_route_probes
      WHERE founder_id = ? AND datetime(sent_at) > datetime(?)`,
    [founderId, new Date(now.getTime() - PROBE_EVERY_HOURS * 3_600_000).toISOString()]))
    .rows[0] as Row;
  if (Number(recent.n) > 0) return false;
  const today = (await query(
    `SELECT COUNT(*) AS n FROM reply_route_probes
      WHERE founder_id = ? AND date(sent_at) = date(?)`, [founderId, now.toISOString()]))
    .rows[0] as Row;
  return Number(today.n) < PROBE_MOST_PER_DAY;
}

/**
 * SEND ONE, THROUGH THE GOVERNED DOOR. Its own registered capability
 * (`workshop_reply_probe`), so it is separately auditable and separately
 * refusable, and it leaves a receipt like every other consequential effect.
 * It never goes through `planOffer`, which would put it in `outbound_actions`
 * and therefore into the counts of what the institution has written to people.
 */
export async function sendReplyProbe(
  founderId: string,
  opts: {
    now?: Date; route?: ProbeRoute;
    /**
     * Send although one is not due. For a proof that needs two attempts in one
     * second, and for nothing else: it is named `force` so that a caller
     * reaching for it in the institution's own code reads as what it is.
     */
    force?: boolean;
  } = {},
): Promise<{ sent: true; nonce: string; route: ProbeRoute } | { refused: string }> {
  const now = opts.now ?? new Date();
  const where = await advertisedAddress(founderId);
  if (!where) return { refused: 'there is no Workshop, so there is no address to check' };
  // THE BOUND IS AT THE ACT, NOT AT THE CALLER. `probeIsDue` is the cheap
  // reader the morning routine asks before bothering; asking it was the whole
  // of the bound, so anything that called this function directly — a loop, a
  // retry, a second caller added later — could send without limit to the
  // institution's own address. The rule belongs where the message leaves.
  if (!opts.force && !(await probeIsDue(founderId, now))) {
    return { refused: 'a check of this address has already been sent inside the interval one is allowed' };
  }
  // A SEPARATELY CONTROLLED MAILBOX, WHEN ONE IS CONFIGURED. Sending from
  // outside proves the one thing a self-addressed message cannot: that mail
  // from a sender who is not us is accepted.
  const route: ProbeRoute = opts.route ?? (process.env.WORKSHOP_PROBE_FROM ? 'external' : 'self');
  const nonce = randomBytes(9).toString('base64url');
  const id = `rrp_${nanoid(12)}`;

  await query(
    `INSERT INTO reply_route_probes (id, founder_id, nonce, route, advertised, sent_at)
     VALUES (?,?,?,?,?,?)`,
    [id, founderId, nonce, route, where.to, now.toISOString()]);

  // THE REGISTRY IS POPULATED BY IMPORTING THE HANDLER'S MODULE. The gateway
  // keeps a process-global registry and refuses a tool nobody registered,
  // which is right — and means a caller has to make sure the module is loaded,
  // as `correspondence.ts` and the executor already do.
  await import('../integration/resend.js');
  const r = await invoke({
    productId: where.productId, tool: 'workshop_reply_probe',
    action: 'check that a reply to the Workshop\'s address arrives',
    params: {
      to: where.to, subject: PROBE_SUBJECT(nonce),
      text: 'This is an automated check that replies to this address arrive. '
        + 'Nobody needs to read or answer it.\n',
    },
    dedupKey: `public:${founderId}:reply_probe:${nonce}`,
    surface: 'public_workshop', dataClass: 'general',
  });
  if (!r.ok) {
    await query(`UPDATE reply_route_probes SET refused = ? WHERE id = ?`,
      [`${r.phase}: ${r.reason}`, id]);
    return { refused: `${r.phase}: ${r.reason}` };
  }
  const ref = (r.result as Row | undefined)?.message_id;
  if (ref != null) await query(`UPDATE reply_route_probes SET provider_ref = ? WHERE id = ?`, [String(ref), id]);
  log.info('reply_probe.sent', { founderId, route });
  return { sent: true, nonce, route };
}

/**
 * IS THIS ARRIVING MESSAGE ONE OF OURS? Asked by `hearMail` before it stores
 * anything, so a probe never becomes a message the institution holds. Matching
 * is on the exact nonce in the subject and nothing else: a message that merely
 * looks like a diagnostic is somebody's mail, and is kept.
 */
export async function matchProbeArrival(
  founderId: string, subject: string | null | undefined, now = new Date(),
): Promise<{ matched: true; route: ProbeRoute } | { matched: false }> {
  const m = NONCE_IN_SUBJECT.exec(subject ?? '');
  if (!m) return { matched: false };
  const probe = (await query(
    `SELECT id, route, arrived_at FROM reply_route_probes WHERE founder_id = ? AND nonce = ?`,
    [founderId, m[1]])).rows[0] as Row | undefined;
  if (!probe) return { matched: false };
  if (probe.arrived_at == null) {
    await query(`UPDATE reply_route_probes SET arrived_at = ? WHERE id = ?`, [now.toISOString(), String(probe.id)]);
    log.info('reply_probe.arrived', { founderId, route: String(probe.route) });
  }
  return { matched: true, route: String(probe.route) as ProbeRoute };
}

/**
 * WHAT IS KNOWN ABOUT THE REPLY ROUTE, from evidence rather than from
 * configuration. The most recent probe that has arrived decides the grade; a
 * probe still inside its window says nothing yet and leaves the previous
 * answer standing; one that never arrived is a failure, not a silence.
 */
export async function replyRouteEvidence(founderId: string, now = new Date()): Promise<ReplyRouteEvidence> {
  const arrived = (await query(
    `SELECT route, arrived_at FROM reply_route_probes
      WHERE founder_id = ? AND arrived_at IS NOT NULL
      ORDER BY arrived_at DESC LIMIT 1`, [founderId])).rows[0] as Row | undefined;
  const last = (await query(
    `SELECT route, sent_at, arrived_at, refused FROM reply_route_probes
      WHERE founder_id = ? ORDER BY sent_at DESC LIMIT 1`, [founderId])).rows[0] as Row | undefined;

  if (!last) {
    return {
      grade: 'never_sent', at: null,
      sentence: 'Nothing has ever been sent to this address to find out whether a reply to it arrives.',
      doesNotCover: 'anything: the route is unproven, and a routing rule that exists is not a message that arrived.',
    };
  }
  // A PROBE THAT HAS NOT ARRIVED YET IS NOT A PROBE THAT FAILED. Inside its
  // window it says nothing, and whatever was known before still stands.
  const sentAt = new Date(String(last.sent_at).replace(' ', 'T') + (String(last.sent_at).endsWith('Z') ? '' : 'Z'));
  const stillWaiting = last.arrived_at == null && last.refused == null
    && now.getTime() - sentAt.getTime() < PROBE_ARRIVES_WITHIN_MINUTES * 60_000;

  if (arrived) {
    const at = String(arrived.arrived_at);
    if (String(arrived.route) === 'external') {
      return { grade: 'proven_external', at,
        sentence: `A message sent from outside this institution arrived at the advertised address on ${at.slice(0, 10)}.`,
        doesNotCover: null };
    }
    return { grade: 'proven_self', at,
      sentence: `A message the Workshop sent to its own advertised address arrived on ${at.slice(0, 10)}: it left the provider, found the domain, crossed the routing rule and the program that hears, and was kept.`,
      doesNotCover: 'that mail from a sender who is not us is accepted — only a message from outside can show that.' };
  }
  if (stillWaiting) {
    return { grade: 'never_sent', at: null,
      sentence: 'A check was sent and has not arrived yet; it is inside the time one is allowed.',
      doesNotCover: 'anything yet.' };
  }
  const refused = last.refused == null ? null : String(last.refused);
  return {
    grade: 'sent_not_arrived', at: String(last.sent_at),
    sentence: refused
      ? `The check of this address could not be sent: ${refused}.`
      : `A message was sent to the advertised address on ${String(last.sent_at).slice(0, 10)} and never arrived.`,
    doesNotCover: 'that anybody could reach this Workshop by replying to it.',
  };
}
