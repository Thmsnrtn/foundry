// =============================================================================
// FOUNDRY - what Foundry itself is built on, checked against the real world
//
// The first genuinely REAL research need this institution has of its own. Not a
// harness and not a rehearsal: Foundry is a company in the portfolio, the
// packages it runs on are a real provider dependency, and whether anybody is
// still maintaining them is a real question about a real asset that a public
// registry can honestly answer.
//
// IT EXISTS SO THE REALITY PROOF IS EARNED RATHER THAN STAGED. A capability
// becomes reality-proven when the institution performed its intended work and
// the result was checked - so the institution needs work of its own to do. This
// is that work, and it would be worth doing even if no capability needed
// proving.
//
// WHAT IT IS NOT. It is not a security audit, a licence check, or a judgement
// about whether a package is good. It answers one question - is anybody still
// publishing this - and the claim it forms says so.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { query } from '../../db/client.js';
import { formClaim, observe } from '../venture/market-evidence.js';
import { packageRecord } from '../venture/sources/npm-registry.js';

/** Eighteen months, the same line the venture research draws. */
const MAINTAINED_DAYS = 548;

/**
 * The direct dependencies, from the manifest rather than the lock file: what
 * Foundry chose to depend on, not the whole transitive world. A thousand
 * transitive packages would be a different and much less answerable question.
 */
export function directDependencies(root = process.cwd()): string[] {
  try {
    const manifest = JSON.parse(
      readFileSync(resolve(root, 'package.json'), 'utf8')) as {
        dependencies?: Record<string, string>;
      };
    return Object.keys(manifest.dependencies ?? {}).sort();
  } catch {
    return [];
  }
}

export interface DependencyHealth {
  claimId: string;
  checked: number;
  abandoned: string[];
  /** What the institution can say about itself now that it could not before. */
  sentence: string;
}

/**
 * ASK THE REGISTRY ABOUT EVERY PACKAGE FOUNDRY RUNS ON.
 *
 * One claim, many observations. Each package that is still being published to
 * supports it; each one that has gone quiet contradicts it, by name and date.
 * The claim is real, so the observations are real, so the evidence mode is
 * real - and a rehearsal could not produce any of it.
 */
export async function checkOwnDependencies(input: {
  founderId: string; limit?: number; root?: string;
}): Promise<DependencyHealth | null> {
  const names = directDependencies(input.root).slice(0, input.limit ?? 12);
  if (names.length === 0) return null;

  const claimId = await formClaim({
    founderId: input.founderId, evidenceMode: 'real',
    claim: 'Every package Foundry runs on is still being maintained',
  });

  const abandoned: string[] = [];
  let checked = 0;
  for (const name of names) {
    const record = await packageRecord(name);
    if (record === null) continue;
    checked += 1;
    const age = record.lastPublished === null ? Infinity
      : (Date.now() - new Date(record.lastPublished).getTime()) / 86_400_000;
    const quiet = !(age <= MAINTAINED_DAYS);
    if (quiet) abandoned.push(name);
    await observe({
      founderId: input.founderId, claimId, sourceType: 'directory',
      source: record.url,
      saw: `${name} was last published ${record.lastPublished?.slice(0, 10) ?? 'never'}`
        + `${quiet ? ', which is more than eighteen months ago' : ''}`,
      bearing: quiet ? 'contradicts' : 'supports',
      directness: 'direct', observedAt: record.observedAt, evidenceMode: 'real',
    });
  }
  if (checked === 0) return null;

  return {
    claimId, checked, abandoned,
    sentence: abandoned.length === 0
      ? `All ${String(checked)} packages I run on have been published to within `
        + 'eighteen months.'
      : `${String(abandoned.length)} of the ${String(checked)} packages I run on have `
        + `not been published to in eighteen months: ${abandoned.join(', ')}. That is a `
        + 'dependency nobody is looking after, which is a risk to this company rather '
        + 'than a fault in it.',
  };
}

/**
 * A QUIET PACKAGE IS NOT THE SAME AS A BROKEN ONE.
 *
 * The registry can say nobody has published to something in eighteen months. It
 * cannot say whether that matters — a small, finished library nobody needs to
 * touch looks identical to one that has been abandoned mid-problem. That
 * distinction is the difference between a risk worth acting on and a false
 * alarm, and only people talking about it can draw it.
 *
 * SO THIS ONLY RUNS WHEN REALITY PRODUCES THE NEED. If nothing Foundry depends
 * on has gone quiet, there is nothing here to ask, and the community capability
 * stays unproven — which is the honest state. Manufacturing a question so a
 * capability could earn a proof would be staging exactly what the proof is
 * supposed to rule out.
 */
export async function askAboutQuietDependencies(input: {
  founderId: string; claimId: string; abandoned: string[];
}): Promise<{ asked: number; sentences: string[] }> {
  if (input.abandoned.length === 0) return { asked: 0, sentences: [] };
  const { askWhatPeopleSay } = await import('../venture/sources/index.js');
  const sentences: string[] = [];
  let asked = 0;
  for (const name of input.abandoned.slice(0, 3)) {
    const said = await askWhatPeopleSay({
      founderId: input.founderId, claimId: input.claimId,
      terms: `${name} package`,
      // A quiet package that people are still discussing is one where the
      // silence is a warning; one nobody mentions is probably just finished.
      supportsIf: 'nobody_mentions_it',
      alsoCouldBeCalled: [name.replace(/[@/]/g, ' ').trim()],
    });
    asked += 1;
    sentences.push(`${name}: ${said.sentence}`);
  }
  return { asked, sentences };
}

/**
 * THE PROOF, CHECKED RATHER THAN ASSUMED.
 *
 * A call that did not throw is not evidence that a capability works. This reads
 * back what the work actually left behind - real observations, on a real claim,
 * each naming a source that could be visited - and only then is there anything
 * to witness. The check is deliberately about the RESULT, not the call.
 */
export async function verifyRealEvidenceLanded(claimId: string): Promise<{
  ok: boolean; observations: number; sources: number; because: string;
}> {
  const rows = (await query(
    `SELECT source, evidence_mode, directness FROM market_observations
      WHERE claim_id = ?`, [claimId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const real = rows.filter((r) => String(r.evidence_mode) === 'real');
  const sources = new Set(real.map((r) => String(r.source)));
  const direct = real.filter((r) => String(r.directness) === 'direct').length;

  if (real.length === 0) {
    return { ok: false, observations: 0, sources: 0,
      because: 'the call returned but left no real observation behind' };
  }
  if (direct === 0) {
    return { ok: false, observations: real.length, sources: sources.size,
      because: 'nothing was seen directly - everything was worked out, which a '
        + 'registry read should never be' };
  }
  if (![...sources].every((s) => s.startsWith('https://'))) {
    return { ok: false, observations: real.length, sources: sources.size,
      because: 'an observation names a source nobody could go and visit' };
  }
  return {
    ok: true, observations: real.length, sources: sources.size,
    because: `${String(direct)} direct observations across ${String(sources.size)} `
      + 'addresses that can each be visited',
  };
}
