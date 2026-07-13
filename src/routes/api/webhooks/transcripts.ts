// =============================================================================
// FOUNDRY — Transcript Webhooks
// Receives call transcript payloads from Fathom and Fireflies.
// =============================================================================

import { Hono } from 'hono';
import { ingestTranscript, analyzeTranscript } from '../../../services/integrations/transcripts.js';
import { validateApiKey } from '../../../services/rbac/permissions.js';

export const transcriptWebhooks = new Hono();

// Bounded inputs (security close-out 2026-07-13): transcript text flows into
// AI analysis — an unbounded payload is an unbounded bill. Oversize is
// refused, not silently truncated (the sender should know).
const MAX_TRANSCRIPT_CHARS = 200_000;
const MAX_PARTICIPANTS = 50;

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Defect fix (registry: transcripts.ts:14-21): the old lookup compared the RAW
// header key against the stored key_hash — legitimate keys always 401'd and a
// leaked hash would have authenticated. validateApiKey hashes the presented
// key and also enforces revocation + expiry.
async function getProductIdForApiKey(apiKey: string): Promise<string | null> {
  if (!apiKey) return null;
  const result = await validateApiKey(apiKey).catch(() => null);
  return result?.productId ?? null;
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
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    return c.json({ error: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} chars` }, 413);
  }

  const id = await ingestTranscript(productId, {
    source: 'fathom',
    call_type: 'customer',
    participant_emails: Array.isArray(body['participants'])
      ? (body['participants'] as string[]).slice(0, MAX_PARTICIPANTS).map(String).join(', ').slice(0, 4000)
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
  if (transcriptText.length > MAX_TRANSCRIPT_CHARS) {
    return c.json({ error: `Transcript exceeds ${MAX_TRANSCRIPT_CHARS} chars` }, 413);
  }

  const attendees = Array.isArray(body['attendees'])
    ? (body['attendees'] as Array<{ email?: string }>)
        .slice(0, MAX_PARTICIPANTS)
        .map(a => a?.email)
        .filter(Boolean)
        .join(', ')
        .slice(0, 4000)
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
