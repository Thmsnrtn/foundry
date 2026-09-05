// =============================================================================
// FOUNDRY — repository truth is not deployed truth is not observed truth
//
// THE FAILURE THIS EXISTS TO PREVENT, WHICH ALREADY HAPPENED.
//
// The institution reported that a decision was live on the owner's first
// screen. The branch contained it, the chain was green, the commit was pushed
// — and production was running a build from the previous evening, because
// deploys fire on a marker in the commit message and none of those commits
// carried one. The owner opened the product and found a version of it with no
// such decision anywhere.
//
// Nothing in that sentence was a lie. It was a claim about ONE KIND OF TRUTH
// stated as a claim about ANOTHER, and there was no mechanism anywhere that
// could tell them apart:
//
//   REPOSITORY TRUTH   what the code says, here, now. Cheap to establish and
//                      the only one a test can reach on its own.
//   DEPLOYED TRUTH     which commit is actually running where the owner goes.
//                      Establishable only by asking the running thing.
//   OBSERVED TRUTH     what the owner actually meets when he opens it. Needs
//                      his session; frequently NOT establishable from here,
//                      and saying so is part of the job.
//
// SO NOTHING HERE INFERS. Every function asks the deployed artifact and returns
// what it said, or says it could not tell. The one thing this module will never
// do is answer a question about production from the state of the repository.
// =============================================================================

import { safeFetch } from '../outbound/ssrf.js';

/** Where the owner actually goes. */
const PRODUCTION = 'https://foundry-intel.fly.dev';
const TIMEOUT_MS = 20_000;

export interface WhatIsRunning {
  /** The commit production reported. Null when it could not be established. */
  commit: string | null;
  /** Present when nothing could be established, in plain words. */
  couldNotTell: string | null;
  status: string | null;
  storage: string | null;
}

/**
 * ASK PRODUCTION WHICH COMMIT IT IS.
 *
 * 'unknown' comes back from an image built outside the deploy path, and is
 * reported as a failure to establish rather than as a commit — a build that
 * cannot identify itself is exactly the state that caused this.
 */
export async function whatProductionIsRunning(
  base: string = PRODUCTION,
): Promise<WhatIsRunning> {
  let res;
  try {
    res = await safeFetch(`${base}/internal/health`, {
      method: 'GET', signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (err) {
    return couldNotTell(
      `production did not answer: ${err instanceof Error ? err.message : String(err)}`);
  }
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return readHealthReport(res.status, body);
}

const couldNotTell = (why: string): WhatIsRunning =>
  ({ commit: null, couldNotTell: why, status: null, storage: null });

/**
 * WHAT A HEALTH REPORT ACTUALLY ESTABLISHES.
 *
 * Separated from the fetch because this is the part that can be wrong in a way
 * that matters. A socket either opens or it does not; the interpretation is
 * where "it answered" quietly becomes "it is running my code", and that is the
 * step this institution has already got wrong once.
 */
export function readHealthReport(status: number, body: unknown): WhatIsRunning {
  if (status !== 200 && status !== 503) {
    return couldNotTell(
      `production answered HTTP ${String(status)} rather than a health report`);
  }
  if (body === null || typeof body !== 'object') {
    return couldNotTell('production answered with something that is not a health report');
  }
  const b = body as Record<string, unknown>;
  const reported = typeof b.status === 'string' ? b.status : null;
  const storage = typeof b.storage === 'string' ? b.storage : null;
  const commit = typeof b.commit === 'string' ? b.commit : '';
  // A BUILD THAT CANNOT NAME ITSELF HAS NOT ANSWERED THE QUESTION. 'unknown'
  // comes from an image built outside the deploy path, and it is exactly the
  // state in which branch truth and deployed truth become indistinguishable —
  // so it must never read as a commit.
  if (commit === '' || commit === 'unknown') {
    return {
      commit: null,
      couldNotTell: 'production is running a build that cannot say which commit it is, '
        + 'which is the state that makes branch truth and deployed truth indistinguishable',
      status: reported, storage,
    };
  }
  return { commit, couldNotTell: null, status: reported, storage };
}

export interface DeployedStanding {
  /** True only when production named this exact commit. */
  isRunningThis: boolean;
  runningCommit: string | null;
  askedAbout: string;
  /** The sentence to use instead of the word "live". */
  says: string;
}

/**
 * IS WHAT I HAVE HERE WHAT IS RUNNING THERE?
 *
 * The question the institution could not previously ask, and the reason it
 * described a branch as a product. `says` is written to be quoted directly, so
 * a report has an accurate sentence available and does not have to compose one
 * from a boolean and some optimism.
 */
export async function isThisDeployed(
  commit: string, base: string = PRODUCTION,
): Promise<DeployedStanding> {
  return standingFrom(commit, await whatProductionIsRunning(base));
}

/** The comparison itself, which is the part worth being sure about. */
export function standingFrom(commit: string, running: WhatIsRunning): DeployedStanding {
  const short = commit.slice(0, 7);
  if (running.commit === null) {
    return {
      isRunningThis: false, runningCommit: null, askedAbout: commit,
      says: `I cannot tell what production is running, so I cannot say ${short} is `
        + `deployed — ${running.couldNotTell ?? 'no reason given'}`,
    };
  }
  if (running.commit !== commit) {
    return {
      isRunningThis: false, runningCommit: running.commit, askedAbout: commit,
      says: `production is running ${running.commit.slice(0, 7)}, not ${short}. `
        + 'Whatever is in this commit and not in that one is not something the '
        + 'owner can see',
    };
  }
  return {
    isRunningThis: true, runningCommit: running.commit, askedAbout: commit,
    says: `production is running ${short}. What the owner meets on top of it is a `
      + 'separate question, and needs his session rather than this one',
  };
}
