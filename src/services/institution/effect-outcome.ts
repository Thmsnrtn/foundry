// =============================================================================
// FOUNDRY — did it actually work? (migration 137)
//
// The canonical loop ends `… → Execution → Receipt → Outcome → Learning`, and
// the last two links had no supply. Nothing in production had ever produced an
// outcome observation, so `outcome_status` was permanently `unresolved` —
// correct as a default, and a poor destination. Preserving `unresolved` was
// always right; being UNABLE to leave it means the institution can act and can
// never learn.
//
// WHAT A REPORT IS. Someone who is not Foundry saying that a specific executed
// effect did or did not achieve what it was for. That is evidence about the
// outcome, carrying its reporter and its provenance. It is not proof, and this
// module never upgrades it into one.
//
// WHAT IT IS NOT.
//
//   • Not Foundry's opinion. A system that can declare its own success has no
//     outcome layer, only a louder execution layer. The database refuses any
//     report attributed to the institution.
//   • Not a receipt. A provider accepting an email is already recorded and is a
//     different fact; this is about whether the teacher turned up.
//   • Not authority. Learning that something worked grants nothing, widens
//     nothing, and promotes nothing.
//   • Not a resolution of conflict. Two reporters who disagree leave the
//     outcome `conflicting`, which is a real state and stays visible.
// =============================================================================

import { createHash } from 'node:crypto';
import { query } from '../../db/client.js';

export type OutcomeVerdict = 'achieved' | 'failed';

/**
 * A reporter, as the founder should read it.
 *
 * THE SAME FACT HAD TWO TREATMENTS AND NEITHER WAS RIGHT. The disputed-effects
 * card rendered the raw string — `external:zendesk-webhook`, or
 * `founder:` followed by the founder's own id — so internal prefixes and a raw
 * identifier reached the page. The assisting-activity line flattened everything
 * to a category, so "a system you connected told me" discarded WHICH system,
 * and a founder with three connected could not check the verdict against the
 * right source.
 *
 * `external:` names are SELF-DECLARED and the phrasing says so. The ingest door
 * states the rule it was captured under — "the origin the tool names for itself,
 * never a claim about who it is; identity here is the token, this is provenance,
 * not authority" — so rendering it as though Foundry had verified the name would
 * be the claim that door refuses to make. Quoting it as what the system calls
 * itself keeps the provenance and the doubt together.
 */
export function reporterPhrase(reporter: string): string {
  if (reporter.startsWith('founder:')) return 'you';
  if (reporter === 'customer:wrote_again') return 'the customer, by writing again';
  if (reporter.startsWith('external:')) {
    const name = reporter.slice('external:'.length).trim();
    return name && name !== 'unnamed_system'
      ? `a system you connected, calling itself “${name}”`
      : 'a system you connected, which did not say what it was';
  }
  return 'somebody outside';
}

export type OutcomeRefusal =
  | 'effect_unknown' | 'verdict_invalid' | 'reporter_invalid' | 'not_executed'
  | 'detail_too_long';

/**
 * THE ONE UNBOUNDED STRING ON A PUBLIC DOOR.
 *
 * `POST /ingest/effect-outcome/:token` is token-authed and open, and every
 * other external string on it and its neighbours is bounded: `reported_by` is
 * sliced to 120 here and on the company-report door, `what` is refused past 200
 * there, a customer's message body is refused past 8192 by the intake schema,
 * and the custom-metrics drawer has carried an 8KB ceiling since the
 * 2026-07-13 security close-out. `detail` was trimmed and stored, and nothing
 * anywhere said how long it could be — into `signal_events.payload_json`, which
 * has no size constraint of its own.
 *
 * Two thousand characters, and refused rather than truncated. A machine
 * explaining why an effect failed has room for a paragraph; a truncated
 * explanation is a different explanation, and this record is evidence a person
 * reads to decide whether something worked. The sibling bound on `what` refuses
 * for the same reason.
 */
export const MAX_OUTCOME_DETAIL_CHARS = 2_000;

export interface EffectOutcomeReport {
  id: string; effectId: string; verdict: OutcomeVerdict; reporter: string; detail: string | null;
}

/**
 * Record that someone outside says an effect did or did not achieve its intent.
 *
 * Identity is derived from the report, so the same reporter saying the same
 * thing twice converges instead of counting as two witnesses. Two DIFFERENT
 * reporters are two reports, which is what makes disagreement visible rather
 * than last-write-wins.
 */
