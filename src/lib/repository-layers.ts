// =============================================================================
// FOUNDRY — three things that share one repository
//
// THE AMBIGUITY THE OWNER NAMED. "Foundry" refers to three different things,
// and they are not the same:
//
//   1. PRIVATE FOUNDRY — his permanent, single-owner institution. A running
//      deployment, with his companies in it.
//   2. THE FOUNDRY REPOSITORY — the source code that constitutes that
//      institution, and the shared capability any Foundry would need.
//   3. COMMERCIAL FOUNDRY — a product that does not exist, may never exist, and
//      would be a separate portfolio company with its own deployment.
//
// Private Foundry is about to begin developing its own source. Without this
// distinction, "make my company experience better" and "improve the product
// other people would buy" become the same commit, and the private owner
// experience quietly becomes the specification for a commercial product nobody
// decided to build.
//
// WHY A CLASSIFICATION AND NOT A REORGANISATION. Moving seventy directories
// would be a large, risky change that produces the same information this file
// produces, plus a month of merge pain. The owner's instruction was explicit:
// do not duplicate the kernel merely to create separation. What is needed is
// not different files — it is a DIRECTION OF DEPENDENCY that cannot be
// violated silently, and that is enforced by `scripts/check-layer-boundary.mjs`
// from exactly this table.
//
// THE ONE RULE THAT MATTERS: NOTHING MAY DEPEND ON `private`. The shared kernel
// cannot import the owner's experience, and neither can the commercial surface.
// So whatever a future Commercial Foundry consumes, it structurally cannot be
// "whatever Private Foundry happens to look like" — it can only be the kernel,
// deliberately.
// =============================================================================

export type Layer =
  /** The substrate: a database, a logger, a clock. Below everything, knows
   *  nothing about institutions, owners or customers. */
  | 'substrate'
  /** SHARED INSTITUTIONAL KERNEL. Authority, responsibility, evidence, effects,
   *  senses, provenance, spend governance, and the machinery of understanding
   *  and operating a company. Any Foundry — private or commercial — needs it.
   *  This is what a future Commercial Foundry would consume. */
  | 'kernel'
  /** PRIVATE FOUNDRY PRODUCT. The experience built for this owner, for a
   *  deployment with exactly one principal and no commercial relationship in
   *  it. Deliberately small, and deliberately depended upon by nothing. */
  | 'private'
  /** The product surface a commercial Foundry would START FROM: access
   *  metering, tiers, trials, the marketing site, and the older multi-tenant
   *  dashboard. PRESERVED, NOT DEVELOPED. Dormant optionality, per the owner's
   *  priority function — and if it ever earns existence it is originated as a
   *  separate portfolio company, not grown here by accident. */
  | 'commercial'
  /** The composition root: what assembles a deployment out of the above. It may
   *  reach anything, because choosing what a deployment contains is exactly its
   *  job; nothing may reach back into it. */
  | 'composition';

/**
 * WHO MAY DEPEND ON WHOM.
 *
 * Read as: a file in the key layer may import a file in any listed layer.
 * `private` appears in no list but its own — that is the point of the table.
 */
export const MAY_IMPORT: Record<Layer, Layer[]> = {
  substrate: ['substrate'],
  kernel: ['substrate', 'kernel'],
  private: ['substrate', 'kernel', 'private'],
  commercial: ['substrate', 'kernel', 'commercial'],
  composition: ['substrate', 'kernel', 'private', 'commercial', 'composition'],
};

/**
 * WHAT EACH PATH IS.
 *
 * Longest prefix wins, so a single file can be classified out of a directory
 * that is otherwise something else — which is how `foundry-shell.ts` is the
 * private product while the fifty-odd pages beside it are not.
 *
 * Every source path must match something. An unclassified file fails the gate,
 * which means a new directory forces a decision about what it IS rather than
 * defaulting into the kernel and quietly becoming part of what a commercial
 * product would inherit.
 */
