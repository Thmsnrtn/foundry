// =============================================================================
// FOUNDRY — shared pieces for the four campaign simulations in this directory.
//
// Nothing here is a test. It holds what the four files would otherwise each
// carry a copy of: the findings ledger, a runner that mirrors the scheduler's
// own `runScheduledJob` (which `src/index.ts` does not export), a classifier
// that tells a governed refusal from a code defect, and a Stripe signature
// built the way Stripe builds one.
// =============================================================================
import { createHmac } from 'node:crypto';
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';

// Outputs never land in the source tree: a test that writes beside itself
// dirties every checkout that runs it. CAMPAIGN_OUT overrides the default.
export const CAMPAIGN_OUT = process.env.CAMPAIGN_OUT ?? resolve(tmpdir(), 'foundry-campaign');
mkdirSync(CAMPAIGN_OUT, { recursive: true });
export const FINDINGS_PATH = resolve(CAMPAIGN_OUT, 'findings.jsonl');

export interface Finding { id: string; sev: 'P0' | 'P1' | 'P2' | 'P3'; area: string; title: string; evidence: string }

/**
 * A finding goes to stdout as a `FINDING:` line and to the ledger once: a
 * second run of the same file must not write the same id twice.
 */
export function recordFinding(f: Finding): void {
  process.stdout.write(`FINDING: [${f.id}] [${f.sev}] ${f.area} — ${f.title} :: ${f.evidence}\n`);
  try {
    const have = existsSync(FINDINGS_PATH) ? readFileSync(FINDINGS_PATH, 'utf8') : '';
    if (have.split('\n').some((line) => { try { return (JSON.parse(line) as { id?: string }).id === f.id; } catch { return false; } })) return;
    appendFileSync(FINDINGS_PATH, `${JSON.stringify(f)}\n`);
  } catch (e) {
    process.stdout.write(`(could not append the finding: ${e instanceof Error ? e.message : String(e)})\n`);
  }
}

export interface RunOutcome {
  job: string;
  /** 'ok' ran and resolved; 'refused' threw for a governed reason; 'defect' threw for a reason that is a code defect; 'locked' the lock was held. */
  state: 'ok' | 'refused' | 'defect' | 'locked';
  errorName: string | null;
  message: string | null;
  ms: number;
}

/**
 * GOVERNED REASONS: an absent key, a company not entitled, a ceiling, a
 * provider the deployment has not configured, a stop the owner asked for. A
 * routine that throws one of these has refused, which is what it should do.
 * Anything else — a TypeError, a SQL error, an undefined read — is a defect.
 */
const GOVERNED = [
  /OPENROUTER_API_KEY|ANTHROPIC_API_KEY/i, /not configured|notConfigured|is required|required\b/i,
  /NotEntitled|not entitled|SpendCeiling|ceiling reached/i, /ModelDoorError|model door/i,
  /no (key|credential|secret)/i, /refused|paused|not allowed|disabled/i, /STRIPE_SECRET_KEY|CLOUDFLARE_/i,
  /unexpected network call in rehearsal/i, /no charter/i,
];
const DEFECT_NAMES = new Set(['TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'LibsqlError', 'SqliteError']);

export function classifyFailure(err: unknown): { state: 'refused' | 'defect'; errorName: string; message: string } {
  const errorName = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  if (DEFECT_NAMES.has(errorName) || /SQLITE_|no such (table|column)|is not a function|of undefined|of null|Cannot read/i.test(message)) {
    return { state: 'defect', errorName, message };
  }
  if (err instanceof Error && ['NotEntitledError', 'SpendCeilingError', 'ModelDoorError', 'HandRefused', 'WorkshopRefused'].includes(errorName)) {
    return { state: 'refused', errorName, message };
  }
  return { state: GOVERNED.some((re) => re.test(message)) ? 'refused' : 'defect', errorName, message };
}

/**
 * ONE RUN OF A ROUTINE, EXACTLY AS THE SCHEDULER RUNS IT: acquire the job lock,
 * run, record success or failure in `job_health`, release. `runScheduledJob`
 * in `src/index.ts` is not exported, so this is its mirror; the lock, the
 * registry and the health record are the real ones.
 */
export async function runUnderLock(job: string): Promise<RunOutcome> {
  const { JOB_REGISTRY } = await import('../../../src/jobs/index.js');
  const { acquireJobLock, releaseJobLock } = await import('../../../src/services/job-lock.js');
  const { recordJobFailure, recordJobSuccess } = await import('../../../src/services/institution/loop-health.js');
  const entry = JOB_REGISTRY[job];
  if (!entry) throw new Error(`no such routine: ${job}`);
  const t0 = Date.now();
  if (!(await acquireJobLock(job))) return { job, state: 'locked', errorName: null, message: null, ms: Date.now() - t0 };
  try {
    await entry.fn();
    await recordJobSuccess(job).catch(() => undefined);
    return { job, state: 'ok', errorName: null, message: null, ms: Date.now() - t0 };
  } catch (err) {
    await recordJobFailure(job, err).catch(() => undefined);
    const c = classifyFailure(err);
    return { job, state: c.state, errorName: c.errorName, message: c.message, ms: Date.now() - t0 };
  } finally {
    await releaseJobLock(job);
  }
}

/**
 * A STRIPE SIGNATURE, AS STRIPE SIGNS: `t=<unix seconds>,v1=<hex HMAC-SHA256
 * over "<t>.<payload>" with the endpoint secret>`. The SDK's verifier
 * (`constructEvent`) recomputes exactly this and refuses a timestamp older
 * than its tolerance (300 s by default).
 */
export function stripeSignature(payload: string, secret: string, at: number = Math.floor(Date.now() / 1000)): string {
  const v1 = createHmac('sha256', secret).update(`${String(at)}.${payload}`).digest('hex');
  return `t=${String(at)},v1=${v1}`;
}

/** A first-run style matrix line for one routine across the days: one glyph per day. */
export const GLYPH: Record<RunOutcome['state'], string> = { ok: '.', refused: 'R', defect: 'X', locked: 'L' };
