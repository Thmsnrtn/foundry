// =============================================================================
// FOUNDRY — observing its own repository reality (outer boundary)
//
// This is the boundary module where "which product is the Foundry company"
// is asked, and it is the ONLY thing about this path that is special. It
// resolves the canonical identity once, obtains an ordinary product id, and
// from that point forward calls the same institutional intake any other
// company's evidence goes through. Nothing downstream can tell whose repository
// produced the fact — the institutional kernel is forbidden from even being
// able to ask (see tests/unit/recursive-institution.test.ts).
//
// WHY THIS RESPONSIBILITY, AND NOT ANOTHER. The reachability gate has carried
// `development-observation.ts` and `development-shadowing.ts` on its DARK list
// with the reason "development responsibilities are not discovered in
// production" — and that reason was honest. For a customer's company, Foundry
// has no independent view of their repository, so a development expectation
// could only ever be checked against Foundry's own say-so, which is not
// evidence. For the Foundry company that supply genuinely exists: the
// repository is right here, the check is deterministic, and CI runs the
// stronger version of it independently on a different machine.
//
// So this is the one company where a development responsibility can climb the
// ladder honestly, and that is the entire reason recursive operation starts
// here rather than somewhere more impressive.
//
// WHAT IS OBSERVED. `docs/db/schema.snapshot.sql` is a committed description of
// the schema the migrations produce. It is generated, never hand-written, and
// it drifts whenever a migration lands without the snapshot being regenerated.
// That is a real recurring maintenance obligation in this repository, it is
// already enforced externally by a CI job, and getting it wrong misleads a
// reader without changing any behaviour — a narrow, reversible, low-consequence
// surface, which is what a first recursive case should be.
//
// WHAT THIS DOES NOT DO. It runs no command, writes no file, and repairs
// nothing. It reads the committed snapshot, reads the live schema, and records
// what it found. Observing is not carrying, and a passing check is not
// permission — the observation feeds the ordinary Shadowing machinery and stops
// there.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../../db/client.js';
import { resolveFoundryProductId } from '../system-identity.js';
import {
  recordDevelopmentObservation, type DevelopmentObservation,
} from '../institution/development-observation.js';

/** The check's canonical name. Shared with any expectation that predicts it,
 * by naming only — an expectation and an observation never see each other. */
export const SCHEMA_SNAPSHOT_CHECK = 'schema-snapshot-freshness';

export const SNAPSHOT_PATH = 'docs/db/schema.snapshot.sql';

/** Every schema object the snapshot claims to describe. */
/**
 * WHAT A GRANT FOR THIS CHECK MAY TOUCH, DECLARED WHERE THE CHECK LIVES.
 *
 * The authority module can enforce a path scope but cannot know which path
 * belongs to which obligation, and the route that offers a grant must not
 * invent one. So the module that owns an observation also states the smallest
 * scope that could satisfy it, and the owner-facing door reads this rather
 * than guessing.
 *
 * `plainly` is the sentence shown to the owner. It says what Foundry would DO,
 * not which table or class it would use: granting authority should not require
 * reading the institution.
 *
 * Adding an entry here is the act that makes a self-maintenance obligation
 * offerable. It is deliberately a short list.
 */
export const SELF_MAINTENANCE_SCOPES: Record<string, {
  path: string;
  changeClass: 'generated_artifact' | 'test' | 'documentation';
  verification: string[];
  plainly: string;
}> = {
  [SCHEMA_SNAPSHOT_CHECK]: {
    path: SNAPSHOT_PATH,
    changeClass: 'generated_artifact',
    verification: [SCHEMA_SNAPSHOT_CHECK],
    plainly: 'regenerate the committed schema snapshot after a migration changes the schema',
  },
};

