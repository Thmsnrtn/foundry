// =============================================================================
// FOUNDRY — Founder-authored reply proposals, and the first governed support plan
//
// This is the deterministic, human baseline for support drafting: the founder
// writes the reply, Foundry carries it under exact authority. No model is
// involved, and none is implied. A future model-generated proposal must beat
// this baseline on a frozen contract before it earns its place.
//
// The chain and its boundaries, each one enforced rather than described:
//
//   message   != proposal    a customer writing is not a reply being authored
//   proposal  != consent     authoring is not permission
//   proposal  != plan        planning re-resolves authority from scratch
//   plan      != execution   planning sends nothing
//   execution != receipt     the gateway records what the provider said
//   receipt   != outcome     acceptance is not resolution
//
// The founder authors text and nothing else. Recipient, responsibility,
// capability, consent, scope, consequence and effect identity are all resolved
// server-side from the message and the channel that owns it — which is why the
// proposal payload is refused outright if it so much as mentions them.
// =============================================================================

import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';
import { planAssistedSupportEmail, ASSISTED_EMAIL_SCOPE } from './responsibility-assisted-email.js';

const MAX_REPLY = 8192;

export interface ReplyProposal {
  id: string; messageId: string; body: string; subject: string | null; authoredAt: string;
}

export type ProposalRefusal = 'message_invalid' | 'content_required' | 'content_too_large';
export type PlanRefusal =
  | 'proposal_invalid' | 'not_assisting' | 'no_authority' | 'already_planned';

/** Deterministic identity: the same founder proposing the same text for the
 * same message twice is one proposal, not two. */
function proposalId(productId: string, messageId: string, body: string): string {
  return 'prop_' + createHash('sha256')
    .update([productId, messageId, body].join('\n')).digest('hex').slice(0, 32);
}

/**
 * The founder writes a reply to one real customer message.
 *
 * This records a canonical event — the founder wrote this — and deliberately
 * derives NO reconstruction claim from it. What a founder proposes to tell a
 * customer is not a fact about the company, and treating it as one would let
 * drafting quietly rewrite company truth.
 */
