// =============================================================================
// FOUNDRY — Shadowing against externally observed reality (migration 127)
//
// Shadowing means: Foundry states in advance what it expects to see if a
// responsibility is being carried, then finds out. It was the last rung with no
// honest supply, because every observation Foundry could produce came from
// Foundry.
//
// The expectation here is the founder's, stated as a bounded structured choice
// rather than parsed out of prose — a metric an outside system already reports,
// and a direction. Foundry does not infer "support is handled" from "support
// volume fell"; it records that the founder said the second is what they would
// expect to see, and then compares.
//
// Two refusals that keep the rung honest:
//
//   • Shadowing may only begin on a channel that has ALREADY produced real
//     external evidence. Otherwise entering the rung is a promise that
//     observation will arrive rather than proof that it does.
//   • Absence stays unresolved. No external reading in the window is neither
//     success nor failure, and it is never rounded toward either.
//
// Shadowing authorises nothing. It is watching, and being right while watching
// is still not permission.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { recordReconstructionClaim } from './reconstruction.js';
import { getResponsibility, type Responsibility } from './responsibility.js';
import { beginResponsibilityShadowing, compareShadowObservation } from './responsibility-shadowing.js';
import {
  availableObservationChannels, externalObservationEventType,
  metricObservation, observationChannel,
  isObservableField, type ObservedDirection,
} from './external-observation.js';
import { getObservationChannels, isAdmissibleObservationField } from './company-observation.js';

/** Plain labels for the founder. The metric column never appears on screen. */
export const OBSERVABLE_FIELD_LABELS: Record<string, string> = {
  new_mrr_cents: 'new revenue',
  expansion_mrr_cents: 'revenue from existing customers',
  contraction_mrr_cents: 'revenue lost to downgrades',
  churned_mrr_cents: 'revenue lost to cancellations',
  activation_rate: 'how many new people get started',
  day_30_retention: 'how many people are still here after a month',
  churn_rate: 'how many people leave',
  mrr_health_ratio: 'money lost against money won',
  signups_7d: 'new signups',
  active_users: 'people actively using it',
  support_volume_7d: 'how much support comes in',
  nps_score: 'how people rate us',
};

export interface ShadowableResponsibility {
  responsibilityId: string;
  title: string;
  channels: Array<{ field: string; label: string }>;
}

/**
 * Responsibilities that could honestly be shadowed right now: understood, not
 * already shadowing, and with at least one live external observation channel.
 */
export async function getShadowableResponsibilities(
  productId: string,
): Promise<ShadowableResponsibility[]> {
  // Built-in metrics this company has actually received readings for, plus the
  // quantities it declared and has actually reported. Both are "a channel that
  // has produced real evidence"; only their vocabulary differs, and the
  // institution has no reason to prefer one.
  const builtIn = (await availableObservationChannels(productId))
    .map((field) => ({ field, label: OBSERVABLE_FIELD_LABELS[field] ?? field }));

  const declared = await getObservationChannels(productId);
  const reported = new Set((await query(
    `SELECT DISTINCT json_extract(payload_json,'$.field') AS field FROM signal_events
      WHERE product_id=? AND ${metricObservation()}`, [productId],
  )).rows.map((r) => String((r as Record<string, unknown>).field)));

  const companyDefined = declared
    .filter((c) => !c.revoked && reported.has(c.channelKey))
    .map((c) => ({ field: c.channelKey, label: observationFieldLabel(c.channelKey, declared) }));

  const channels = [...builtIn, ...companyDefined];
  if (!channels.length) return [];
  const rows = await query(
    `SELECT id,title FROM institutional_responsibilities
      WHERE product_id=? AND state='understood' AND disposition='active' ORDER BY created_at,id`,
    [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    responsibilityId: String(row.id), title: String(row.title), channels,
  }));
}

/**
 * Watches the founder ended by disconnecting the channel they ran on.
 *
 * Revoking a channel is honoured where it matters — `isAdmissibleObservationField`
 * refuses every further reading — and everything that follows from that was
 * silent. The expectation stays open and can never resolve, so the
 * responsibility sits at Shadowing for good: it cannot reach Assisting, and
 * nothing connected that to the button the founder pressed.
 *
 * Foundry does not undo the decision and does not ask for the channel back. It
 * says what stopped, which is the difference between honouring a choice and
 * hiding its cost.
 *
 * Only company-declared channels appear here. A built-in metric is a source
 * adapter rather than a company statement and cannot be revoked, so there is
 * nothing for the founder to have done.
 */
