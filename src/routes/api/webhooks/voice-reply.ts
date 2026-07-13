// =============================================================================
// FOUNDRY — Voice Reply Webhook
// POST /webhooks/voice-reply — for mobile app integration.
// Validates API key, transcribes voice note, routes to appropriate system.
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

  // Process the voice reply
  try {
    const result = await processVoiceReply(body.product_id, {
      audio_base64: body.audio_base64,
      mime_type: body.mime_type,
      context: body.context ?? '',
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
