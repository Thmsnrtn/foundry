// =============================================================================
// FOUNDRY — how few companies may stand behind a number shown to another company
//
// ONE QUESTION, ASKED IN FOUR PLACES, ANSWERED THREE DIFFERENT WAYS.
//
//   `wisdom/network.ts`          MIN_CONTRIBUTORS = 3
//   `benchmarking/pool.ts`       MIN_CONTRIBUTORS = 5
//   `decisions/patterns.ts`      PEER_SIGNAL_MIN_SAMPLE = 5
//   `network/benchmarks.ts`      a bare `values.length < 3`
//
// Two of them even shared a NAME while disagreeing about the number. Whichever
// path a company's data happened to travel decided how thin an aggregate could
// be before it reached that company's competitors — and the weakest answer, 3,
// governed the two paths that publish across companies.
//
// A cell with three contributors and one obvious outlier is a worked example,
// not a hypothetical. So there is one number, here, and the four call sites
// import it.
//
// FIVE IS AN ENGINEERING ESTIMATE, NOT A LEGAL CONCLUSION. It is the smallest
// count at which no single contributor dominates an aggregate. Whether it is
// sufficient for the jurisdictions Foundry operates in is counsel debt —
// `OWNER_DECISIONS_PENDING.md` §13 — and this file must not be read as an
// answer to it. If counsel changes the number, it changes here, once.
//
// RAISING IT IS SAFE; LOWERING IT IS A DECISION. Anything that would publish
// below this floor abstains instead. Abstaining is the correct behaviour: a
// number that cannot be shown honestly is not shown.
// =============================================================================

/** Distinct CONTRIBUTING COMPANIES, never contributing rows. One company
 *  reporting the same metric five times is a sample of one, and counting rows
 *  is how three separate readers came to believe otherwise. */
export const MIN_CONTRIBUTORS = 5;