export async function proposeSupportReply(input: {
  productId: string; founderId: string; messageId: string; body: string; subject?: string;
}): Promise<{ proposal: ReplyProposal; duplicate: boolean } | { refused: ProposalRefusal }> {
  const body = input.body?.trim();
  if (!body) return { refused: 'content_required' };
  if (body.length > MAX_REPLY) return { refused: 'content_too_large' };

  // The message, the tenant, and the founder are all resolved server-side. A
  // caller cannot author a reply into a company it does not own.
  const message = (await query(
    `SELECT m.id, m.subject FROM inbound_customer_messages m
       JOIN products p ON p.id=m.product_id
      WHERE m.id=? AND m.product_id=? AND p.owner_id=?`,
    [input.messageId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!message) return { refused: 'message_invalid' };

  const id = proposalId(input.productId, input.messageId, body);
  const existing = await findProposal(input.productId, id);
  if (existing) return { proposal: existing, duplicate: true };

  const subject = input.subject?.trim()
    || (message.subject == null ? 'Re: your message' : `Re: ${String(message.subject)}`);
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_reply_proposal','founder_authored_reply','low',?,?)`,
    [id, input.productId,
      JSON.stringify({ message_id: input.messageId, founder_id: input.founderId, body, subject }),
      'The founder wrote a reply for a customer message'],
  );
  return { proposal: (await findProposal(input.productId, id))!, duplicate: false };
}

async function findProposal(productId: string, id: string): Promise<ReplyProposal | null> {
  const row = (await query(
    `SELECT id,payload_json,created_at FROM signal_events
      WHERE id=? AND product_id=? AND source='founder_reply_proposal'`, [id, productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const payload = JSON.parse(String(row.payload_json)) as { message_id: string; body: string; subject?: string };
  return {
    id: String(row.id), messageId: payload.message_id, body: payload.body,
    subject: payload.subject ?? null, authoredAt: String(row.created_at),
  };
}

export async function getReplyProposalForMessage(
  productId: string, messageId: string,
): Promise<ReplyProposal | null> {
  const row = (await query(
    `SELECT id,payload_json,created_at FROM signal_events
      WHERE product_id=? AND source='founder_reply_proposal'
        AND json_extract(payload_json,'$.message_id')=?
      -- Ties break on INSERTION ORDER, not on id. The proposal id is a content
      -- hash, so ordering by it made "which words are current" depend on the
      -- hash whenever a founder wrote twice inside one second — the same defect
      -- getReconstructionClaims had with nanoid claim ids.
      ORDER BY created_at DESC, rowid DESC LIMIT 1`, [productId, messageId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!row) return null;
  const payload = JSON.parse(String(row.payload_json)) as { message_id: string; body: string; subject?: string };
  return {
    id: String(row.id), messageId: payload.message_id, body: payload.body,
    subject: payload.subject ?? null, authoredAt: String(row.created_at),
  };
}

/**
 * Turn a proposal into a bounded plan.
 *
 * Everything consequential is re-resolved here from canonical state: which
 * responsibility owns the message's channel, whether it is actually Assisting,
 * which consent is currently live for that exact responsibility and capability,
 * and who the reply may go to. The recipient is the message's own sender —
 * there is no parameter for it, so there is nothing to redirect.
 *
 * Planning sends nothing. `executeAssistedSupportEmail` revalidates all of it
 * again immediately before dispatch, which is what makes a revocation between
 * planning and sending stop the send.
 */
export async function planProposedReply(input: {
  productId: string; founderId: string; proposalId: string;
}): Promise<{ actionId: string; duplicate: boolean } | { refused: PlanRefusal }> {
  const proposal = await findProposal(input.productId, input.proposalId);
  if (!proposal) return { refused: 'proposal_invalid' };

  const owned = (await query(
    `SELECT m.id AS message_id, m.contact_email, m.responsibility_id, r.state, r.capability
       FROM inbound_customer_messages m
       JOIN institutional_responsibilities r ON r.id=m.responsibility_id
       JOIN products p ON p.id=m.product_id
      WHERE m.id=? AND m.product_id=? AND p.owner_id=?`,
    [proposal.messageId, input.productId, input.founderId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!owned) return { refused: 'proposal_invalid' };
  if (String(owned.state) !== 'assisting') return { refused: 'not_assisting' };

  // Exact, current, responsibility-bound authority — read now and read again at
  // dispatch. A grant that has expired or been withdrawn is simply absent.
  const consent = (await query(
    `SELECT id FROM autonomy_consents
      WHERE product_id=? AND responsibility_id=? AND capability=? AND to_mode='act'
        AND revoked_at IS NULL AND datetime(expires_at)>datetime('now')
        AND consequence_boundary='low'
        AND instr(allowed_scope_json,json_quote(?))>0
      ORDER BY accepted_at DESC LIMIT 1`,
    [input.productId, String(owned.responsibility_id), String(owned.capability), ASSISTED_EMAIL_SCOPE],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!consent) return { refused: 'no_authority' };

  // A live plan for this message already exists — converge on it rather than
  // queueing a second reply to one customer question.
  const live = await query(
    `SELECT id,authority_consent_id FROM outbound_actions
      WHERE product_id=? AND inbound_message_id=? AND status<>'cancelled'`,
    [input.productId, proposal.messageId],
  );
  if (live.rows.length) {
    const row = live.rows[0] as Record<string, unknown>;
    // If it is bound to the authority that is current, it IS the plan.
    if (String(row.authority_consent_id) === String(consent.id)) {
      return { actionId: String(row.id), duplicate: true };
    }
    // Otherwise it is stranded on a grant that no longer authorises anything.
    // It is cancelled and stays cancelled: its binding, and its effect
    // identity, do not migrate to the new grant. A new grant requires new
    // planning before anything can be sent.
    await query("UPDATE outbound_actions SET status='cancelled' WHERE id=?", [String(row.id)]);
  }

  // Stable effect identity: one reply to one customer message, however many
  // times planning is attempted.
  // Effect identity includes the consent, so a reply planned under a new grant
  // is a new effect. A stranded plan's identity is never reused.
  const effectId = 'eff_' + createHash('sha256')
    .update([input.productId, proposal.messageId, proposal.id, String(consent.id)].join('\n'))
    .digest('hex').slice(0, 32);

  const actionId = await planAssistedSupportEmail({
    productId: input.productId,
    responsibilityId: String(owned.responsibility_id),
    authorityConsentId: String(consent.id),
    effectId,
    to: String(owned.contact_email),
    subject: proposal.subject ?? 'Re: your message',
    html: proposal.body,
    rationale: 'A customer wrote in on this responsibility\'s channel and the founder authored this reply',
  });
  await query(
    'UPDATE outbound_actions SET inbound_message_id=?, reply_proposal_id=? WHERE id=?',
    [proposal.messageId, proposal.id, actionId],
  );
  return { actionId, duplicate: false };
}

export type SupportReplyState =
  'message_only' | 'proposed' | 'planned' | 'sent' | 'failed';

/** What the founder is looking at, as distinct states that must never collapse
 * into one another on screen. */
export async function getSupportReplyState(
  productId: string, messageId: string,
): Promise<{
  state: SupportReplyState; actionId: string | null; outcome: string | null;
  /** The proposal the plan is BOUND to, once one exists. Not the newest one. */
  proposalId: string | null;
}> {
  const action = (await query(
    `SELECT id,status,outcome_status,reply_proposal_id FROM outbound_actions
      WHERE product_id=? AND inbound_message_id=? AND status<>'cancelled'`, [productId, messageId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (action) {
    const status = String(action.status);
    return {
      state: status === 'executed' ? 'sent' : status === 'failed' ? 'failed' : 'planned',
      actionId: String(action.id),
      outcome: action.outcome_status == null ? null : String(action.outcome_status),
      proposalId: action.reply_proposal_id == null ? null : String(action.reply_proposal_id),
    };
  }
  const proposal = await getReplyProposalForMessage(productId, messageId);
  return {
    state: proposal ? 'proposed' : 'message_only', actionId: null, outcome: null,
    proposalId: proposal?.id ?? null,
  };
}

/** One authored proposal, by its own id. */
async function proposalById(productId: string, proposalId: string): Promise<ReplyProposal | null> {
  return findProposal(productId, proposalId);
}

/**
 * Messages a founder can actually act on, with the state of each.
 *
 * THE GAP THIS CLOSES. Three write routes existed — author a reply, plan it,
 * send it — and nothing rendered the messages, so there was no way to obtain a
 * message id to post to. The whole support vertical was reachable only from a
 * test. `getMessagesForResponsibility` and `getSupportReplyState` had no caller
 * outside their own module; this is their first production reader.
 *
 * Only responsibilities that have actually reached Shadowing or Assisting
 * appear. A message about work Foundry has not yet understood is not something
 * it can offer to help with, and showing it would imply otherwise.
 *
 * The customer's words are returned as TEXT. The surface escapes them at the
 * point of rendering — a message containing a script tag is a message
 * containing a script tag.
 */
export async function getMessagesAwaitingReply(
  productId: string, limit = 10,
): Promise<Array<{
  messageId: string; responsibilityId: string; responsibilityTitle: string;
  contactEmail: string; subject: string | null; body: string;
  receivedAt: string; state: SupportReplyState; actionId: string | null;
  proposal: string | null; canSend: boolean;
}>> {
  const rows = await query(
    `SELECT m.id, m.responsibility_id, m.contact_email, m.subject, m.body, m.source_observed_at,
            r.title, r.state AS responsibility_state
       FROM inbound_customer_messages m
       JOIN institutional_responsibilities r ON r.id=m.responsibility_id AND r.product_id=m.product_id
      WHERE m.product_id=? AND r.disposition='active'
        AND r.state IN ('shadowing','assisting')
      ORDER BY datetime(m.source_observed_at) DESC, m.id DESC LIMIT ?`,
    [productId, limit],
  );

  const out = [];
  for (const raw of rows.rows as unknown as Array<Record<string, unknown>>) {
    const messageId = String(raw.id);
    const state = await getSupportReplyState(productId, messageId);
    // THE WORDS SHOWN ARE THE WORDS THAT WILL GO. This asked for the newest
    // proposal for the message, which stops being the planned one the moment a
    // founder has second thoughts after asking Foundry to carry the first —
    // nothing refuses that, and nothing re-plans it. The founder then read
    // their new words above a Send button that would dispatch the old ones.
    // `reply_proposal_id` records exactly what the plan bound to and had never
    // been read.
    const proposal = state.proposalId
      ? await proposalById(productId, state.proposalId)
      : null;
    out.push({
      messageId,
      responsibilityId: String(raw.responsibility_id),
      responsibilityTitle: String(raw.title),
      contactEmail: String(raw.contact_email),
      subject: raw.subject == null ? null : String(raw.subject),
      body: String(raw.body),
      receivedAt: String(raw.source_observed_at),
      state: state.state,
      actionId: state.actionId,
      proposal: proposal?.body ?? null,
      // Sending needs Assisting AND a live grant; planning re-resolves both and
      // refuses when they are absent, so this only governs what is OFFERED.
      canSend: String(raw.responsibility_state) === 'assisting',
    });
  }
  return out;
}
