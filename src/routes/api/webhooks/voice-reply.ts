// =============================================================================
// FOUNDRY — Voice Reply Webhook
// POST /webhooks/voice-reply — for mobile app integration.
// Validates API key, transcribes voice note, routes to appropriate system.
//
// THREE DOORS REACHED THE SAME APPROVAL AND ONLY ONE OF THEM ASKED ANYTHING.
// The dashboard click path runs through `can_trigger_actions` middleware. The
// dashboard voice path asked nothing. This one — an API key, which is a
// different kind of principal altogether — asked nothing either: it checked
// that the key was live and scoped to the product, and then routed a voice
// note that could dispatch an outward effect. A key issued with `agents:read`
// could approve and send.
//
// A key acts AS THE PERSON WHO ISSUED IT, bounded by its scopes. Both halves
// matter and neither substitutes for the other: the scope says what this
// credential may do, and the issuer's current membership says whether that
// person may still do it at all. A founder removed from the team does not keep
// executing effects through a key they left behind.
// =============================================================================

import { Hono } from 'hono';
import { validateApiKey } from '../../../services/rbac/permissions.js';
import { processVoiceReply } from '../../../services/scp/briefing/voice-reply.js';

export const voiceReplyWebhook = new Hono();

voiceReplyWebhook.post('/webhooks/voice-reply', async (c) => {
  let body: {
    product_id: string;
    audio_base64: string;
    mime_type: string;
    context: string;
    briefing_date: string;
    action_execution_id?: string;
    api_key: string;
  };

  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON body' }, 400);
  }

  // Validate required fields
  if (!body.api_key) {
    return c.json({ error: 'api_key is required' }, 401);
  }
  if (!body.product_id) {
    return c.json({ error: 'product_id is required' }, 400);
  }
  if (!body.audio_base64 || !body.mime_type) {
    return c.json({ error: 'audio_base64 and mime_type are required' }, 400);
  }
  // Bounded input (security close-out 2026-07-13): audio flows into paid
  // transcription — cap at ~10MB base64 (≈7.5MB audio, plenty for a reply).
  if (body.audio_base64.length > 10_000_000) {
    return c.json({ error: 'Audio exceeds the 10MB limit' }, 413);
  }
  if (!/^audio\//.test(body.mime_type) || body.mime_type.length > 64) {
    return c.json({ error: 'mime_type must be an audio/* type' }, 400);
  }

  // Validate API key
  const keyResult = await validateApiKey(body.api_key).catch(() => null);
  if (!keyResult) {
    return c.json({ error: 'Invalid or revoked API key' }, 401);
  }

  // Ensure the key is scoped to the requested product
  if (keyResult.productId !== body.product_id) {
    return c.json({ error: 'API key is not authorized for this product' }, 403);
  }

  // Every branch of this route writes — a decision, a note, a question, or an
  // approved outward effect. A read scope buys none of them.
  // No wildcard: the key holds `agents:write` or it does not. See the note on
  // `requireScope` — nothing can issue a `'*'` scope, and a string that
  // silently means every scope is a fail-open default.
  if (!keyResult.scopes.includes('agents:write')) {
    return c.json({ error: 'This API key does not carry the agents:write scope' }, 403);
  }

  // The owner's decision is that a company Foundry is not currently acting for
  // is READ-ONLY. `/v1` asks this of every write; this door predates that
  // middleware and sits outside it, so it asks the same question itself rather
  // than depending on the one gate downstream that happens to cover approvals.
  const { companyMayBeChanged } = await import('../../../api/middleware/entitlement.js');
  const entitlement = await companyMayBeChanged(body.product_id);
  if (!entitlement.allowed) {
    return c.json({
      error: 'read_only',
      message: `Foundry is not currently acting for this company — ${entitlement.reason}.`,
    }, 403);
  }

  // Process the voice reply
  try {
    const result = await processVoiceReply(body.product_id, {
      // A key acts as its issuer. An empty `created_by` names nobody, and
      // nobody holds `can_trigger_actions` — so an approval through such a key
      // becomes a note rather than an effect. Absence must not read as consent.
      founder_id: keyResult.userId,
      audio_base64: body.audio_base64,
      mime_type: body.mime_type,
      context: body.context ?? '',
      // Names the action being approved. Absent, a voice approval approves
      // nothing rather than approving whichever action happens to be newest.
      action_execution_id: typeof body.action_execution_id === 'string'
        ? body.action_execution_id : undefined,
      briefing_date: body.briefing_date ?? new Date().toISOString().slice(0, 10),
    });

    return c.json({
      success: true,
      transcript: result.transcript,
      action_type: result.action_type,
      routed_to: result.routed_to,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Processing error';
    return c.json({ error: message }, 500);
  }
});