export async function getDarkenedWatches(productId: string): Promise<Array<{
  responsibilityId: string; title: string; channelKey: string; channelLabel: string;
}>> {
  const rows = await query(
    `SELECT r.id, r.title, c.channel_key, c.label
       FROM responsibility_shadow_expectations x
       JOIN institutional_responsibilities r
         ON r.id=x.responsibility_id AND r.product_id=x.product_id
       JOIN company_observation_channels c
         ON c.product_id=x.product_id
        -- The event type is PREFIX:FIELD:DIRECTION; the channel is the field
        -- in the middle, and matching on the prefix alone would catch a channel
        -- whose key is a prefix of another's.
        AND (x.expected_event_type LIKE 'external_metric:' || c.channel_key || ':%'
          OR x.expected_event_type LIKE 'reference_metric:' || c.channel_key || ':%')
      WHERE x.product_id=? AND c.revoked_at IS NOT NULL
        AND r.state='shadowing' AND r.disposition='active'
        AND NOT EXISTS (
          SELECT 1 FROM responsibility_shadow_comparisons cmp
           WHERE cmp.expectation_id=x.id AND cmp.classification IN ('matched','deviated'))
      ORDER BY x.created_at DESC`,
    [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    responsibilityId: String(row.id), title: String(row.title),
    channelKey: String(row.channel_key), channelLabel: String(row.label),
  }));
}

/**
 * The founder states what they would expect to see if this responsibility is
 * being carried, and Foundry begins watching.
 *
 * The expectation is recorded as a provenance-bearing claim grounded in the
 * founder's own authenticated statement, exactly like every other founder fact.
 * The observation source cited is a real prior external reading, so the channel
 * is proven rather than assumed.
 */
export async function beginExternalMetricShadowing(input: {
  productId: string; responsibilityId: string; founderId: string;
  field: string; direction: ObservedDirection; validUntil?: Date;
}): Promise<Responsibility | null> {
  // Built-in metrics, or a quantity this company declared it tracks. Before
  // this, the admissible set was twelve SaaS fields, so a company whose reality
  // is boats serviced or classes taught could reach Understood and then never
  // reach Shadowing — the ladder dead-ended on vocabulary rather than on
  // evidence. Everything downstream already treats the field as an opaque name.
  if (!await isAdmissibleObservationField(input.productId, input.field)) return null;
  if (!['rose', 'fell', 'held'].includes(input.direction)) return null;

  const owned = await query(
    `SELECT r.id FROM institutional_responsibilities r JOIN products p ON p.id=r.product_id
      WHERE r.id=? AND r.product_id=? AND p.owner_id=? AND r.state='understood'`,
    [input.responsibilityId, input.productId, input.founderId],
  );
  if (!owned.rows.length) return null;

  // The channel must already have produced real outside evidence for this
  // exact metric. Entering Shadowing on a silent channel would be a promise.
  const channel = await query(
    `SELECT id FROM signal_events
      WHERE product_id=? AND ${metricObservation()}
        AND json_extract(payload_json,'$.field')=?
      ORDER BY created_at DESC LIMIT 1`,
    [input.productId, input.field],
  );
  if (!channel.rows.length) return null;
  const channelSignalId = String((channel.rows[0] as Record<string, unknown>).id);

  // The founder's statement is the evidence for the expectation. It is a
  // bounded structured choice, not prose Foundry interpreted.
  const statementId = nanoid();
  await query(
    `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
     VALUES (?,?,'founder_assertion_structured',?,'low',?,?)`,
    [statementId, input.productId, `founder_expects:${input.field}:${input.direction}`,
      JSON.stringify({
        founder_id: input.founderId, responsibility_id: input.responsibilityId,
        field: input.field, direction: input.direction,
      }),
      `The founder said what they would expect to see if this is being handled`],
  );
  // NOTHING FILTERS ON THIS PREDICATE, AND THAT IS THE POINT OF SAYING SO HERE.
  //
  // Every consumer of `reconstruction_claims` selects by predicate:
  // `responsibility-understanding.ts` against `UNDERSTANDING_FACTS`,
  // `institutional-judgment-disposition.ts` against
  // `later_reality_comparison`, `development-disposition.ts` against
  // `development_need`. `shadow_expectation` is in none of those lists, so no
  // decision anywhere turns on this claim.
  //
  // It is still written, and the reason is not inertia. The OPERATIONAL copy of
  // this fact is the `responsibility_shadow_expectations` row created below,
  // which is what the comparison and `assisting-admission` actually read. This
  // claim is the PROVENANCE copy: what Foundry knows about the company, with an
  // evidence ref back to the founder's own authenticated statement, which is
  // what a reconstruction shows and what an audit would ask for.
  //
  // Two different records of one fact is a shape this campaign usually treats
  // as a defect, so the distinction has to be stated rather than assumed: one
  // is acted on, one is accounted for. If a consumer ever needs to decide
  // something from a founder's stated expectation, it reads this — and the
  // reason to look here first is written down.
  const expectationClaimId = await recordReconstructionClaim({
    productId: input.productId, subject: `responsibility:${input.responsibilityId}`,
    predicate: 'shadow_expectation',
    value: { field: input.field, direction: input.direction },
    epistemicStatus: 'known',
    evidenceRefs: [{ kind: 'signal_event', id: statementId }],
    derivationMethod: 'authenticated founder expectation, stated as a bounded choice',
    observedAt: new Date(),
  });

  // The expectation names the channel that may resolve it, and for a reference
  // company that is the reference channel — same rule, same independence, other
  // world (migration 223). It is read once, here, from a column the company
  // cannot edit, so a caller cannot choose which world its evidence comes from.
  const { reality } = await observationChannel(input.productId);

  await beginResponsibilityShadowing({
    productId: input.productId, responsibilityId: input.responsibilityId,
    expectedEventType: externalObservationEventType(input.field, input.direction, reality),
    expectationClaimId, observationSourceSignalId: channelSignalId,
    // The same source this function's own observation query filters on, and the
    // same one migrations 127 and 223 key their independence guards on.
    observationSourceKind: reality === 'reference'
      ? 'reference_metric_ingest' : 'external_metric_ingest',
    validUntil: input.validUntil,
  });
  return getResponsibility(input.productId, input.responsibilityId);
}

