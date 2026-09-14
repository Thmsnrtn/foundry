// =============================================================================
// FOUNDRY — WHAT IS WORTH THE MOST EXPENSIVE MODEL
//
// Three models are reachable from this repository and they are not close in
// price. Per million tokens, in and out:
//
//   the frontier model      $15  /  $75
//   the operational model   $3   /  $15
//   the cheap one           $1   /  $5
//
// Twenty-five times the cost of the cheap one, five times the operational one.
// That is a real difference and it deserves a real argument, not a default.
//
// THE TEST, and it has two halves that must BOTH hold:
//
//   1. BEING WRONG IS EXPENSIVE. The output changes what the institution does,
//      or what it tells the owner about money, law, or a company in trouble.
//      Not "the answer is better" — better answers are always available for
//      more money, and that is not an argument for anything.
//   2. THE OCCASION IS RARE. A thing that happens nightly has, by the end of a
//      year, spent three hundred and sixty-five times whatever it costs. A
//      question good enough to ask every night is almost never good enough to
//      ask at frontier prices, because if it were it would be worth answering
//      properly once and crystallising.
//
// Most frontier use fails the second half. It is the half nobody checks.
//
// WHAT PRODUCTION SHOWS. Between 1 and 14 September 2026 the frontier model was
// called 16 times for 31 cents — about two per cent of what the institution
// spent thinking. The expensive model is NOT where this institution's money
// goes, and saying so is more useful than an optimisation nobody needed. This
// table exists to keep it that way: `scripts/check-frontier-warrant.mjs` fails
// the build when a file reaches the frontier without an entry here, so a
// thirteenth call site cannot appear without someone writing down why.
// =============================================================================

export interface FrontierWarrant {
  /** The file that reaches the frontier. */
  file: string;
  /** How many times it does, so a new one cannot hide beside an old one. */
  sites: number;
  /** What is being asked. */
  question: string;
  /** Why the frontier, against both halves of the test. */
  warrant: string;
  /**
   * True when the second half of the test is doubtful — the occasion is not
   * rare — and the entry survives on the first half alone. A warrant that
   * admits its own weakness is the one worth rereading; silence is not.
   */
  watched?: true;
}

export const FRONTIER_WARRANTS: readonly FrontierWarrant[] = [
  {
    file: 'src/services/audit/remediation.ts',
    sites: 1,
    question: 'Write the code change that fixes a blocking audit finding.',
    warrant: 'Expensive to get wrong: the output is a patch against real files, '
      + 'and a plausible wrong one costs more to discover than it saved. Rare: '
      + 'only for findings already judged blocking, which is a small set.',
  },
  {
    file: 'src/services/audit/scorer.ts',
    sites: 1,
    question: 'Score a company across the audit dimensions and say what is blocking.',
    warrant: 'Expensive to get wrong: the score is what remediation, priority and '
      + 'the owner all read downstream, so an error here is repeated everywhere. '
      + 'Rare: an audit is run deliberately, not on a schedule.',
  },
  {
    file: 'src/services/intelligence/regulatory.ts',
    sites: 1,
    question: 'Which regulations genuinely apply to this company.',
    warrant: 'Expensive to get wrong in both directions — a missed obligation and '
      + 'an invented one are each costly, and the prompt exists to stop the '
      + 'second. Rare: a sector classification changes when the sector does.',
  },
  {
    file: 'src/services/intelligence/recovery.ts',
    sites: 1,
    question: 'What a company under real stress should do about it.',
    warrant: 'Expensive to get wrong: it is asked only when something is already '
      + 'going badly. Rare by construction: stress is not a schedule.',
  },
  {
    file: 'src/services/intelligence/scenario.ts',
    sites: 1,
    question: 'How a specific decision could play out.',
    warrant: 'Expensive to get wrong: it is attached to a decision someone is '
      + 'about to make. Rare: one decision, one occasion.',
  },
  {
    file: 'src/services/graph/engine.ts',
    sites: 1,
    question: 'Find multi-hop causal chains across a company’s data.',
    warrant: 'The one question here that is genuinely about reasoning rather than '
      + 'writing: several hops, each of which must hold. Rebuilt on a schedule, '
      + 'which is the weaker half, but over material that has actually changed.',
  },
  {
    file: 'src/services/wisdom/patterns.ts',
    sites: 1,
    question: 'What patterns a founder’s past decisions show.',
    warrant: 'Expensive to get wrong: a false pattern told back to someone about '
      + 'themselves is believed. Rare: needs at least two decisions and is asked '
      + 'per category, not per day.',
  },
  {
    file: 'src/services/wisdom/network.ts',
    sites: 1,
    question: 'What a handful of anonymised companies appear to have done.',
    warrant: 'Expensive to get wrong: the prompt spends most of its length '
      + 'forbidding claims of significance, which is exactly the failure a '
      + 'cheaper model makes here. Rare: runs over a contribution window.',
  },
  {
    file: 'src/services/decisions/actions.ts',
    sites: 1,
    question: 'Draft the artifact a decision needs, at gate 2 and above.',
    warrant: 'THE PATTERN THE REST OF THIS TABLE SHOULD LOOK LIKE: the same '
      + 'function calls the operational model at gate 1 and below and the '
      + 'frontier above it, so the stake chooses the price rather than the '
      + 'author. Rare because high-gate decisions are rare.',
  },
  {
    file: 'src/services/scp/agents/oracle.ts',
    sites: 1,
    question: 'One agent’s reading of its domain, on its cadence.',
    warrant: 'Passes the first half — the output becomes a briefing the owner '
      + 'reads. Does not clearly pass the second: it runs on a cadence rather '
      + 'than on an occasion, which is the shape that quietly becomes the bill.',
    watched: true,
  },
  {
    file: 'src/jobs/index.ts',
    sites: 1,
    question: 'A week’s operating plan for a founder.',
    warrant: 'Weekly rather than daily, and the output is a plan someone acts '
      + 'on. Still the weaker sort of warrant: fifty-two occasions a year is '
      + 'not rare, and six hundred tokens of framing is not the frontier’s '
      + 'best argument for itself.',
    watched: true,
  },
];