/**
 * Offer the obligation the check implies, for the owner to recognise or refuse.
 *
 * WHY FOUNDRY PROPOSES RATHER THAN WAITING TO BE TOLD. Discovery admits a
 * founder's report and an external system's, and nothing else — so the only way
 * a self-maintenance obligation could become a responsibility was for the owner
 * to type it into the report form and pick its kind from eight plain sentences.
 * The natural pick for "keep the committed snapshot fresh" is "something that
 * has to be kept working", which is `maintenance`, which maps to the
 * `operations` capability — and `beginFounderDevelopmentShadowing` requires
 * `development`. The owner would have reported the right obligation, been told
 * it was recorded, and then found no watch offered, with nothing on any page
 * saying why. A dead end two steps past a correct action is worse than no
 * action, because it spends the owner's trust rather than his minute.
 *
 * A CANDIDATE IS NOT A RESPONSIBILITY. It is non-executable, evidence-bound and
 * pending until the owner decides; `promoteResponsibilityCandidate` needs an
 * authenticated owner, and rejecting it is one tap that sticks — the
 * convergence key returns the decided candidate rather than proposing again, so
 * a refusal is not re-asked on every observation.
 *
 * ONLY WHAT COULD ACTUALLY BE CARRIED. The proposal is made for a check that has
 * an entry in `SELF_MAINTENANCE_SCOPES` and no other, so Foundry never offers to
 * take on something no grant could ever authorise it to touch. The sentence
 * shown is that entry's `plainly` — the same words the authority request will
 * use, so the owner reads one description of the obligation from recognition
 * through to grant, and `capability_dependency` is `development` by
 * construction rather than by the owner guessing a kind.
 *
 * Recognising it grants nothing, and this path takes nothing: proposing is not
 * observing, observing is not carrying, and carrying still needs the bounded,
 * time-limited, revocable grant it always did.
 */
async function proposeSelfMaintenanceCandidate(input: {
  productId: string; check: string; evidenceId: string; observedAt: Date;
}): Promise<void> {
  const scope = SELF_MAINTENANCE_SCOPES[input.check];
  if (!scope) return;

  const { proposeResponsibilityCandidate } = await import(
    '../institution/responsibility-candidate.js');
  await proposeResponsibilityCandidate({
    productId: input.productId,
    convergenceKey: `self_maintenance:${input.check}`,
    proposedResponsibility: scope.plainly,
    evidenceRefs: [{ kind: 'signal_event', id: input.evidenceId }],
    derivationMethod: 'self_maintenance_scope',
    rationale: `${input.check} runs against this company independently, and `
      + `${scope.path} is the only thing a grant for it could touch.`,
    // KNOWN, ARRIVED AT BY BEING REFUSED TWICE. Written first as `inferred`
    // with no confidence, migration 107 refused it —
    // `responsibility_candidate:confidence_required`, because an inference has
    // to say how strongly it is held, and there is no frequency here to derive
    // a number from. Rewritten as `unresolved`, which reads as the honest
    // answer, migration 108 refused the PROMOTION: `not_promotable` excludes
    // `unresolved` by design. That would have put a button in front of the
    // owner that could never work.
    //
    // Both refusals were pointing at the same mistake. Nothing here is
    // estimated. A check with a declared self-maintenance scope implies exactly
    // this obligation and exactly one path it could touch; the derivation is
    // deterministic and repeats identically. What is genuinely open is not how
    // likely the proposition is — it is whether Foundry should carry it, and
    // that is the owner's decision, which the mechanism already models by
    // refusing to become a responsibility until he says so.
    epistemicStatus: 'known',
    capabilityDependency: 'development',
    authorityRequired: true,
    observedAt: input.observedAt,
  });
}