export interface ExternalShadowResolution {
  classification: 'matched' | 'deviated' | 'unresolved';
  observationsConsidered: number;
  learnedClaimId: string | null;
}

/**
 * The founder's own words for a field, whichever vocabulary it belongs to.
 *
 * A built-in metric and a company-declared channel are both "a channel that has
 * produced real evidence"; only their vocabulary differs, and the institution
 * has no reason to prefer one. Stated once here so a surface cannot know about
 * one kind and not the other — which is exactly how the silent-watch card came
 * to be blind to half its population.
 */
export function observationFieldLabel(
  field: string, declared: ReadonlyArray<{ channelKey: string; label: string; unit: string | null }>,
): string {
  const channel = declared.find((c) => c.channelKey === field);
  if (channel) return channel.unit ? `${channel.label} (${channel.unit})` : channel.label;
  return OBSERVABLE_FIELD_LABELS[field] ?? field;
}

/**
 * Every metric expectation, of whichever world.
 *
 * The twin of `metricObservation()`, and safe for the same reason: migration
 * 223 lets a company hold readings from exactly one channel, so a union over
 * both prefixes, scoped to one company, is that company's expectations and
 * nothing else. Widening the READ is what keeps a reference company on the
 * identical code path; the write side chooses the prefix from a column the
 * company cannot edit.
 */
export const METRIC_EXPECTATION_PREFIXES = ['external_metric:', 'reference_metric:'] as const;

export function metricExpectation(column = 'x.expected_event_type'): string {
  return `(${METRIC_EXPECTATION_PREFIXES.map((p) => `${column} LIKE '${p}%'`).join(' OR ')})`;
}

/** The field a metric expectation is about. The event type is
 *  `PREFIX:FIELD:DIRECTION` and the direction is a closed set, so the
 *  field is everything between the prefix and the final colon — a field
 *  carrying its own colon still reads correctly. */
export function expectedMetricField(eventType: string): string | null {
  const prefix = METRIC_EXPECTATION_PREFIXES.find((p) => eventType.startsWith(p));
  if (!prefix) return null;
  const rest = eventType.slice(prefix.length);
  const at = rest.lastIndexOf(':');
  return at > 0 ? rest.slice(0, at) : null;
}

/**
 * Watches that are open and cannot resolve, because nothing is arriving.
 *
 * `getDarkenedWatches` says what stopped when the founder disconnected a
 * channel. Its twin was missing: a channel nobody revoked, that has simply gone
 * quiet. The consequence is identical — the expectation stays open, so the
 * responsibility sits at Shadowing for good and cannot reach Assisting — and
 * the cause is one the founder did not choose and has nothing pointing at it.
 *
 * NO EXPECTATION EVER EXPIRES IN PRODUCTION. Neither founder-facing door
 * supplies a window, so "for good" is literal rather than eventual, and there
 * is no later moment at which this resolves itself.
 *
 * A DATE, NOT A VERDICT. Foundry does not know this company's reporting
 * cadence, and picking a staleness threshold would be deciding how quiet is too
 * quiet on the owner's behalf. It says when the channel last spoke and that
 * nothing has come since; whether that is a problem is the owner's to say.
 *
 * BOTH VOCABULARIES, WHICH THIS FIRST GOT WRONG. It was written by joining
 * `company_observation_channels`, copying the darkened query beside it — but
 * that join is correct THERE for a reason that does not carry: only a declared
 * channel can be revoked, so only a declared channel can go dark. Any channel
 * can go quiet, and `getShadowableResponsibilities` offers built-in metrics and
 * declared channels alike. So for every company that posts the standard metrics
 * and declares nothing of its own, this list was structurally empty and read as
 * "no watch of mine has gone quiet".
 */
