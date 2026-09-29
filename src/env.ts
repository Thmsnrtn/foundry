// =============================================================================
// FOUNDRY — Environment validation, in one place
//
// THERE WERE THREE OF THESE AND TWO OF THEM RAN.
//
//   `src/env.ts`      — this file. `validateEnvironment()`, called from
//                       `index.ts` at boot. Its fatal set was the database and
//                       Clerk; AN AI KEY WAS OPTIONAL. It never mentioned
//                       `ENCRYPTION_KEY`. It ended by printing
//                       "✓ Environment validated".
//   `src/index.ts`    — a second, inline pair of lists a few lines after the
//                       call. Same three fatal PLUS an AI key, and a degraded
//                       list naming the consequence of each absence.
//   `src/lib/env.ts`  — a zod schema nothing imported. It required
//                       `STRIPE_SECRET_KEY` and `ANTHROPIC_API_KEY` with no
//                       OpenRouter alternative, so a deployment on OpenRouter
//                       would have been refused boot; it omitted
//                       `ENCRYPTION_KEY`; and it named
//                       `STRIPE_FOUNDING_COHORT_PRICE_ID` and
//                       `STRIPE_SCALE_PRICE_ID`, two tiers no code reads.
//
// The disagreement was visible in the boot log and nobody had to read code to
// see it: on a deployment with no AI key at all, this file printed
// "✓ Environment validated" and the block below it then printed "FATAL:
// required config missing". The tick was false at the moment it was printed,
// and outside production the fatal line only warns — so what an operator took
// away from a broken boot was a green tick.
//
// One list now, and the tick is printed only when nothing fatal is missing.
// The fatal/degraded distinction and the CONSEQUENCE text come from the
// `index.ts` version, which was the better of the two: "missing" is not
// information, "billing/checkout disabled" is.
// =============================================================================

/** A requirement satisfied by any one of `names`. Alternatives exist because
 *  the AI gateway is either OpenRouter or Anthropic and either will do. */
export interface EnvRequirement {
  names: string[];
  consequence: string;
}

/** Absent, the app cannot function. */
export const FATAL_ENV: EnvRequirement[] = [
  { names: ['TURSO_DATABASE_URL'], consequence: 'no database — nothing works' },
  { names: ['CLERK_SECRET_KEY'], consequence: 'no authentication — nobody can sign in' },
  { names: ['CLERK_PUBLISHABLE_KEY'], consequence: 'no authentication — nobody can sign in' },
  {
    names: ['OPENROUTER_API_KEY', 'ANTHROPIC_API_KEY'],
    consequence: 'no AI gateway — Foundry is an AI product, so no key is no product',
  },
  // FATAL SINCE 29 SEPTEMBER 2026, AND ONLY AFTER PRODUCTION SHOWED IT PRESENT.
  // It was "degraded": stored credentials fell back to the Clerk secret, and
  // contributor hashes fell back to a literal written in this repository. The
  // literal is gone (contributorHash refuses without the key), the Etsy app
  // credential cannot be encrypted without it, and /internal/health reported
  // `encryption_key: ok` on commit 842cc167 before this line was written — a
  // boot that exits on a single machine is an outage, so the presence was
  // observed first, never assumed.
  {
    names: ['ENCRYPTION_KEY'],
    consequence: 'stored credentials cannot be encrypted or read, and no contributor can be hashed',
  },
];

/** Absent, a named thing stops working and the rest of the app runs. */
export const DEGRADED_ENV: EnvRequirement[] = [
  { names: ['TURSO_AUTH_TOKEN'], consequence: 'a remote Turso database cannot be reached' },
  { names: ['CLERK_WEBHOOK_SECRET'], consequence: 'the Clerk webhook endpoint is disabled' },
  { names: ['OLD_ENCRYPTION_KEY'], consequence: 'credentials written under a previous key cannot be read' },
  // Foundry's own subscription prices went with its billing (Private S7b1,
  // 29 September 2026). Stripe stays for the experiments' sales.
  { names: ['STRIPE_SECRET_KEY'], consequence: "an experiment's Stripe fees and refunds cannot be read" },
  { names: ['STRIPE_WEBHOOK_SECRET'], consequence: "an experiment's Stripe sales will not be recorded" },
  { names: ['RESEND_API_KEY'], consequence: 'all outbound email is logged rather than sent' },
  { names: ['RESEND_FROM_ADDRESS'], consequence: 'outbound email has no from address' },
  { names: ['APP_URL'], consequence: 'links in email and OAuth redirects point at localhost' },
  // GITHUB_CLIENT_ID AND GITHUB_CLIENT_SECRET WENT WITH THE OAUTH ROUND TRIP.
  // Their only reader was the onboarding wizard's `/onboarding/github/callback`
  // — the step that exchanged a code for a token so a stranger's repository
  // could be audited. That wizard is deleted. A name listed here that nothing
  // reads is a startup check reporting on a capability the process does not
  // have, which is the exact failure this file was written to end.
  { names: ['ECOSYSTEM_SERVICE_KEY'], consequence: 'internal ecosystem endpoints refuse every caller' },
  { names: ['SENTRY_DSN'], consequence: 'error tracking falls back to stderr only' },
];

export interface EnvVerdict {
  fatalMissing: string[];
  degradedMissing: Array<{ name: string; consequence: string }>;
}

const label = (r: EnvRequirement): string => r.names.join(' or ');

/** Read the environment and say what is missing. Pure — it decides nothing
 *  about the process, which is what makes it testable. */
export function inspectEnvironment(env: NodeJS.ProcessEnv = process.env): EnvVerdict {
  const present = (r: EnvRequirement): boolean => r.names.some((n) => Boolean(env[n]));
  return {
    fatalMissing: FATAL_ENV.filter((r) => !present(r)).map(label),
    degradedMissing: DEGRADED_ENV.filter((r) => !present(r))
      .map((r) => ({ name: label(r), consequence: r.consequence })),
  };
}

/**
 * Validate at boot. Exits in production when something fatal is missing; warns
 * and continues elsewhere, because a developer without a Stripe key should
 * still be able to run the app.
 */
export function validateEnvironment(env: NodeJS.ProcessEnv = process.env): EnvVerdict {
  const verdict = inspectEnvironment(env);

  for (const d of verdict.degradedMissing) {
    console.warn(`⚠️  ${d.name} is not set — ${d.consequence}`);
  }

  if (verdict.fatalMissing.length > 0) {
    const detail = FATAL_ENV
      .filter((r) => verdict.fatalMissing.includes(label(r)))
      .map((r) => `  ${label(r)} — ${r.consequence}`)
      .join('\n');
    const msg = `FATAL: required config missing —\n${detail}`;
    console.error(`\n❌ ${msg}\n`);
    // A misconfigured boot must fail visibly in production rather than serve a
    // half-working app.
    if (env.NODE_ENV === 'production') process.exit(1);
    console.warn('[STARTUP] continuing in non-production with the above missing');
    return verdict;
  }

  // ONLY HERE. The tick used to print regardless of what the second list found.
  console.log('✓ Environment validated');
  return verdict;
}
