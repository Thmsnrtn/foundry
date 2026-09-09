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
  // WHAT THEY LAST ASKED FOR OUTRANKS ANY INTERVAL. "Nothing further" is not a
  // complaint and does not belong on the do-not-contact list, but it is still
  // an answer, and a workshop that recorded it and then wrote again would be
  // keeping the answer and ignoring it. An answer given about one experiment
  // is not permission for the next one either (§consent has scope), so a
  // continuation that permits more lifts nothing here; only a refusal binds.
  const said = (await rows(
    `SELECT c.wants, c.experiment_id, k.permits_more FROM workshop_continuations c
       JOIN continuation_kinds k ON k.kind = c.wants
      WHERE c.founder_id = ? AND c.email = ? ORDER BY c.recorded_at DESC, c.rowid DESC LIMIT 1`,
    [input.founderId, email]))[0];
  if (said && Number(said.permits_more) === 0 && String(said.experiment_id ?? '') !== input.experimentId) {
    return `they answered "${String(said.wants).replaceAll('_', ' ')}" the last time the Workshop wrote to them`;
  }
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

// ─── What somebody asked for ─────────────────────────────────────────────────

/**
 * CONSENT HAS SCOPE. An opt-out was the only answer the Workshop could hear,
 * so every other thing a participant might say — send me more of these, only
 * tell me when something unusual appears, I would pay for this regularly, this
 * was not useful — arrived as silence. Silence is not permission, and it is not
 * refusal either; it is the absence of an answer, and treating it as either is
 * how a workshop starts writing to people who never asked.
 *
 * A stated continuation is kept as the person stated it. The kind is a closed
 * vocabulary so the institution cannot invent a permission; their own words are
 * kept beside it and never paraphrased into the kind.
 */
export type ContinuationKind = 'never' | 'nothing' | 'more_like_this' | 'only_unusual' | 'would_pay_regularly' | 'will_explain';