export async function getSilentWatches(productId: string): Promise<Array<{
  responsibilityId: string; title: string; channelKey: string; channelLabel: string;
  watchingSince: string; lastReadingAt: string | null;
}>> {
  const open = await query(
    `SELECT r.id, r.title, x.expected_event_type, x.created_at AS watching_since
       FROM responsibility_shadow_expectations x
       JOIN institutional_responsibilities r
         ON r.id=x.responsibility_id AND r.product_id=x.product_id
      WHERE x.product_id=? AND r.state='shadowing' AND r.disposition='active'
        AND ${metricExpectation()}
        AND NOT EXISTS (
          SELECT 1 FROM responsibility_shadow_comparisons cmp
           WHERE cmp.expectation_id=x.id AND cmp.classification IN ('matched','deviated'))
      ORDER BY x.created_at`,
    [productId],
  );
  if (!open.rows.length) return [];

  // Every field's last reading, in one pass rather than one query per watch.
  const lastByField = new Map<string, string>();
  for (const row of (await query(
    `SELECT json_extract(payload_json,'$.field') AS field, MAX(created_at) AS last_at
       FROM signal_events WHERE product_id=? AND ${metricObservation()}
      GROUP BY 1`, [productId],
  )).rows as unknown as Array<Record<string, unknown>>) {
    if (row.field != null) lastByField.set(String(row.field), String(row.last_at));
  }

  const declared = await getObservationChannels(productId);
  const revoked = new Set(declared.filter((c) => c.revoked).map((c) => c.channelKey));

  const out: Array<{
    responsibilityId: string; title: string; channelKey: string; channelLabel: string;
    watchingSince: string; lastReadingAt: string | null;
  }> = [];
  for (const row of open.rows as unknown as Array<Record<string, unknown>>) {
    const field = expectedMetricField(String(row.expected_event_type));
    if (field === null) continue;
    // A channel the founder disconnected is the other card's subject, and
    // naming their own decision as silence would hide it from them.
    if (revoked.has(field)) continue;

    const watchingSince = String(row.watching_since);
    const lastReadingAt = lastByField.get(field) ?? null;

    // AT-OR-AFTER, WHERE RESOLUTION READS STRICTLY-AFTER. That path excludes a
    // reading whose order against the expectation is ambiguous, so a prediction
    // is never credited by evidence that may predate it. Here the claim is the
    // negative one — nothing has come in since you asked — and the same
    // principle flips the inequality: an absence may only be asserted where the
    // evidence is complete enough to support it, so a reading in the
    // expectation's own second is enough to stay quiet.
    if (lastReadingAt !== null && lastReadingAt >= watchingSince) continue;

    out.push({
      responsibilityId: String(row.id), title: String(row.title),
      channelKey: field, channelLabel: observationFieldLabel(field, declared),
      watchingSince, lastReadingAt,
    });
  }
  return out;
}

/**
 * Compare the expectation against every external reading that arrived after it.
 *
 * Deviation dominates. A favourable reading cannot bury an unfavourable one, so
 * a channel that reported both the expected movement and its opposite resolves
 * as deviated rather than matched. With no reading at all, the answer is
 * unresolved — absence is not a result.
 */