export async function reportEffectOutcome(input: {
  productId: string; effectId: string; verdict: string; reporter: string; detail?: string;
}): Promise<EffectOutcomeReport | { refused: OutcomeRefusal }> {
  const effectId = input.effectId?.trim();
  const reporter = input.reporter?.trim();
  const detail = input.detail?.trim() || null;
  if (!effectId) return { refused: 'effect_unknown' };
  if (input.verdict !== 'achieved' && input.verdict !== 'failed') return { refused: 'verdict_invalid' };
  // Refused here as well as in the database, so the caller gets a reason rather
  // than a constraint error.
  if (!reporter || reporter.startsWith('institution:')) return { refused: 'reporter_invalid' };
  if (detail && detail.length > MAX_OUTCOME_DETAIL_CHARS) return { refused: 'detail_too_long' };

  const executed = await query(
    "SELECT 1 FROM outbound_actions WHERE product_id=? AND effect_id=? AND status='executed'",
    [input.productId, effectId],
  );
  if (!executed.rows.length) return { refused: 'not_executed' };

  const verdict = input.verdict as OutcomeVerdict;
  const id = 'outc_' + createHash('sha256')
    .update([input.productId, effectId, reporter, verdict].join('\n')).digest('hex').slice(0, 32);

  const seen = await query('SELECT id FROM signal_events WHERE id=?', [id]);
  if (!seen.rows.length) {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES (?,?,'effect_outcome_report',?,?,?,?)`,
      [id, input.productId, `effect_outcome:${effectId}:${verdict}`,
        verdict === 'failed' ? 'medium' : 'low',
        JSON.stringify({ effect_id: effectId, verdict, reporter, detail }),
        verdict === 'achieved'
          ? 'Someone outside said this achieved what it was for'
          : 'Someone outside said this did not achieve what it was for'],
    );
  }
  return { id, effectId, verdict, reporter, detail };
}

/** Every outcome report about one effect, oldest first. */
export async function getEffectOutcomeReports(
  productId: string, effectId: string,
): Promise<EffectOutcomeReport[]> {
  const rows = await query(
    `SELECT id,payload_json FROM signal_events
      WHERE product_id=? AND source='effect_outcome_report'
        AND json_extract(payload_json,'$.effect_id')=?
      ORDER BY created_at, rowid`,
    [productId, effectId],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => {
    const payload = JSON.parse(String(row.payload_json)) as {
      effect_id: string; verdict: OutcomeVerdict; reporter: string; detail: string | null;
    };
    return {
      id: String(row.id), effectId: payload.effect_id, verdict: payload.verdict,
      reporter: payload.reporter, detail: payload.detail ?? null,
    };
  });
}

/** Effects this company has dispatched whose outcome nobody has reported.
 *
 * The founder-facing question "did this work?" has to be asked about something
 * specific, and asking about an effect that already has an answer wastes the
 * one resource the institution is supposed to be conserving. */
export async function getUnresolvedEffects(
  productId: string, limit = 10,
): Promise<Array<{ effectId: string; responsibilityId: string; title: string; preview: string }>> {
  const rows = await query(
    `SELECT o.effect_id, o.responsibility_id, r.title, o.preview_text
       FROM outbound_actions o
       JOIN institutional_responsibilities r ON r.id=o.responsibility_id AND r.product_id=o.product_id
      WHERE o.product_id=? AND o.status='executed' AND o.effect_id IS NOT NULL
        AND (o.outcome_status IS NULL OR o.outcome_status='unresolved')
      ORDER BY o.executed_at DESC LIMIT ?`,
    [productId, limit],
  );
  return (rows.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    effectId: String(row.effect_id), responsibilityId: String(row.responsibility_id),
    title: String(row.title), preview: String(row.preview_text ?? ''),
  }));
}

/**
 * Effects whose reporters disagree, with what each of them actually said.
 *
 * `conflicting` is a state the reconciliation goes out of its way to preserve —
 * two witnesses who disagree are not resolved toward the convenient answer. But
 * the founder-facing surface said only "business evidence conflicts; owner
 * judgment may be needed", which asks a person to exercise judgment while
 * withholding the thing they would exercise it on. `getEffectOutcomeReports`
 * had no route caller at all; this is its first production reader.
 *
 * Nothing here resolves the disagreement, ranks the reporters, or suggests
 * which to believe. It shows who said what.
 */
export async function getDisputedEffects(
  productId: string, limit = 5,
): Promise<Array<{
  effectId: string; title: string; preview: string;
  reports: EffectOutcomeReport[];
}>> {
  const rows = await query(
    `SELECT o.effect_id, o.preview_text, r.title
       FROM outbound_actions o
       JOIN institutional_responsibilities r ON r.id=o.responsibility_id AND r.product_id=o.product_id
      WHERE o.product_id=? AND o.outcome_status='conflicting' AND o.effect_id IS NOT NULL
      ORDER BY o.executed_at DESC LIMIT ?`,
    [productId, limit],
  );
  const out = [];
  for (const row of rows.rows as unknown as Array<Record<string, unknown>>) {
    const effectId = String(row.effect_id);
    out.push({
      effectId, title: String(row.title), preview: String(row.preview_text ?? ''),
      reports: await getEffectOutcomeReports(productId, effectId),
    });
  }
  return out;
}