export function snapshotObjectNames(snapshotSql: string): Set<string> {
  return new Set(
    [...snapshotSql.matchAll(
      /CREATE\s+(?:UNIQUE\s+)?(?:TABLE|INDEX|TRIGGER|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"[]?(\w+)/gi,
    )].map((m) => m[1]),
  );
}

/**
 * Compare what the database actually has against what the committed snapshot
 * says it has.
 *
 * Deterministic and total: the result depends only on the two inputs, so the
 * same repository state always produces the same observation. Both directions
 * are drift — an object the snapshot omits means it was not regenerated after a
 * migration, and an object it describes that does not exist means it describes
 * a schema this database is not running.
 */
export function compareSchemaToSnapshot(input: {
  liveObjectNames: Iterable<string>; snapshotSql: string;
}): { result: 'passed' | 'failed'; detail: string } {
  const live = new Set(input.liveObjectNames);
  const described = snapshotObjectNames(input.snapshotSql);
  const undescribed = [...live].filter((n) => !described.has(n)).sort();
  const phantom = [...described].filter((n) => !live.has(n)).sort();

  if (!undescribed.length && !phantom.length) {
    return {
      result: 'passed',
      detail: `${live.size} schema objects, all described by ${SNAPSHOT_PATH}`,
    };
  }
  // The detail carries the specific objects, so the observation is auditable
  // rather than a bare assertion that something is wrong. Bounded, because an
  // observation is evidence and not a report.
  const parts: string[] = [];
  if (undescribed.length) {
    parts.push(`${undescribed.length} object(s) exist but are not in the snapshot: ${undescribed.slice(0, 10).join(', ')}`);
  }
  if (phantom.length) {
    parts.push(`${phantom.length} object(s) in the snapshot do not exist: ${phantom.slice(0, 10).join(', ')}`);
  }
  return { result: 'failed', detail: parts.join('; ') };
}

export type SelfObservationOutcome =
  | { observed: false; reason: 'identity_not_established' | 'snapshot_unreadable' }
  | { observed: true; productId: string; observation: DevelopmentObservation; result: 'passed' | 'failed' };

/**
 * Observe one true fact about Foundry's own repository and record it as
 * ordinary canonical evidence.
 *
 * Identity is resolved here and nowhere deeper. If it has never been
 * established this declines rather than guessing at a company — absence is
 * unknown, not a fallback, and an observation attributed to the wrong product
 * would be worse than no observation at all.
 */
export async function observeFoundryRepositoryReality(input: {
  repositoryRoot?: string; observedAt?: Date;
} = {}): Promise<SelfObservationOutcome> {
  const productId = await resolveFoundryProductId();
  if (!productId) return { observed: false, reason: 'identity_not_established' };

  let snapshotSql: string;
  try {
    snapshotSql = readFileSync(resolve(input.repositoryRoot ?? process.cwd(), SNAPSHOT_PATH), 'utf8');
  } catch {
    // A snapshot that cannot be read is not a failing check. Reporting "drift"
    // when the evidence could not be gathered would be manufacturing a fact.
    return { observed: false, reason: 'snapshot_unreadable' };
  }

  const live = (await query(
    "SELECT name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' AND name<>''",
  )).rows as unknown as Array<Record<string, unknown>>;

  const { result, detail } = compareSchemaToSnapshot({
    liveObjectNames: live.map((r) => String(r.name)), snapshotSql,
  });

  // Ordinary intake, ordinary product id. This module hands over a plain string
  // and the institution has no way to learn where it came from.
  const observation = await recordDevelopmentObservation({
    productId, check: SCHEMA_SNAPSHOT_CHECK, result, detail, observedAt: input.observedAt,
  });
  // The observation is the evidence the proposal cites, so it is recorded
  // first and the proposal cannot exist without it. A proposal that fails does
  // not lose the observation: evidence is the thing that must survive.
  await proposeSelfMaintenanceCandidate({
    productId, check: SCHEMA_SNAPSHOT_CHECK, evidenceId: observation.id,
    observedAt: input.observedAt ?? new Date(),
  }).catch(() => { /* offering is not observing */ });
  return { observed: true, productId, observation, result };
}

// =============================================================================
// A SECOND OBSERVATION, TO FIND OUT WHETHER THIS PATH GENERALISES
//
// One recursive case is an anecdote. The machinery it feeds — expectation,
// comparison, verdict, what the founder is shown — was exercised by exactly one
// check, and a mechanism that has only ever run on one input has not been shown
// to be a mechanism. This is the second, chosen against the same bar the first
// one set rather than a lower one.
//
// WHAT IS OBSERVED. The ratchet baselines under `docs/db/` are committed
// descriptions of reality, exactly as the schema snapshot is: each line is a
// standing exemption naming a module, a source line, a table or a column. When
// the thing it names stops existing, the line becomes a permanent exemption for
// nothing — the ratchet's count can no longer reach zero by fixing anything,
// and a future reader is told an offender exists that does not.
//
// It is a real recurring obligation in this repository (deleting a module or a
// table strands its baseline entries), it is deterministic, it is already
// enforced externally by the gates themselves, and getting it wrong misleads a
// reader without changing any behaviour.
//
// WHAT IS NOT OBSERVED, AND WHY. `unguarded-route-baseline.txt` and
// `tenant-scope-baseline.txt` name ROUTES. Deciding whether a route still
// exists means enumerating the routes, which is what those scanners do — and a
// second copy of a detector, drifting from the first, is a defect this
// repository has already paid for. Only entries whose liveness is a plain
// existence question are checked here, and the rest are left to their gates.
// =============================================================================

export const BASELINE_LIVENESS_CHECK = 'ratchet-baseline-liveness';

export type BaselineEntryKind = 'module' | 'source_line' | 'table' | 'column';

export interface BaselineEntry { baseline: string; kind: BaselineEntryKind; value: string }

/** The baselines whose entries are existence questions, and what each names. */
export const LIVENESS_BASELINES: ReadonlyArray<{ path: string; kind: BaselineEntryKind }> = [
  { path: 'docs/db/unreachable-modules-baseline.txt', kind: 'module' },
  { path: 'docs/db/id-tiebreak-baseline.txt', kind: 'source_line' },
  { path: 'docs/db/integration-status-literals-baseline.txt', kind: 'source_line' },
  { path: 'docs/db/unread-tables-baseline.txt', kind: 'table' },
  { path: 'docs/db/unreferenced-tables-baseline.txt', kind: 'table' },
  { path: 'docs/db/write-only-columns-baseline.txt', kind: 'column' },
];

/** The entries a baseline file actually asserts: comments and blanks are not
 * exemptions, and treating them as ones would report drift that is not there. */
export function parseBaselineEntries(baseline: string, kind: BaselineEntryKind, contents: string): BaselineEntry[] {
  return contents.split('\n').map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((value) => ({ baseline, kind, value }));
}

/**
 * Which baselined exemptions no longer name anything that exists.
 *
 * Deterministic and total, like `compareSchemaToSnapshot`: the answer depends
 * only on the entries and the reality handed in, so the same repository state
 * always produces the same observation.
 *
 * `fileLines` maps a source path to its line count; a path absent from the map
 * is a file that is not there. A `source_line` entry is stale when its file is
 * gone OR when the file no longer reaches that line, because a line past the
 * end cannot be the offender the baseline recorded.
 */
export function compareBaselinesToReality(input: {
  entries: readonly BaselineEntry[];
  liveTables: Iterable<string>;
  liveColumns: Iterable<string>;
  fileLines: ReadonlyMap<string, number>;
}): { result: 'passed' | 'failed'; detail: string } {
  const tables = new Set(input.liveTables);
  const columns = new Set(input.liveColumns);

  const stale = input.entries.filter((entry) => {
    if (entry.kind === 'table') return !tables.has(entry.value);
    if (entry.kind === 'column') return !columns.has(entry.value);
    if (entry.kind === 'module') return !input.fileLines.has(entry.value);
    const at = entry.value.lastIndexOf(':');
    // An entry that does not carry a line is not a `source_line` entry at all.
    // Guessing which file it meant would invent an offender.
    if (at <= 0) return true;
    const path = entry.value.slice(0, at);
    const line = Number(entry.value.slice(at + 1));
    const lines = input.fileLines.get(path);
    return lines === undefined || !Number.isInteger(line) || line < 1 || line > lines;
  });

  if (!stale.length) {
    return {
      result: 'passed',
      detail: `${input.entries.length} baselined exemption(s) across ${LIVENESS_BASELINES.length} baselines all still name something that exists`,
    };
  }
  return {
    result: 'failed',
    detail: `${stale.length} baselined exemption(s) name something that no longer exists: `
      + stale.slice(0, 10).map((e) => `${e.baseline.split('/').pop()} → ${e.value}`).join(', '),
  };
}

export type BaselineLivenessOutcome =
  | { observed: false; reason: 'identity_not_established' | 'baselines_unreadable' }
  | { observed: true; productId: string; observation: DevelopmentObservation; result: 'passed' | 'failed' };

/**
 * Observe whether Foundry's own standing exemptions still describe its reality,
 * and record it as ordinary canonical evidence.
 *
 * Same shape as `observeFoundryRepositoryReality` in every respect that
 * matters: identity resolved here and nowhere deeper, no command run, no file
 * written, nothing repaired, and the observation handed to the same intake any
 * other company's evidence goes through.
 */
export async function observeFoundryBaselineLiveness(input: {
  repositoryRoot?: string; observedAt?: Date;
} = {}): Promise<BaselineLivenessOutcome> {
  const productId = await resolveFoundryProductId();
  if (!productId) return { observed: false, reason: 'identity_not_established' };

  const root = input.repositoryRoot ?? process.cwd();
  const entries: BaselineEntry[] = [];
  for (const baseline of LIVENESS_BASELINES) {
    let contents: string;
    try {
      contents = readFileSync(resolve(root, baseline.path), 'utf8');
    } catch {
      // Evidence that could not be gathered is not evidence of drift, exactly
      // as an unreadable snapshot is not a failing check.
      return { observed: false, reason: 'baselines_unreadable' };
    }
    entries.push(...parseBaselineEntries(baseline.path, baseline.kind, contents));
  }

  const tables = (await query(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  )).rows as unknown as Array<Record<string, unknown>>;
  const liveTables = tables.map((r) => String(r.name));

  const liveColumns: string[] = [];
  for (const table of liveTables) {
    const cols = (await query('SELECT name FROM pragma_table_info(?)', [table]))
      .rows as unknown as Array<Record<string, unknown>>;
    for (const col of cols) liveColumns.push(`${table}.${String(col.name)}`);
  }

  const fileLines = new Map<string, number>();
  for (const entry of entries) {
    if (entry.kind !== 'module' && entry.kind !== 'source_line') continue;
    const at = entry.value.lastIndexOf(':');
    const path = entry.kind === 'module' ? entry.value : (at > 0 ? entry.value.slice(0, at) : entry.value);
    if (fileLines.has(path)) continue;
    try {
      fileLines.set(path, readFileSync(resolve(root, path), 'utf8').split('\n').length);
    } catch { /* absent stays absent: the comparison reads a missing key as gone */ }
  }

  const { result, detail } = compareBaselinesToReality({ entries, liveTables, liveColumns, fileLines });

  const observation = await recordDevelopmentObservation({
    productId, check: BASELINE_LIVENESS_CHECK, result, detail, observedAt: input.observedAt,
  });
  // Silent for this check today, and deliberately so: it has no entry in
  // `SELF_MAINTENANCE_SCOPES`, so no grant could authorise the upkeep it
  // describes, and offering a responsibility Foundry could never be permitted
  // to carry would be the promise this whole path exists to avoid making.
  await proposeSelfMaintenanceCandidate({
    productId, check: BASELINE_LIVENESS_CHECK, evidenceId: observation.id,
    observedAt: input.observedAt ?? new Date(),
  }).catch(() => { /* offering is not observing */ });
  return { observed: true, productId, observation, result };
}
