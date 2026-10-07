// =============================================================================
// WHO IS OUT THERE — the twin's buyer segments and the needs they voice.
//
// The five panel personas are the only buyers anybody has heard from (one
// listing, one model family), so five of the seven segments are those
// personas widened into groups; the other two are ASSUMPTIONS, added because
// a forge that can only ever find the panel's product is not being tested.
// Each segment says where it came from.
//
// A THEME is a need a printable file could serve. The people of a segment
// voice their themes in public (the eyes read that), search for them (the
// search suggestions answer that), and buy — or do not — when a page for one
// reaches them. Which themes exist at all is an assumption; the twin's job is
// to make the institution find them from what people say, not to hand them
// over.
// =============================================================================
import { BUYER_PANEL } from './sources/observations.js';
import type { Source } from './params.js';

export type ThemeKey = 'handover' | 'home-upkeep' | 'family-organiser' | 'caregiver-log' | 'bills-tracker' | 'side-business' | 'pet-care';

export interface Theme {
  key: ThemeKey;
  /** The plain name a buyer would type. */
  name: string;
  /** Words that mark something as about this theme (title, post, listing). */
  words: readonly string[];
  /** What somebody keeps track of, a chore, and what they wish existed — the raw stuff of posts. */
  things: readonly string[];
  chores: readonly string[];
  wishes: readonly string[];
  /** Months (1-12) when demand peaks; empty for a flat year. */
  peaks: readonly number[];
}

export const THEMES: Readonly<Record<ThemeKey, Theme>> = {
  handover: {
    key: 'handover', name: 'emergency handover file',
    words: ['handover', 'emergency', 'in case', 'where everything is', 'accounts', 'estate', 'binder', 'family records'],
    things: ['every account, policy and bill my family would need if something happened to me', 'where my parents keep their papers and who to call', 'the list of accounts and documents my spouse would need'],
    chores: ['nobody but me knows where anything is', 'it took me months to find everything after my father died', 'I keep meaning to write it all down for my kids'],
    wishes: ['a printable handover file I could fill in once and put in a drawer', 'one binder that says where everything is, without passwords on paper'],
    peaks: [],
  },
  'home-upkeep': {
    key: 'home-upkeep', name: 'home maintenance log',
    words: ['home maintenance', 'house', 'appliance', 'filter', 'boiler', 'gutter', 'upkeep', 'maintenance log'],
    things: ['every appliance in the house with its filter size and service date', 'when the boiler, gutters and smoke alarms were last done'],
    chores: ['I forget when the furnace filter was last changed', 'the service dates live in my head and on scraps of paper'],
    wishes: ['a printable home maintenance log I could keep by the boiler', 'a simple seasonal checklist for the house on paper'],
    peaks: [4, 10],
  },
  'family-organiser': {
    key: 'family-organiser', name: 'family weekly planner',
    words: ['family planner', 'weekly planner', 'kids', 'routine', 'school', 'meal plan', 'chores chart'],
    things: ['school pickups, meals and the kids\' activities for the week', 'who is doing which chore and when'],
    chores: ['the week falls apart by Wednesday', 'I rewrite the same weekly list every Sunday'],
    wishes: ['a printable family planner for the fridge', 'a weekly routine sheet the kids can tick off'],
    peaks: [1, 9],
  },
  'caregiver-log': {
    key: 'caregiver-log', name: 'caregiver appointment and medication record',
    words: ['caregiver', 'appointments', 'medication list', 'parent', 'doctor', 'care log', 'mom', 'dad'],
    things: ['my mother\'s appointments, doctors and medication list', 'what each carer did and noticed on their visit'],
    chores: ['three of us share looking after Dad and nobody knows what the others did', 'I carry Mom\'s medication list on my phone and it is never current'],
    wishes: ['a printable care log the whole family can write in', 'one sheet for appointments and questions to ask the doctor'],
    peaks: [],
  },
  'bills-tracker': {
    key: 'bills-tracker', name: 'household bills tracker',
    words: ['bills', 'bill tracker', 'due dates', 'subscriptions', 'household budget', 'payments'],
    things: ['which bills are due when and which are on autopay', 'every subscription we pay for'],
    chores: ['I paid a late fee again because I forgot a due date', 'we pay for subscriptions nobody uses'],
    wishes: ['a printable bills tracker with due dates for the month', 'one page that lists every subscription and when it renews'],
    peaks: [1],
  },
  'side-business': {
    key: 'side-business', name: 'side-business mileage and expense log',
    words: ['mileage', 'expense log', 'side business', 'receipts', 'invoices', 'self-employed'],
    things: ['mileage and receipts for my side business', 'which client paid which invoice'],
    chores: ['at tax time I rebuild the whole year from my bank statements', 'receipts end up in a shoebox'],
    wishes: ['a printable mileage and expense log for the glovebox', 'a simple paper record of invoices sent and paid'],
    peaks: [1, 3],
  },
  'pet-care': {
    key: 'pet-care', name: 'pet care record',
    words: ['pet', 'dog', 'cat', 'vet', 'vaccination', 'pet sitter'],
    things: ['my dog\'s vaccinations, vet visits and feeding notes', 'what the pet sitter needs to know'],
    chores: ['the vet asks when the last vaccination was and I never know', 'I write the same notes for every pet sitter'],
    wishes: ['a printable pet care record to hand the sitter', 'one page with the vet, the food and the vaccinations'],
    peaks: [6, 7],
  },
};

