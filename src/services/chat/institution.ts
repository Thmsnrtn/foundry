// =============================================================================
// FOUNDRY — Institution chat (Trust Plane phase 3 / Ledger + Honesty Laws)
//
// Not "chat with your data" — you talk to the INSTITUTION, and the institution
// remembers. Three properties no generic chat has:
//   1. Consequential utterances become LEDGER ARTIFACTS: state a decision or a
//      belief in conversation and it lands in the strategic log with its
//      premise monitored — conversation IS capture; the form-filling dies.
//   2. The interlocutor keeps score of itself: replies carry the trust
//      ledger's numbers for the category at hand.
//   3. It convenes the institution: pending decisions, expired beliefs, and
//      the Red Team's record are in its working context.
// One model call per utterance; captures are zod-validated; capture failures
// never eat the reply.
// =============================================================================

import { nanoid } from 'nanoid';
import { z } from 'zod';
import { query } from '../../db/client.js';
import { log } from '../../lib/logger.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { getMemoryDigest, getExpiredBeliefs, recordPremise, CHECKABLE_METRIC_KEYS } from '../memory/kernel.js';
import { getShadowStats } from '../autopilot/policy.js';

const responseSchema = z.object({
  reply: z.string(),
  capture: z.union([
    z.null(),
    z.object({
      kind: z.enum(['decision', 'belief']),
      title: z.string(),
      decision: z.string().optional(),
      rationale: z.string().optional(),
      premise: z.string().optional(),
      premise_metric: z.string().optional(),
      premise_comparator: z.enum(['<', '<=', '>', '>=']).optional(),
      premise_threshold: z.number().optional(),
    }),
  ]),
});

const SYSTEM_PROMPT = `You are Foundry — not an assistant, the founder's COMPANY speaking: its memory, its ledgers, its earned trust. Rules:
- Ground every claim in the CONTEXT provided. Never invent numbers. If the ledgers are thin, say so.
- Keep score of yourself: when advising in a category, cite the trust context if present ("in marketing I'm N-for-M on your record").
- CAPTURE consequential utterances. If the founder states a decision they're making ("we're raising prices", "I've decided to..."), capture kind='decision' with title + decision + any stated belief as premise. If they state a load-bearing BELIEF ("churn is fine", "our users won't pay more"), capture kind='belief' with title + premise. Questions, musings, and requests for analysis capture NOTHING (null).
- When a premise maps to one of these metrics ${JSON.stringify(CHECKABLE_METRIC_KEYS)}, include premise_metric + premise_comparator + premise_threshold — the condition that must KEEP holding for the belief to be true.
- Tell the founder what you captured, in one short sentence at the end of the reply.
- Respond ONLY with JSON: {"reply": string, "capture": null | {"kind","title","decision"?,"rationale"?,"premise"?,"premise_metric"?,"premise_comparator"?,"premise_threshold"?}}`;

export interface ChatTurn {
  threadId: string;
  reply: string;
  captured: { kind: 'decision' | 'belief'; decisionId: string; premiseRecorded: boolean } | null;
}

async function ensureThread(productId: string, founderId: string, threadId?: string): Promise<string> {
  if (threadId) {
    const r = await query(
      'SELECT id FROM conversation_threads WHERE id = ? AND product_id = ?', [threadId, productId]);
    if (r.rows.length > 0) return threadId;
  }
  const id = nanoid();
  await query(
    `INSERT INTO conversation_threads (id, product_id, founder_id, title, intent)
     VALUES (?, ?, ?, 'Talking to the company', 'general')`,
    [id, productId, founderId],
  );
  return id;
}

