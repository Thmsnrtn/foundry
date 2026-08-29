#!/usr/bin/env node
// =============================================================================
// FOUNDRY — Public-claims audit (Ascent A3 / Honesty Law)
//
// Verifies the landing/pricing page's factual claims against sources DERIVED
// FROM CODE, so marketing copy cannot drift from what the product actually is.
// Contract: when public copy changes, CLAIMS[] updates in the same commit.
// Fails CI on any unverifiable claim. The engine is the floor, not the ceiling.
// =============================================================================
import { readFileSync, readdirSync } from 'fs';
import { globSync } from 'glob';
import { tokenizeClaim } from './lib/claim-tokenizer.mjs';

// The claims currently made on public surfaces (landing.ts / legal.ts).
const CLAIMS = [
  'Solo plan costs $79/month',
  'Growth plan costs $199/month',
  'Investor-Ready plan costs $399/month',
  'All plans include 12 AI agents',
  '14-day trial',
  '30 founding-rate slots locked at $79/mo for life',
  // CAPABILITY CLAIMS, not only prices. A wrong number is embarrassing; a
  // capability a customer pays for and does not get is selling maturity the
  // product has not earned. Both of these were overclaims found by tracing the
  // pipeline to its last step: the remediation engine generated fixes and
  // never opened a pull request, and nothing anywhere wrote a golden lesson.
  'Remediation Engine — AI-drafted fixes for blocking audit issues',
  'Agent evolution — versioned configs and change history',
  // The processors that actually receive prompt content. Named in the privacy
  // copy and pinned to the endpoints the code calls.
  'Prompts are sent to language models through OpenRouter and OpenAI',
];

// ── Sources derived from code (single source of truth) ───────────────────────
const sources = [];

// Tier pricing as the app computes MRR with it.
const intel = readFileSync('src/services/founder/intelligence.ts', 'utf8');
const pricingLine = intel.match(/tierPricing[^\n]*\{[^}]*\}/)?.[0] ?? '';
sources.push({ name: 'src/services/founder/intelligence.ts tierPricing', content: pricingLine });

// Trial length as billing enforces it.
const stripe = readFileSync('src/services/billing/stripe.ts', 'utf8');
const trialLine = stripe.match(/TRIAL_PERIOD_DAYS[^\n]*/)?.[0] ?? '';
sources.push({ name: 'src/services/billing/stripe.ts TRIAL_PERIOD_DAYS', content: `${trialLine} trial day` });

// Agent roster as the SCP actually ships it (concrete agents, not scaffolding).
const scaffolding = new Set(['base.ts', 'challenger.ts', 'synthesizer.ts']);
const agents = readdirSync('src/services/scp/agents').filter((f) => f.endsWith('.ts') && !scaffolding.has(f));
sources.push({ name: 'src/services/scp/agents roster', content: `${agents.length} AI agents include plans: ${agents.join(' ')}` });

