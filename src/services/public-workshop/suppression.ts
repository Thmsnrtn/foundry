// =============================================================================
// FOUNDRY — One no is a no to the whole Workshop.
//
// The company-level list (contact-constraint.ts) answers whether a person told
// THIS company to stop. The Workshop is one public identity across every
// experiment, so a person who said no during Experiment 3 is not written to by
// Experiment 18 because the experiment id changed. This is the Workshop's
// list and its contact history, both append-only, read by the door through
// `contactIsRefused` and by the plan guard on the row.
//
// Reputation is a shared asset with a shared blast radius, so the rules here
// are the ones that stop a small test from spending what every later test
// depends on: an opt-out anywhere, a bounce or a complaint at the provider,
// and a ceiling on how often the Workshop writes to the same address.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { publicWorkshopOf } from './settings.js';

export type SuppressionReason = 'they_asked' | 'bounced' | 'complained' | 'founder';
export type SuppressionSource = 'page_opt_out' | 'provider' | 'reply' | 'owner';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];
const normalise = (email: string): string => email.trim().toLowerCase();

export async function suppress(input: { founderId: string; email: string; reason: SuppressionReason; source: SuppressionSource; experimentId?: string | null; note?: string | null }): Promise<{ recorded: boolean }> {
  const email = normalise(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { recorded: false };
  const r = await query(
    `INSERT INTO public_suppressions (id, founder_id, email, reason, source, experiment_id, note) VALUES (?,?,?,?,?,?,?) ON CONFLICT(founder_id, email) DO NOTHING`,
    [nanoid(), input.founderId, email, input.reason, input.source, input.experimentId ?? null, input.note ?? null]);
  return { recorded: (r.rowsAffected ?? 0) > 0 };
}

export async function isSuppressed(founderId: string, email: string): Promise<{ suppressed: true; reason: SuppressionReason } | { suppressed: false }> {
  const r = (await rows('SELECT reason FROM public_suppressions WHERE founder_id = ? AND email = ?', [founderId, normalise(email)]))[0];
  return r ? { suppressed: true, reason: String(r.reason) as SuppressionReason } : { suppressed: false };
}

export async function suppressionsOf(founderId: string, limit = 200): Promise<Array<{ email: string; reason: SuppressionReason; source: SuppressionSource; experimentId: string | null; recordedAt: string }>> {
  return (await rows('SELECT email, reason, source, experiment_id, recorded_at FROM public_suppressions WHERE founder_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?', [founderId, limit]))
    .map((r) => ({ email: String(r.email), reason: String(r.reason) as SuppressionReason, source: String(r.source) as SuppressionSource, experimentId: r.experiment_id == null ? null : String(r.experiment_id), recordedAt: String(r.recorded_at) }));
}

/** The Workshop wrote to this address, for this experiment, by this action. */
export async function recordContact(input: { founderId: string; email: string; experimentId: string; actionId: string }): Promise<void> {
  await query(`INSERT INTO public_contacts (id, founder_id, email, experiment_id, action_id) VALUES (?,?,?,?,?) ON CONFLICT(action_id) DO NOTHING`,
    [nanoid(), input.founderId, normalise(input.email), input.experimentId, input.actionId]);
}

/** Why the Workshop should not write to this address again now, or null. */
export async function contactFrequencyRefusal(input: { founderId: string; email: string; experimentId: string; now?: Date }): Promise<string | null> {
  const w = await publicWorkshopOf(input.founderId);
  if (!w) return null;
  const now = input.now ?? new Date();
  const email = normalise(input.email);
  const history = await rows('SELECT experiment_id, contacted_at FROM public_contacts WHERE founder_id = ? AND email = ? ORDER BY contacted_at DESC', [input.founderId, email]);
  const gapMs = w.contactGapDays * 86_400_000;
  const yearMs = 365 * 86_400_000;
  const asMs = (s: unknown): number => new Date(String(s).replace(' ', 'T') + (String(s).endsWith('Z') ? '' : 'Z')).getTime();
  const other = history.filter((h) => String(h.experiment_id) !== input.experimentId);
  const recent = other.find((h) => now.getTime() - asMs(h.contacted_at) < gapMs);
  if (recent) return `written to ${Math.floor((now.getTime() - asMs(recent.contacted_at)) / 86_400_000)} days ago for another experiment; the Workshop waits ${w.contactGapDays} days`;
  const inYear = history.filter((h) => now.getTime() - asMs(h.contacted_at) < yearMs).length;
  if (inYear >= w.contactCeilingPerYear) return `written to ${inYear} times in the last year; the Workshop's ceiling is ${w.contactCeilingPerYear}`;
  return null;
}

/** Everyone the Workshop has written to, newest first, with what came of it. */
export async function contactHistory(founderId: string, limit = 200): Promise<Array<{ email: string; experimentId: string; contactedAt: string; outcome: string }>> {
  return (await rows(
    `SELECT c.email, c.experiment_id, c.contacted_at, a.outcome_status FROM public_contacts c JOIN outbound_actions a ON a.id = c.action_id
      WHERE c.founder_id = ? ORDER BY c.contacted_at DESC, c.rowid DESC LIMIT ?`, [founderId, limit]))
    .map((r) => ({ email: String(r.email), experimentId: String(r.experiment_id), contactedAt: String(r.contacted_at), outcome: String(r.outcome_status ?? 'unresolved') }));
}

/**
 * OPT-OUTS ARRIVE AT THE PUBLIC STORE, since the page is served without the
 * private institution awake. Each is copied onto the Workshop's list, then
 * removed from the store through the door so no personal data lingers at
 * the edge longer than it must.
 */
export async function syncOptOutsFromStore(founderId: string): Promise<{ recorded: number; swept: number; failed: string[] }> {
  const w = await publicWorkshopOf(founderId);
  const out = { recorded: 0, swept: 0, failed: [] as string[] };
  if (!w?.kvNamespaceId) return out;
  const { listKvKeys, readKvValue, cloudflareConfigured } = await import('../integration/cloudflare-gateway.js');
  if (!cloudflareConfigured()) return out;
  const { invoke } = await import('../outbound/gateway.js');
  for (const key of await listKvKeys(w.kvNamespaceId, 'optout:')) {
    try {
      const raw = await readKvValue(w.kvNamespaceId, key);
      if (raw === null) continue;
      const v = JSON.parse(raw) as { email?: string; at?: string };
      if (v.email) {
        const r = await suppress({ founderId, email: v.email, reason: 'they_asked', source: 'page_opt_out', note: v.at ? `opted out on the page at ${v.at}` : null });
        if (r.recorded) out.recorded += 1;
      }
      const swept = await invoke({
        productId: w.productId, tool: 'cloudflare_kv_delete', action: `sweep an opt-out record already kept (${key})`,
        params: { namespace_id: w.kvNamespaceId, key, purpose: 'remove an opt-out from the public store after recording it privately' },
        dedupKey: `public:${founderId}:sweep:${key}`, surface: 'public_workshop', dataClass: 'general',
      });
      if (swept.ok) out.swept += 1; else out.failed.push(`${key}: ${swept.phase} ${swept.reason}`);
    } catch (e) { out.failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out;
}
