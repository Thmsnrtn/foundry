// =============================================================================
// FOUNDRY — Transcript Webhooks
// Receives call transcript payloads from Fathom and Fireflies.
// =============================================================================

import { Hono } from 'hono';
import { ingestTranscript, analyzeTranscript } from '../../../services/integrations/transcripts.js';
import { query } from '../../../db/client.js';

export const transcriptWebhooks = new Hono();

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function getProductIdForApiKey(apiKey: string): Promise<string | null> {
  const rows = await query(
    `SELECT product_id FROM api_keys WHERE key_hash = ? AND is_active = 1 LIMIT 1`,
    [apiKey],
  );
  if (!rows.rows.length) return null;
  return String((rows.rows[0] as Record<string, unknown>)['product_id']);
}

// ─── POST /webhooks/transcripts/fathom ────────────────────────────────────────

transcriptWebhooks.post('/webhooks/transcripts/fathom', async (c) => {
  const apiKey = c.req.header('x-api-key') ?? c.req.header('authorization')?.replace('Bearer ', '') ?? '';
  const productId = await getProductIdForApiKey(apiKey).catch(() => null);
  if (!productId) return c.json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Fathom webhook schema: { meeting_title, transcript, participants, date, duration_minutes }
  const transcriptText = String(body['transcript'] ?? '');
  if (!transcriptText) return c.json({ error: 'No transcript in payload' }, 400);

  const id = await ingestTranscript(productId, {
    source: 'fathom',
    call_type: 'customer',
    participant_emails: Array.isArray(body['participants'])
      ? (body['participants'] as string[]).join(', ')
      : undefined,
    duration_minutes: body['duration_minutes'] ? Number(body['duration_minutes']) : undefined,
    transcript_text: transcriptText,
    call_date: body['date']
      ? String(body['date']).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });

  // Analyze async — don't block webhook response
  analyzeTranscript(id).catch(() => {});

  return c.json({ ok: true, transcript_id: id });
});

// ─── POST /webhooks/transcripts/fireflies ─────────────────────────────────────

transcriptWebhooks.post('/webhooks/transcripts/fireflies', async (c) => {
  const apiKey = c.req.header('x-api-key') ?? c.req.header('authorization')?.replace('Bearer ', '') ?? '';
  const productId = await getProductIdForApiKey(apiKey).catch(() => null);
  if (!productId) return c.json({ error: 'Unauthorized' }, 401);

  let body: Record<string, unknown>;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ error: 'Invalid JSON' }, 400);
  }

  // Fireflies webhook schema: { meeting_id, title, transcript_text, attendees, date, duration }
  const transcriptText = String(body['transcript_text'] ?? body['transcript'] ?? '');
  if (!transcriptText) return c.json({ error: 'No transcript in payload' }, 400);

  const attendees = Array.isArray(body['attendees'])
    ? (body['attendees'] as Array<{ email?: string }>)
        .map(a => a?.email)
        .filter(Boolean)
        .join(', ')
    : undefined;

  const id = await ingestTranscript(productId, {
    source: 'fireflies',
    call_type: 'customer',
    participant_emails: attendees,
    duration_minutes: body['duration'] ? Math.round(Number(body['duration']) / 60) : undefined,
    transcript_text: transcriptText,
    call_date: body['date']
      ? String(body['date']).slice(0, 10)
      : new Date().toISOString().slice(0, 10),
  });

  analyzeTranscript(id).catch(() => {});

  return c.json({ ok: true, transcript_id: id });
});
