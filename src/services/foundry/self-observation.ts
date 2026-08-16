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
  return { observed: true, productId, observation, result };
}
