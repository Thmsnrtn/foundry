#!/usr/bin/env node
// =============================================================================
// FOUNDRY — Public-claims audit (Ascent A3 / Honesty Law)
//
// Verifies the public site's factual claims against sources DERIVED FROM CODE,
// so copy cannot drift from what the institution actually does. Contract: when
// public copy changes, CLAIMS[] updates in the same commit. Fails CI on any
// unverifiable claim. The engine is the floor, not the ceiling.
//
// THE SURFACE THIS GUARDS CHANGED COMPLETELY ON 13 SEPTEMBER 2026.
//
// It used to read `routes/public/landing.ts`: three pricing tiers, a trial
// length, thirty founding-rate slots, a twelve-agent roster. That page sold
// Commercial Foundry, which was deleted, and the page was deleted with it —
// the owner's instruction being that Private Foundry has no landing page of
// its own and apexmicro.ai is the public face.
//
// So the claims here are now the ones the Apex Micro site actually makes, and
// they are a different KIND of claim. The old page typed its facts: "$79" was
// a string that had to be kept in step with a constant. The Apex Micro site
// renders its facts from the experiment record — the price on a page comes
// from the same row the payment link is minted from — so a price cannot drift
// from what is charged without the data itself being wrong.
//
// What CAN still drift is a PROMISE. The About page makes three, in the
// owner's own words, and each is a capability with a last step that either
// runs or does not:
//
//   "If you buy something and it's no use to you, you can have your money back."
//   "If you hear from me and would rather not, one line tells me so and I
//    won't write again."
//   "Every page stays up, whatever happened to it."
//
// Those are the dangerous ones. A refund policy nobody can act on, an opt-out
// nothing consults before the next send, a closed experiment whose page
// quietly disappears — each is fully built except for the part that makes it
// true, described everywhere by its readers and called by nothing. That is the
// failure mode this gate exists for, and it is why the sources below are
// pinned to the LAST STEP of each pipeline rather than to its description.
// =============================================================================
import { readFileSync } from 'fs';
import { globSync } from 'glob';
import { tokenizeClaim } from './lib/claim-tokenizer.mjs';

// The claims the public site makes, in the words it makes them in.
const CLAIMS = [
  'If you buy something and it is no use to you, you can have your money back',
  'One line tells me so and I will not write again',
  'Every page stays up, whatever happened to it',
  'The price on its page is the price you pay',
];

// ── Sources derived from code (single source of truth) ───────────────────────
const sources = [];
const srcFiles = globSync('src/**/*.ts', { nodir: true });
const site = readFileSync('src/services/public-workshop/site.ts', 'utf8');

// A capability is verified against whether the last step of its pipeline
// actually runs, not against whether something describes it.
const calledOutside = (fnName, definedInSuffix) => srcFiles
  .filter((f) => !f.endsWith(definedInSuffix))
  .some((f) => readFileSync(f, 'utf8').includes(fnName));

// REFUNDS. The promise needs a page a buyer can read and a path the Worker
// serves. `renderRefunds` is the page; `PUBLIC_PATHS` is what the Worker will
// answer for. A policy that exists in a renderer nothing routes to is a policy
// nobody can find.
const refundsServed = site.includes("pages.set('/refunds'") && site.includes("'/refunds'");
sources.push({
  name: 'refunds: is the policy actually served',
  content: refundsServed
    ? 'if you buy something and it is no use to you you can have your money back refunds'
    : 'nothing states how a purchase is put right',
});

// OPT-OUT. THE ONE THAT MATTERS MOST, because getting it wrong means writing
// to somebody who asked not to hear from me. `suppress` records the request;
// `isSuppressed` is the check, and it only counts if something asks it BEFORE
// a send. `venture/hand.ts` is the send path and `public-workshop/mail.ts`
// records the request off an inbound reply.
const optOutRecorded = calledOutside('suppress', 'public-workshop/suppression.ts');
const optOutConsulted = readFileSync('src/services/venture/hand.ts', 'utf8').includes('isSuppressed');
sources.push({
  name: 'opt-out: recorded, and consulted before the next send',
  content: optOutRecorded && optOutConsulted
    ? 'one line tells me so and i will not write again opt out suppression'
    : `a request to stop hearing from us is ${optOutRecorded ? 'stored but nothing consults it' : 'never stored'} before the next message leaves`,
});

// A CLOSED EXPERIMENT KEEPS ITS PAGE. The registry renders a 'closed' view and
// the Worker serves `/closed`; an experiment page is built per experiment
// rather than per LIVE experiment. If the closed view stopped being served,
// "every page stays up" would be a page that quietly vanished on failure —
// exactly the claim a reader would rely on and could not check.
const closedServed = site.includes("pages.set('/closed'") && site.includes("'closed'");
sources.push({
  name: 'closed experiments: is the page still served',
  content: closedServed
    ? 'every page stays up whatever happened to it closed'
    : 'a shut experiment leaves nothing a reader can open',
});

// PRICE. The page and the payment link must read the same number. The site
// renders from the experiment record's `amountCents`; if the payment link were
// minted from a separate figure, the page could advertise one price and charge
// another — the single drift this data-driven surface is still capable of.
const paymentLink = readFileSync('src/services/venture/payment-link.ts', 'utf8');
const oneNumber = site.includes('amountCents') && paymentLink.includes('amountCents');
sources.push({
  name: 'price: page and payment link read one number',
  content: oneNumber
    ? 'the price on its page is the price you pay'
    : 'the amount shown and the amount charged come from different records',
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
// The stop list is PASSED IN rather than copied, so the difference from the
// engine's own list is a decision rather than an accident.
//
// IT IS SHORT ON PURPOSE, AND THE FIRST VERSION OF IT WAS NOT.
//
// Written for prose rather than pricing copy, it grew to forty words — and
// forty words of English connective tissue is most of a sentence. All four
// claims tokenized to the EMPTY LIST, so every one of them was verified by
// matching nothing at all. Caught by deleting the `isSuppressed` call from the
// send path and watching the gate still pass: a green gate that cannot go red
// is worse than no gate, because it is believed.
//
// So: connectives only. If a word carries any of the claim's meaning it stays
// in, and the source content below is what decides whether the claim holds.
const STOP = new Set(['the','a','an','and','or','for','with','that','this','to','of','is','it','its','be','i','me','my','you','your']);
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
