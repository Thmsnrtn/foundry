// =============================================================================
// FOUNDRY — The economic forms, as a way of LOOKING at what has been found.
//
// This file is presentation. It stands to what the search finds exactly as
// `SHAPES` stands to `venture_mandates.shape`: a list of words that recognise
// something the owner would recognise, which constrains nothing about where the
// institution may look.
//
// THE DANGER THIS FILE IS WRITTEN AGAINST. A list of economic forms on a screen
// reads as a menu, and a menu invites manufacture: "he opened the API shelf, so
// produce API ideas". That is the one thing the whole evidence apparatus exists
// to prevent, and it would arrive wearing real URLs. So:
//
//   - A shelf NEVER causes a candidate to exist. It sorts candidates that
//     already survived two independent ways of knowing.
//   - A candidate reaches a shelf only through a sentence somebody actually
//     wrote — its own recorded headline, problem, reasoning, or the seed's
//     origin words — and the card says which sentence put it there.
//   - An empty shelf says it is empty. It does not fill itself, and the only
//     thing it offers is to point the SEARCH in that direction, which goes
//     through the mandate like any other instruction from him.
//
// Nothing here filters discovery, nothing here is stored, and no shelf is a
// closed taxonomy: "Other" exists because the list is examples, and a candidate
// that answers to none of these words is not a candidate that is wrong.
// =============================================================================

export interface EconomicForm {
  key: string;
  /** What he would call it. */
  label: string;
  /** What it is, in one sentence of plain words. */
  whatItIs: string;
  /**
   * The ways of getting paid a test of this form would need, named as
   * `probe_exchanges` names them. A shelf reads this to say honestly that the
   * hands cannot run a test of this kind yet, rather than offering one.
   */
  needsExchange: string[];
  /** The words that recognise this form in sentences somebody else wrote. */
  words: string[];
}

export const ECONOMIC_FORMS: EconomicForm[] = [
  { key: 'saas', label: 'Software people subscribe to',
    whatItIs: 'Something people log into and pay for every month.',
    needsExchange: ['subscription'],
    words: ['saas', 'subscription', 'subscribe', 'monthly plan', 'seats', 'login', 'dashboard', 'recurring'] },
  { key: 'api', label: 'Something other software calls',
    whatItIs: 'A service other people’s programs use, paid for by what they use.',
    needsExchange: ['usage'],
    words: ['api', 'apis', 'endpoint', 'integration', 'webhook', 'sdk', 'developers', 'programmatic'] },
  { key: 'utility', label: 'A small tool that does one thing',
    whatItIs: 'One job, done properly, bought once or used freely.',
    needsExchange: ['upfront_price'],
    words: ['tool', 'utility', 'converter', 'formatter', 'cleaner', 'one job', 'small script', 'script to'] },
  { key: 'calculator', label: 'A calculator or generator',
    whatItIs: 'Numbers in, an answer or a document out.',
    needsExchange: ['upfront_price'],
    words: ['calculator', 'calculate', 'work out', 'estimate', 'quote', 'generator', 'generate', 'template'] },
  { key: 'data', label: 'Data somebody has assembled',
    whatItIs: 'Scattered facts, gathered, checked and kept current.',
    needsExchange: ['upfront_price', 'sample_then_paid'],
    words: ['data', 'dataset', 'list of', 'database', 'spreadsheet', 'register', 'records', 'scattered'] },
  { key: 'monitoring', label: 'Watching and telling',
    whatItIs: 'Something checks on your behalf and says when it changes.',
    needsExchange: ['subscription'],
    words: ['monitor', 'monitoring', 'alert', 'notify', 'watch for', 'check every', 'keep track', 'changes'] },
  { key: 'plugin', label: 'A part of something bigger',
    whatItIs: 'An add-on inside software people already use.',
    needsExchange: ['upfront_price', 'subscription'],
    words: ['plugin', 'plug-in', 'extension', 'add-on', 'addon', 'inside excel', 'inside shopify', 'app store'] },
  { key: 'marketplace', label: 'A place two sides meet',
    whatItIs: 'Buyers and sellers who cannot find each other.',
    needsExchange: ['deposit_then_valuation'],
    words: ['marketplace', 'two-sided', 'buyers and sellers', 'match', 'directory', 'listings', 'find each other'] },
  { key: 'licensing', label: 'Letting somebody else use it',
    whatItIs: 'Somebody else runs it under their name and pays to.',
    needsExchange: ['license'],
    words: ['licensing', 'license', 'white label', 'white-label', 'resell', 'under their own brand'] },
  { key: 'acquisition', label: 'Buying something that already earns',
    whatItIs: 'Not building at all: taking on something that already has customers.',
    needsExchange: ['deposit_then_valuation'],
    words: ['acquisition', 'acquire', 'buy a business', 'buy an existing', 'for sale', 'listed for sale'] },
  { key: 'other', label: 'Everything else',
    whatItIs: 'Found and believed, and not answering to any of the words above.',
    needsExchange: [], words: [] },
];

export const OTHER = 'other';

/**
 * WHICH FORM A SENTENCE SOUNDS LIKE, AND WHICH SENTENCE SAID SO.
 *
 * The sentences are the candidate's own and the seed's own — never a summary
 * Foundry wrote about them and never the owner's mandate, which would let his
 * question decide its own answer. The first form matched wins, and the phrase
 * that matched travels with it so the card can show its working.
 */
export function formOf(
  sentences: Array<{ said: string; where: string }>,
): { form: string; because: string; where: string } {
  for (const f of ECONOMIC_FORMS) {
    for (const s of sentences) {
      const hay = ` ${s.said.toLowerCase().replace(/[^a-z0-9]+/g, ' ')} `;
      const hit = f.words.find((w) => hay.includes(` ${w} `) || hay.includes(`${w} `));
      if (hit !== undefined) return { form: f.key, because: hit, where: s.where };
    }
  }
  return { form: OTHER, because: '', where: '' };
}

export const formNamed = (key: string): EconomicForm =>
  ECONOMIC_FORMS.find((f) => f.key === key) ?? ECONOMIC_FORMS[ECONOMIC_FORMS.length - 1] as EconomicForm;