export const LAYER_OF: Record<string, Layer> = {
  // ── substrate ──────────────────────────────────────────────────────────
  'src/db': 'substrate',
  'src/lib': 'substrate',
  'src/types': 'substrate',
  'src/env.ts': 'substrate',
  'src/prompts': 'substrate',
  'src/test': 'substrate',
  // NOT SUBSTRATE, MEASURED. Request-time infrastructure that reaches into the
  // institution: `auth` provisions a founder, `rbac` reads team membership and
  // owner intelligence. It decides who may act, which is an institutional
  // question, not plumbing.
  'src/middleware': 'kernel',

  // MEASURED, NOT ASSUMED. These four sit in substrate directories and are not
  // substrate: they reach into the institution to send a webhook, mint an
  // identity, or send account mail. Naming them here rather than loosening the
  // rule for all of `src/lib` keeps the exception the size of the fact.
  'src/lib/webhooks.ts': 'kernel',
  'src/lib/onboarding-emails.ts': 'kernel',
  'src/lib/mcp-registry.ts': 'kernel',
  'src/db/seed.ts': 'composition',

  // ── composition ────────────────────────────────────────────────────────
  'src/index.ts': 'composition',
  'src/jobs': 'composition',
  'src/cli': 'composition',
  'src/mcp/cli.ts': 'composition',

  // ── the private owner product ──────────────────────────────────────────
  //
  // SURFACES, NOT CAPABILITIES — and the boundary taught me the difference
  // rather than the other way round.
  //
  // `what-situation.ts` and `what-the-numbers-say.ts` were classified here
  // first, because they read a company in words written for this owner. Then
  // `situation-chain.ts` — remembering a diagnosis so that duration, outcome
  // and learning become possible — needed to call one, and the gate refused it.
  // Correctly: a kernel that imports the owner's experience is the exact tangle
  // the rule exists to prevent, and the refusal forced the question of what
  // those files actually ARE.
  //
  // They are capabilities. Diagnosing what situation a company is in, and
  // saying what its numbers did, is something any Foundry would want; only the
  // three-place shell that renders them is this owner's. The line is SURFACES
  // versus CAPABILITIES, and it stays small because most of what makes Private
  // Foundry valuable is the institution, not the interface.
  'src/routes/dashboard/foundry-shell.ts': 'private',
  // The addresses under the owner's places: company dimensions, the work
  // behind a claim, decisions, the search. Built on the shell, so it is the
  // shell's product too.
  'src/routes/dashboard/places.ts': 'private',
  // THE DOOR THE SHELL LIVES BEHIND, and therefore part of the same product.
  // The Attention Law forbids a new top-level mount, so the shell is mounted
  // inside the Letter — which makes `letter.ts` the composition root for the
  // private surface as well as the owner surface the shell is absorbing. A
  // commercial Foundry would not inherit it; it would build its own.
  'src/routes/dashboard/letter.ts': 'private',

  // ── dormant commercial ─────────────────────────────────────────────────
  //
  // Access metering and the older multi-tenant surface. Preserved because a
  // private institution operates businesses that bill their own customers, and
  // one of those may one day be a commercial Foundry — but not developed, and
  // nothing new may be built on it.
  'src/services/billing': 'commercial',
  'src/routes/public/landing.ts': 'commercial',
  'src/routes/dashboard/agents': 'commercial',
  'src/routes/dashboard/beta.ts': 'commercial',
  'src/routes/dashboard/cohorts.ts': 'commercial',
  'src/routes/dashboard/koldly.ts': 'commercial',
  'src/routes/dashboard/investors.ts': 'commercial',
  'src/routes/dashboard/board-packet.ts': 'commercial',
  'src/routes/dashboard/journey.ts': 'commercial',
  'src/routes/dashboard/onboarding.ts': 'commercial',
  'src/routes/dashboard/plan.ts': 'commercial',

  // ── everything else is the shared institutional kernel ─────────────────
  'src/routes': 'kernel',
  'src/services': 'kernel',
  'src/views': 'kernel',
  'src/api': 'kernel',
  'src/mcp': 'kernel',
  'src/public': 'kernel',
};

/** The layer a source path belongs to, by longest matching prefix. */
export function layerOf(path: string): Layer | null {
  const normalised = path.replace(/\\/g, '/');
  let best: { prefix: string; layer: Layer } | null = null;
  for (const [prefix, layer] of Object.entries(LAYER_OF)) {
    const matches = normalised === prefix || normalised.startsWith(`${prefix}/`)
      // `src/routes/dashboard/agents` also covers `agents-okr.ts`, because the
      // old dashboard names its pages with a prefix rather than a folder.
      || normalised.startsWith(prefix);
    if (!matches) continue;
    if (!best || prefix.length > best.prefix.length) best = { prefix, layer };
  }
  return best ? best.layer : null;
}

/**
 * What to tell the owner about a change to this path.
 *
 * This is the point of the whole file. When Foundry proposes changing its own
 * source, he should not have to know the directory layout to understand what
 * he is agreeing to — he should be told whether this is his own experience,
 * the shared institution, or something dormant.
 */
export const LAYER_IN_PLAIN_WORDS: Record<Layer, string> = {
  substrate:
    'the plumbing underneath everything — a database, a logger. Changing it '
    + 'affects your institution and anything ever built from this repository.',
  kernel:
    'the shared institution — how responsibility, authority, evidence and '
    + 'effects work. It is what makes your Foundry work, and it is what any '
    + 'future Foundry would be built from.',
  private:
    'your own experience of Foundry, and nothing else. Nothing depends on it, '
    + 'so changing it cannot change how the institution behaves for anyone.',
  commercial:
    'the dormant remains of a product for other people. It is kept, not '
    + 'developed, and nothing new is built on it.',
  composition:
    'the wiring that assembles this deployment — which routes exist, which '
    + 'routines run.',
};