export async function resolveExternalMetricShadowing(
  productId: string, expectationId: string,
): Promise<ExternalShadowResolution> {
  const expectation = (await query(
    `SELECT expected_event_type,created_at,responsibility_id FROM responsibility_shadow_expectations
      WHERE id=? AND product_id=?`, [expectationId, productId],
  )).rows[0] as Record<string, unknown> | undefined;
  if (!expectation) throw new Error('external shadow resolution refused');

  const field = String(expectation.expected_event_type).split(':')[1];
  // Strictly after the expectation, and only from the external channel. Both
  // are also refused by migration 127 at insert time; reading them the same way
  // here means the caller cannot present a comparison the guard would reject.
  const observations = await query(
    `SELECT id,event_type FROM signal_events
      WHERE product_id=? AND ${metricObservation()}
        AND json_extract(payload_json,'$.field')=?
        AND datetime(created_at)>datetime(?)
      ORDER BY created_at,id`,
    [productId, field, String(expectation.created_at)],
  );
  const rows = observations.rows as unknown as Array<Record<string, unknown>>;
  if (!rows.length) return { classification: 'unresolved', observationsConsidered: 0, learnedClaimId: null };

  let classification: 'matched' | 'deviated' | 'unresolved' = 'unresolved';
  for (const row of rows) {
    const result = await compareShadowObservation({
      productId, expectationId, observationSignalId: String(row.id),
    });
    if (result === 'deviated') classification = 'deviated';
    else if (result === 'matched' && classification !== 'deviated') classification = 'matched';
  }

  // What was learned is recorded as an ordinary claim with real provenance:
  // the external readings themselves, not Foundry's summary of them.
  //
  // The status is `known` even when the expectation failed. The comparison
  // result is not in doubt — what deviated is the world from the prediction,
  // and that disagreement is the claim's value, not an epistemic conflict about
  // a fact. Marking it `conflicting` would also have meant reaching for a
  // second evidence source to satisfy the multi-source rule, which is exactly
  // the kind of accommodation that turns an invariant into a formality.
  // Same standing as `shadow_expectation` above: no consumer filters on this
  // predicate. The operational copy is the `responsibility_shadow_comparisons`
  // row, which `assisting-admission` reads to decide whether a responsibility
  // has been watched long enough. This is the accounted-for copy, carrying the
  // evidence refs of the independent observations the classification rests on.
  const learnedClaimId = await recordReconstructionClaim({
    productId, subject: `responsibility:${String(expectation.responsibility_id)}`,
    predicate: 'shadow_comparison',
    value: { expected: String(expectation.expected_event_type), classification },
    epistemicStatus: 'known',
    evidenceRefs: rows.map((row) => ({ kind: 'signal_event' as const, id: String(row.id) })),
    derivationMethod: 'bounded comparison against independently observed readings',
    observedAt: new Date(),
  });
  return { classification, observationsConsidered: rows.length, learnedClaimId };
}

/**
 * Responsibilities Foundry understands and has no way to watch, because nothing
 * has ever reported a number to it.
 *
 * `getShadowableResponsibilities` above returns an empty list when the company
 * has no observation channel — `if (!channels.length) return []` — and the
 * "What would you expect to see?" offer simply does not render. That is correct
 * behaviour and a silent dead end: the founder reported an obligation, answered
 * Foundry's questions about it, watched it reach Understood, and then nothing.
 * No offer, and no reason for its absence.
 *
 * IT IS THE FIRST RUNG OF THE LADDER AND EVERY NEW COMPANY STARTS BELOW IT. A
 * channel becomes available when an `external_metric_ingest` reading has
 * actually arrived, so a company that has connected nothing and posted nothing
 * has no channels by construction. Understood → Shadowing is the transition
 * that turns a described obligation into something Foundry watches, and it
 * cannot be crossed until a number arrives from outside.
 *
 * The distinction this preserves is the one the institution is built on:
 * "nothing is happening" and "I cannot see" are different facts. The founder
 * can act on the second — connect something, post a reading — and can do
 * nothing at all with silence.
 *
 * SCOPED TO TOTAL ABSENCE ON PURPOSE. When channels DO exist, whether any of
 * them is relevant to a particular responsibility is the founder's judgement,
 * not Foundry's — it does not know which number speaks for "answer the Hartley
 * enquiry". Reporting "no relevant channel" would be Foundry asserting a
 * relevance it cannot compute. Reporting "no channel at all" is arithmetic.
 */
export interface UnwatchableResponsibility {
  responsibilityId: string;
  title: string;
}

export async function getUnwatchableResponsibilities(
  productId: string,
): Promise<UnwatchableResponsibility[]> {
  const builtIn = await availableObservationChannels(productId);
  if (builtIn.length > 0) return [];

  const declared = await getObservationChannels(productId);
  const reported = new Set((await query(
    `SELECT DISTINCT json_extract(payload_json,'$.field') AS field FROM signal_events
      WHERE product_id=? AND ${metricObservation()}`, [productId],
  )).rows.map((r) => String((r as Record<string, unknown>).field)));
  if (declared.some((c) => !c.revoked && reported.has(c.channelKey))) return [];

  const rows = await query(
    `SELECT id,title FROM institutional_responsibilities
      WHERE product_id=? AND state='understood' AND disposition='active'
      ORDER BY created_at, rowid`,
    [productId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>)
    .map((row) => ({ responsibilityId: String(row.id), title: String(row.title) }));
}