export async function recordContinuation(input: {
  founderId: string; email: string; experimentId?: string | null; wants: ContinuationKind; said?: string | null;
}): Promise<{ recorded: boolean }> {
  const email = normalise(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return { recorded: false };
  const kind = (await rows('SELECT kind, permits_more FROM continuation_kinds WHERE kind = ?', [input.wants]))[0];
  if (!kind) return { recorded: false };
  const r = await query(
    `INSERT INTO workshop_continuations (id, founder_id, email, experiment_id, wants, said) VALUES (?,?,?,?,?,?)
       ON CONFLICT(founder_id, email, experiment_id) DO NOTHING`,
    [nanoid(), input.founderId, email, input.experimentId ?? null, input.wants, input.said?.trim() || null]);
  // A CONTINUATION THAT PERMITS NOTHING IS A NO, and is enforced as one.
  // Recording the preference and leaving the list untouched would be keeping
  // the answer and ignoring it.
  if (Number(kind.permits_more) === 0 && input.wants === 'never') {
    await suppress({ founderId: input.founderId, email, reason: 'they_asked', source: 'page_opt_out', experimentId: input.experimentId ?? null, note: input.said?.trim() || null });
  }
  return { recorded: (r.rowsAffected ?? 0) > 0 };
}

/** What this person has asked of the Workshop, newest first. */
export async function continuationsOf(founderId: string, email: string): Promise<Array<{ wants: ContinuationKind; permitsMore: boolean; said: string | null; experimentId: string | null; recordedAt: string }>> {
  return (await rows(
    `SELECT c.wants, c.said, c.experiment_id, c.recorded_at, k.permits_more
       FROM workshop_continuations c JOIN continuation_kinds k ON k.kind = c.wants
      WHERE c.founder_id = ? AND c.email = ? ORDER BY c.recorded_at DESC, c.rowid DESC`,
    [founderId, normalise(email)]))
    .map((r) => ({ wants: String(r.wants) as ContinuationKind, permitsMore: Number(r.permits_more) === 1,
      said: r.said == null ? null : String(r.said), experimentId: r.experiment_id == null ? null : String(r.experiment_id),
      recordedAt: String(r.recorded_at) }));
}

/** Everything anybody has asked of this Workshop, for the owner to read. */
export async function continuationsFor(founderId: string, limit = 100): Promise<Array<{ email: string; wants: ContinuationKind; said: string | null; experimentId: string | null; recordedAt: string }>> {
  return (await rows(
    `SELECT email, wants, said, experiment_id, recorded_at FROM workshop_continuations WHERE founder_id = ? ORDER BY recorded_at DESC, rowid DESC LIMIT ?`,
    [founderId, limit]))
    .map((r) => ({ email: String(r.email), wants: String(r.wants) as ContinuationKind,
      said: r.said == null ? null : String(r.said), experimentId: r.experiment_id == null ? null : String(r.experiment_id),
      recordedAt: String(r.recorded_at) }));
}
/**
 * OPT-OUTS ARRIVE AT THE PUBLIC STORE, since the page is served without the
 * private institution awake. Each is copied onto the Workshop's list, then
 * removed from the store through the door so no personal data lingers at
 * the edge longer than it must.
 */
export async function syncOptOutsFromStore(founderId: string): Promise<{ recorded: number; continuations: number; swept: number; failed: string[] }> {
  const w = await publicWorkshopOf(founderId);
  const out = { recorded: 0, continuations: 0, swept: 0, failed: [] as string[] };
  if (!w?.kvNamespaceId) return out;
  const { listKvKeys, readKvValue, cloudflareConfigured } = await import('../integration/cloudflare-gateway.js');
  if (!cloudflareConfigured()) return out;
  const { invoke } = await import('../outbound/gateway.js');
  const sweep = async (key: string): Promise<void> => {
    const swept = await invoke({
      productId: w.productId, tool: 'cloudflare_kv_delete', action: `sweep an answer already kept (${key})`,
      params: { namespace_id: w.kvNamespaceId, key, purpose: 'remove a person\'s answer from the public store after recording it privately' },
      dedupKey: `public:${founderId}:sweep:${key}`, surface: 'public_workshop', dataClass: 'general',
    });
    if (swept.ok) out.swept += 1; else out.failed.push(`${key}: ${swept.phase} ${swept.reason}`);
  };
  for (const key of await listKvKeys(w.kvNamespaceId, 'optout:')) {
    try {
      const raw = await readKvValue(w.kvNamespaceId, key);
      if (raw === null) continue;
      const v = JSON.parse(raw) as { email?: string; at?: string };
      if (v.email) {
        const r = await suppress({ founderId, email: v.email, reason: 'they_asked', source: 'page_opt_out', note: v.at ? `opted out on the page at ${v.at}` : null });
        if (r.recorded) out.recorded += 1;
      }
      await sweep(key);
    } catch (e) { out.failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  // WHAT THEY ASKED FOR ARRIVES THE SAME WAY, and is worth more than an
  // opt-out: it is the only thing anybody volunteers that says whether the
  // thing was useful at all. Recorded as a continuation, and — where the person
  // stated it plainly — as commercial evidence of the kind no bounce can be.
  for (const key of await listKvKeys(w.kvNamespaceId, 'continue:')) {
    try {
      const raw = await readKvValue(w.kvNamespaceId, key);
      if (raw === null) continue;
      const v = JSON.parse(raw) as { email?: string; wants?: string; said?: string; slug?: string; at?: string };
      if (v.email && v.wants) {
        const experimentId = v.slug ? await experimentBySlug(founderId, v.slug) : null;
        const r = await recordContinuation({ founderId, email: v.email, experimentId, wants: v.wants as ContinuationKind, said: v.said ?? null });
        if (r.recorded) {
          out.continuations += 1;
          if (experimentId) await recordContinuationEvidence(experimentId, v.wants as ContinuationKind, key);
        }
      }
      await sweep(key);
    } catch (e) { out.failed.push(`${key}: ${e instanceof Error ? e.message : String(e)}`); }
  }
  return out;
}

async function experimentBySlug(founderId: string, slug: string): Promise<string | null> {
  const r = (await rows('SELECT experiment_id FROM public_experiments WHERE founder_id = ? AND slug = ?', [founderId, slug]))[0];
  return r ? String(r.experiment_id) : null;
}

/**
 * WHAT A STATED ANSWER IS WORTH AS EVIDENCE. "I had it and it was not useful"
 * is much stronger evidence about the thing than a bounce, and "keep sending
 * me these" is the first sign a one-off might be a relationship. Neither is
 * inferred: both are what the person chose to say, on a page they chose to
 * open, with nothing tracking whether they opened it.
 */
async function recordContinuationEvidence(experimentId: string, wants: ContinuationKind, key: string): Promise<void> {
  const kind = wants === 'nothing' || wants === 'never' ? 'declined_value'
    : wants === 'more_like_this' || wants === 'only_unusual' || wants === 'would_pay_regularly' ? 'continuation_requested'
      : null;
  if (kind === null) return;
  const { exposureOf, recordBusinessOutcome } = await import('../venture/outcome.js');
  const { exchangeOf } = await import('../venture/probe-design-context.js');
  const x = await exposureOf(experimentId);
  if (!x) return;
  await recordBusinessOutcome({
    exposureId: x.id, kind, observedAt: new Date(), provider: 'apexmicro', providerRef: key,
    arrivedVia: 'experiment_page', exchange: await exchangeOf(experimentId),
  });
}