// Founding-slot mechanics as the pricing page computes them.
const landing = readFileSync('src/routes/public/landing.ts', 'utf8');
const slotsLine = landing.match(/Math\.max\(0,\s*30[^\n]*/)?.[0] ?? '';
sources.push({ name: 'src/routes/public/landing.ts founding slots', content: `${slotsLine} founding-rate slots locked life month cost` });

// ── Capability sources: does the code that performs the claim have a caller ──
//
// A price is verified against a constant. A CAPABILITY has to be verified
// against whether the last step of its pipeline actually runs, because the
// failure mode is a feature that is fully built except for the part that makes
// it happen — described everywhere by its readers, called by nothing.
//
// So the source's CONTENT depends on reality: restore a claim the code no
// longer supports and its words stop matching anything here. Proven by doing
// exactly that — "automated GitHub PRs" fails on `automated, github`.
const srcFiles = globSync('src/**/*.ts', { nodir: true });
const hasCallerOutside = (fnName, definedInSuffix) => srcFiles
  .filter((f) => !f.endsWith(definedInSuffix))
  .some((f) => readFileSync(f, 'utf8').includes(fnName));

// `openRemediationPR` is the only code that creates a branch, commits files and
// calls the GitHub PR API. `generateFix` runs, records the fix, and returns.
sources.push({
  name: 'remediation: does anything open a pull request',
  content: hasCallerOutside('openRemediationPR', 'audit/remediation.ts')
    ? 'remediation engine automated github pull requests prs ai-drafted ai drafted fixes for blocking audit issues'
    : 'remediation engine ai-drafted ai drafted fixes for blocking audit issues; no pull request is opened',
});

// `addGoldenLesson` is the only writer of `golden_suite`, and the only thing
// that increments `products.golden_suite_size`.
sources.push({
  name: 'agent evolution: does anything write a golden lesson',
  content: hasCallerOutside('addGoldenLesson', 'agents/base.ts')
    ? 'agent evolution golden lessons versioned configs and change history'
    : 'agent evolution versioned configs and change history',
});

// WHO RECEIVES A PROMPT, from the code that sends it.
//
// The privacy copy named Anthropic as the processor of every prompt and listed
// it as the sole AI sub-processor. `api.anthropic.com` appears nowhere in the
// repository: `client.ts` pins OpenRouter and `getBaseUrl()` returns it
// unconditionally — its own comment says a direct Anthropic key "still routes
// through OpenRouter" — and voice replies go to OpenAI. A privacy statement
// naming the wrong recipient is the one kind of copy where being wrong is not
// merely embarrassing.
//
// Pinned to the endpoints in the code, so the disclosure cannot name a vendor
// the product does not call.
const aiClient = readFileSync('src/services/ai/client.ts', 'utf8');
const voiceReply = readFileSync('src/services/scp/briefing/voice-reply.ts', 'utf8');
const endpoints = [];
if (aiClient.includes('openrouter.ai') || voiceReply.includes('openrouter.ai')) endpoints.push('openrouter');
if (voiceReply.includes('api.openai.com')) endpoints.push('openai');
if (aiClient.includes('api.anthropic.com') || voiceReply.includes('api.anthropic.com')) endpoints.push('anthropic');
sources.push({
  name: 'src/services/ai model endpoints actually called',
  content: `prompts are sent to language models through ${endpoints.join(' and ')} `
    + 'receives every prompt foundry sends to a language model voice replies',
});

// ── Verify ───────────────────────────────────────────────────────────────────
//
// The algorithm used to be inlined here as a copy of
// `src/services/truth/engine.ts`, and the two had drifted: this copy had no
// quoted-phrase handling and a different stop-word list, so the gate enforcing
// the honesty law and the module documenting it disagreed about what a claim
// says. `scripts/lib/claim-tokenizer.mjs` is now the one implementation, and
// `the-gate-and-the-engine-agree.test.ts` runs it against the TypeScript engine
// over the same inputs. Two copies are acceptable when they are pinned; tsconfig
// includes only `src/**`, so a .ts module cannot be imported from here and `src/`
// must not reach into `scripts/`.
//
// The stop list stays specific to pricing copy — 'plan', 'costs' and 'month' are
// connective words in these claims — and is PASSED IN rather than copied, so the
// difference is a decision rather than an accident.
const STOP = new Set(['the','a','an','and','or','for','with','that','this','all','plan','plans','costs','cost','month','monthly','include','includes']);
const tokenize = (claim) => tokenizeClaim(claim, STOP);
let failures = 0;

// Founder-facing claims are subject to the same honesty law as marketing.
// These phrases assert broad operation from an empty queue or one green state.
const forbiddenOperationalClaims = [
  'Foundry is operating autonomously',
  'All intelligence systems are operating normally',
  'All intelligence systems are running normally',
];
for (const file of globSync('src/**/*.{ts,tsx}', { nodir: true })) {
  const content = readFileSync(file, 'utf8');
  for (const claim of forbiddenOperationalClaims) {
    if (content.includes(claim)) {
      failures++;
      console.error(`✗ UNBOUNDED OPERATIONAL CLAIM: ${file} contains "${claim}"`);
    }
  }
}

for (const claim of CLAIMS) {
  const unmatched = tokenize(claim).filter((t) => {
    const numeric = /^\d[\d.]*$/.test(t);
    return !sources.some((s) => numeric ? s.content.replace(/[$,%]/g, '').includes(t) : s.content.toLowerCase().includes(t));
  });
  if (unmatched.length > 0) {
    failures++;
    console.error(`✗ UNVERIFIABLE: "${claim}" — unmatched: ${unmatched.join(', ')}`);
  } else {
    console.log(`✓ ${claim}`);
  }
}
if (failures > 0) {
  console.error(`\n${failures} public claim(s) cannot be traced to code. Update the copy or the code — in the same commit.`);
  process.exit(1);
}
console.log('\nAll public claims verified against code-derived sources.');