export interface Segment {
  key: string;
  who: string;
  themes: readonly ThemeKey[];
  /** Relative size among the segments. */
  weight: number;
  /** The most a typical member would pay for a printable, before the twin's scale. */
  wtpDollars: number;
  source: Source;
}

const voice = (tag: string) => BUYER_PANEL.voices.find((v) => v.tag === tag)!;
const panel = (tag: string): Source => ({ kind: 'buyer-panel', cite: `${tag} (${voice(tag).who}): top price $${String(voice(tag).maxPriceDollars)}; the group's size is an assumption` });

export const SEGMENTS: readonly Segment[] = [
  { key: 'after-a-loss', who: voice('p1-grieving').who, themes: ['handover'], weight: 1, wtpDollars: voice('p1-grieving').maxPriceDollars, source: panel('p1-grieving') },
  { key: 'young-family', who: voice('p2-planner-mom').who, themes: ['family-organiser', 'handover', 'bills-tracker'], weight: 1.4, wtpDollars: voice('p2-planner-mom').maxPriceDollars, source: panel('p2-planner-mom') },
  { key: 'caregiver', who: voice('p3-caregiver').who, themes: ['caregiver-log', 'handover'], weight: 1, wtpDollars: voice('p3-caregiver').maxPriceDollars, source: panel('p3-caregiver') },
  { key: 'paper-keeper', who: voice('p4-retiree').who, themes: ['handover', 'home-upkeep', 'caregiver-log'], weight: 1, wtpDollars: voice('p4-retiree').maxPriceDollars, source: panel('p4-retiree') },
  { key: 'skeptic', who: voice('p5-skeptic').who, themes: ['bills-tracker', 'handover'], weight: 1.2, wtpDollars: voice('p5-skeptic').maxPriceDollars, source: panel('p5-skeptic') },
  { key: 'side-business', who: 'somebody running a small business on the side', themes: ['side-business', 'bills-tracker'], weight: 0.8, wtpDollars: 8,
    source: { kind: 'assumption', cite: 'no buyer from this group has been heard; added so the forge is not tested only on the panel\'s product' } },
  { key: 'homeowner', who: 'a homeowner who looks after a house and a pet', themes: ['home-upkeep', 'pet-care'], weight: 1, wtpDollars: 10,
    source: { kind: 'assumption', cite: 'no buyer from this group has been heard; added so the forge is not tested only on the panel\'s product' } },
];

/** The theme a piece of text is about, by its words; null when none. Deterministic: the most words wins, ties by order. */
export function themeOf(text: string): ThemeKey | null {
  const t = text.toLowerCase();
  let best: ThemeKey | null = null; let bestN = 0;
  for (const theme of Object.values(THEMES)) {
    const n = theme.words.filter((w) => t.includes(w)).length + (t.includes(theme.name) ? 3 : 0);
    if (n > bestN) { best = theme.key; bestN = n; }
  }
  return best;
}

/** The segments that need a theme, with their share of that theme's demand. */
export function segmentsFor(theme: ThemeKey): Array<{ segment: Segment; share: number }> {
  const s = SEGMENTS.filter((x) => x.themes.includes(theme));
  const total = s.reduce((n, x) => n + x.weight / x.themes.length, 0);
  return s.map((segment) => ({ segment, share: (segment.weight / segment.themes.length) / total }));
}

/** A theme's demand relative to the mean theme: the weight of the segments that voice it. */
export function themeDemand(theme: ThemeKey): number {
  const all = (Object.keys(THEMES) as ThemeKey[]).map((k) => SEGMENTS.filter((s) => s.themes.includes(k)).reduce((n, s) => n + s.weight / s.themes.length, 0));
  const mean = all.reduce((a, b) => a + b, 0) / all.length;
  return SEGMENTS.filter((s) => s.themes.includes(theme)).reduce((n, s) => n + s.weight / s.themes.length, 0) / mean;
}

/** Seasonal multiplier for a theme on a day of the year (1 = mean). */
export function seasonOf(theme: ThemeKey, dayOfYear: number, amplitude: number): number {
  const peaks = THEMES[theme].peaks;
  if (peaks.length === 0) return 1;
  const month = Math.floor((dayOfYear % 365) / 30.42) + 1;
  const near = Math.min(...peaks.map((p) => Math.min(Math.abs(p - month), 12 - Math.abs(p - month))));
  return near === 0 ? 1 + amplitude : near === 1 ? 1 + amplitude / 3 : 1 - amplitude / 3;
}