export async function handleUtterance(
  productId: string, founderId: string, text: string, threadId?: string,
): Promise<ChatTurn> {
  const tid = await ensureThread(productId, founderId, threadId);
  await query(
    `INSERT INTO conversation_messages (id, thread_id, role, content) VALUES (?, ?, 'user', ?)`,
    [nanoid(), tid, text],
  );

  // Jarvis fast path: "what needs me?" is answered from the VERIFIED fleet
  // ranking — deterministic, instant, zero AI cost, and every line already
  // passed the independent verifier. The model is for judgment; priorities
  // come from the ledger.
  if (/\b(what needs me|what should i do|what'?s next|priorit(y|ies)|top of my list)\b/i.test(text)) {
    const { composeFleetLetter } = await import('../letter/fleet.js');
    const { verifyFleetLetter } = await import('../letter/verifier.js');
    const { letter } = await verifyFleetLetter(await composeFleetLetter(founderId));
    const reply = letter.needsYou.length === 0
      ? 'Nothing needs you right now — across everything. Verified against the ledgers just now.'
      : `Across your ${letter.products.length > 1 ? `${letter.products.length} companies` : 'company'}, ranked:\n` +
        letter.needsYou.slice(0, 3).map((n, i) => (n.kind === 'decision'
          ? `${i + 1}. ${n.what} (${n.productName}, gate ${n.gate}) → /decisions/${n.decisionId}`
          // A responsibility has no gate and no decision page. Saying "gate
          // undefined → /decisions/undefined" would be the chat inventing a
          // shape for a thing that does not have one.
          : `${i + 1}. ${n.what} (${n.productName}, ${n.because.replaceAll('_', ' ')}) → /letter`)).join('\n') +
        '\nEach line verified against the ledger seconds ago.';
    await query(
      `INSERT INTO conversation_messages (id, thread_id, role, content) VALUES (?, ?, 'assistant', ?)`,
      [nanoid(), tid, reply],
    );
    return { threadId: tid, reply, captured: null };
  }

  // The institution's working context — all real, all cheap.
  const [digest, expired, shadow, pending, history] = await Promise.all([
    getMemoryDigest(productId),
    getExpiredBeliefs(productId),
    getShadowStats(productId),
    query(
      `SELECT what, gate, category, recommendation FROM decisions
       WHERE product_id = ? AND status = 'pending' ORDER BY gate DESC LIMIT 5`,
      [productId],
    ),
    query(
      `SELECT role, content FROM conversation_messages WHERE thread_id = ?
       ORDER BY created_at DESC LIMIT 8`,
      [tid],
    ),
  ]);

  const context = [
    `BELIEF LEDGER: ${digest.holding} holding, ${digest.falsified} falsified, ${digest.revisited} revisited.`,
    expired.length > 0
      ? `EXPIRED BELIEFS (contradicted by telemetry): ${expired.slice(0, 3).map((e) => `"${e.premise.premise}" (${e.premise.evidence})`).join('; ')}`
      : 'No expired beliefs.',
    shadow.length > 0
      ? `TRUST (shadow record): ${shadow.map((s) => `${s.category}: ${s.agreed}/${s.sampled} agreement`).join('; ')}`
      : 'Trust ledger still thin.',
    pending.rows.length > 0
      ? `PENDING DECISIONS: ${(pending.rows as Array<Record<string, unknown>>).map((d) => `[gate ${d.gate}] ${d.what}${d.recommendation ? ` (team recommends: ${d.recommendation})` : ''}`).join('; ')}`
      : 'No pending decisions.',
    `RECENT CONVERSATION: ${(history.rows as Array<Record<string, string>>).reverse().map((m) => `${m.role}: ${m.content.slice(0, 200)}`).join(' | ')}`,
  ].join('\n');

  const response = await callSonnet(SYSTEM_PROMPT, `CONTEXT:\n${context}\n\nFOUNDER SAYS: ${text}`, 1200, productId);
  const parsed = parseJSONResponse(response.content, responseSchema);

  // Apply the capture — best-effort; a capture failure never eats the reply.
  let captured: ChatTurn['captured'] = null;
  let captureFailed = false;
  if (parsed.capture) {
    try {
      const cap = parsed.capture;
      const decisionId = nanoid();
      await query(
        `INSERT INTO strategic_decisions_log
           (id, product_id, decision_title, decision_description, decision_rationale, made_by, status)
         VALUES (?, ?, ?, ?, ?, 'founder', 'active')`,
        [decisionId, productId,
         cap.kind === 'belief' ? `Belief: ${cap.title}` : cap.title,
         cap.decision ?? cap.premise ?? cap.title,
         cap.rationale ?? null],
      );
      let premiseRecorded = false;
      if (cap.premise) {
        await recordPremise({
          productId, decisionId, decisionSource: 'strategic',
          premise: cap.premise,
          metricKey: cap.premise_metric,
          comparator: cap.premise_comparator,
          threshold: cap.premise_threshold,
        });
        premiseRecorded = true;
      }
      captured = { kind: cap.kind, decisionId, premiseRecorded };
    } catch (err) {
      // THE REPLY ALREADY SAYS IT WAS RECORDED.
      //
      // The system prompt above instructs: "Tell the founder what you
      // captured, in one short sentence at the end of the reply" — and the
      // model writes that sentence before any of this runs. So a capture that
      // threw left the founder holding a message saying their decision had
      // been written to the ledger, with nothing anywhere contradicting it.
      // The page appends a small 📒 when `captured` is set; the absence of an
      // icon is not a retraction.
      //
      // Best-effort is the right posture for the WRITE — a ledger failure
      // should not eat the conversation. It is not the right posture for the
      // CLAIM.
      captureFailed = true;
      log.error('institution_chat.capture_failed', {
        productId, kind: parsed.capture.kind, error: (err as Error).message,
      });
    }
  }

  // The correction goes into the stored message too, not just the response, so
  // the thread a founder scrolls back through says the same thing they were
  // told at the time.
  const reply = captureFailed
    ? `${parsed.reply}\n\n(I could not write that to the decision ledger just now, so it is not recorded — please try again in a moment.)`
    : parsed.reply;

  await query(
    `INSERT INTO conversation_messages (id, thread_id, role, content, tokens_used) VALUES (?, ?, 'assistant', ?, ?)`,
    [nanoid(), tid, reply, response.usage.input_tokens + response.usage.output_tokens],
  );
  await query(
    `UPDATE conversation_threads SET message_count = message_count + 2, last_message_at = CURRENT_TIMESTAMP WHERE id = ?`,
    [tid],
  );

  return { threadId: tid, reply, captured };
}
