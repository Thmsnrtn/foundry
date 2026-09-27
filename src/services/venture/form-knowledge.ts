// =============================================================================
// FOUNDRY — what each economic form takes, as far as anyone has shown it.
//
// Integrated plan §6: "Maintain an economic-forms library as decision
// knowledge: the customers and jobs a form serves; pricing and payment
// patterns; rights; channels and provider eligibility; ongoing service and
// compliance burden; failure and exit conditions; what is observed versus
// assumed; and which current capability can serve it."
//
// `economic-forms.ts` recognises a form. This says what one INVOLVES — and
// only what a source says, dated and graded as ECONOMICS.md grades sources.
// Three rules, each held by `a-form-is-known-only-as-far-as-it-is-sourced`:
//
//   · A FACT HAS A SOURCE, A DAY IT WAS READ, AND A GRADE. Vendor promotion
//     (grade D) is refused outright. The list of "digital products that sell"
//     the owner shared on 27 September 2026 is exactly that, and contributes
//     nothing here; it named the words, not the facts.
//   · WHAT IS NOT KNOWN IS SAID. Every aspect of every form is either known or
//     returned as unknown. Nothing is filled in by assumption, because an
//     assumption written down beside sourced facts reads as one of them.
//   · NOTHING HERE CLAIMS DEMAND, AND NOTHING HERE CAUSES A CANDIDATE. Whether
//     anyone buys is what a test is for. This is read beside candidates the
//     search already found, and by deliberation on a test that already exists.
//
// What can serve a form TODAY is not a fact to store: it is read from the
// institution's own state at the moment of asking (`whatAFormTakes`).
// =============================================================================

import { query, realCompany } from '../../db/client.js';
import { formNamed } from './economic-forms.js';

export const ASPECTS = ['buyers', 'pricing', 'rights', 'channels', 'burden', 'exit'] as const;
export type Aspect = typeof ASPECTS[number];

/** What each aspect is called when he reads it. */
export const ASPECT_WORDS: Record<Aspect, string> = {
  buyers: 'who buys it and why',
  pricing: 'what a sale costs and when the money arrives',
  rights: 'what may be sold',
  channels: 'how buyers find it',
  burden: 'what it asks of you after the sale',
  exit: 'how it ends, or is sold on',
};

export interface FormFact {
  aspect: Aspect;
  /** One plain sentence. Never a figure about demand. */
  claim: string;
  source: { title: string; url: string };
  /** The day the source was read, YYYY-MM-DD. Platforms change their rules. */
  read: string;
  /** ECONOMICS.md's scale: A primary data or the platform's own rule, B a practitioner's own numbers, C without numbers. D is refused. */
  grade: 'A' | 'B' | 'C';
}

// ─── The sources ─────────────────────────────────────────────────────────────
//
// Etsy's own pages, read on 15 September 2026 for the workbook's listing and
// recorded there as observations (`proof-2.ts`). Grade A: they are the
// platform's rules, stated by the platform.
const ETSY_READ = '2026-09-15';
const ETSY_FEES = { title: 'Etsy, Fees & Payments Policy', url: 'https://www.etsy.com/legal/fees/' };
const ETSY_CREATIVITY = { title: 'Etsy, Creativity Standards', url: 'https://www.etsy.com/legal/creativity/' };
const ETSY_REVIEWS = { title: 'Etsy Help, When can I leave a review for my order', url: 'https://help.etsy.com/hc/en-us/articles/115013293148-When-Can-I-Leave-a-Review-for-My-Order' };
const ETSY_DEPOSITS = { title: 'Etsy Help, How to receive your Etsy Payments deposit', url: 'https://help.etsy.com/hc/en-us/articles/360046998234-How-to-Receive-Your-Etsy-Payments-Deposit' };
const ETSY_STATS = { title: 'Etsy Help, Shop Stats glossary', url: 'https://help.etsy.com/hc/en-us/articles/115015628207-Shop-Stats-Glossary' };

// The mechanisms ECONOMICS.md read and graded on 21 September 2026.
const MECHANISMS_READ = '2026-09-21';
const WALLING = { title: 'Walling, The Stair Step Method of Bootstrapping (2015)', url: 'https://robwalling.com/2015/03/26/the-stair-step-method-of-bootstrapping/' };
const MCKENZIE = { title: 'McKenzie, Bingo Card Creator year in review 2012', url: 'https://www.kalzumeus.com/2012/12/29/bingo-card-creator-and-other-stuff-year-in-review-2012/' };
const GOOGLE_SPAM = { title: 'Google, New updates to address spam and low-quality results (March 2024)', url: 'https://blog.google/products/search/google-search-update-march-2024/' };
const VOHRA = { title: 'Vohra, How Superhuman built an engine to find product/market fit (2018)', url: 'https://review.firstround.com/how-superhuman-built-an-engine-to-find-product-market-fit/' };

// ─── The facts ───────────────────────────────────────────────────────────────

/** A download listed on Etsy, by Etsy's own rules. */
const ON_ETSY: FormFact[] = [
  { aspect: 'pricing', grade: 'A', source: ETSY_FEES, read: ETSY_READ,
    claim: 'On Etsy each sale pays a $0.20 listing fee (renewed on the sale), a 6.5% transaction fee and 3% + $0.25 processing; Offsite Ads take 15% of an order they bring, which a shop may opt out of until it passes $10,000 of orders in 365 days.' },
  { aspect: 'pricing', grade: 'A', source: ETSY_DEPOSITS, read: ETSY_READ,
    claim: 'A new Etsy seller is paid about 14 days after a sale, weekly by default, and digital orders are not held in a reserve.' },
  { aspect: 'rights', grade: 'A', source: ETSY_CREATIVITY, read: ETSY_READ,
    claim: 'Etsy allows a seller\'s own downloads made with AI assistance only when the listing says so; listings that omit it are removed, and AI prompt bundles are not allowed at all.' },
  { aspect: 'burden', grade: 'A', source: ETSY_REVIEWS, read: ETSY_READ,
    claim: 'An Etsy buyer must download the file before opening a not-as-described case, and the seller may refund at any time through Etsy Payments; buyers are answered on Etsy.' },
  { aspect: 'channels', grade: 'A', source: ETSY_STATS, read: ETSY_READ,
    claim: 'Etsy tells the seller each listing\'s views, visits, orders and where they came from (Etsy search, ads, social, direct), but no statistic reports a download.' },
];

/** Search as a channel has an owner, and it has rules. */
const SEARCH_RULE: FormFact = {
  aspect: 'channels', grade: 'A', source: GOOGLE_SPAM, read: MECHANISMS_READ,
  claim: 'Google treats pages made at scale to rank as spam, whether automation, people or both made them: search is a channel whose rules Foundry cannot change.',
};

const STAIR_STEP: FormFact = {
  aspect: 'channels', grade: 'B', source: WALLING, read: MECHANISMS_READ,
  claim: 'One founder\'s order of steps: first something bought once, inside an ecosystem that has its own free way of being found (a plugin directory, an app store, search), and nothing recurring until one-time has earned.',
};

export const FORM_KNOWLEDGE: Partial<Record<string, FormFact[]>> = {
  guide: ON_ETSY,
  template_pack: ON_ETSY,
  printable: ON_ETSY,
  asset_pack: ON_ETSY,
  calculator: [
    SEARCH_RULE,
    { aspect: 'channels', grade: 'B', source: MCKENZIE, read: MECHANISMS_READ,
      claim: 'One author\'s generator for one population drew 56% of its visits from Google search and 12% from paid search ads, and improved by small measured changes over six years.' },
    { aspect: 'burden', grade: 'B', source: MCKENZIE, read: MECHANISMS_READ,
      claim: 'The same author put its support at about 20 minutes a week, because it did one task for one kind of person.' },
  ],
  utility: [SEARCH_RULE, STAIR_STEP],
  plugin: [STAIR_STEP],
  free_resource: [SEARCH_RULE],
  data: [SEARCH_RULE],
  saas: [
    { aspect: 'buyers', grade: 'C', source: VOHRA, read: MECHANISMS_READ,
      claim: 'Fit can be measured before it is felt, by asking users how they would feel without the product; the method wants about 40 users before it gives a direction.' },
  ],
};

// ─── What it takes, read now ─────────────────────────────────────────────────

export interface WhatAFormTakes {
  form: string;
  label: string;
  known: FormFact[];
  /** Aspects nobody has shown anything about. Said, never filled. */
  unknown: Aspect[];
  /** What in the institution could serve a test of this form today, read from its own state. */
  canServe: string;
}

/** Forms whose channel today would be a download listed on Etsy. */
const ETSY_FORMS = new Set(['guide', 'template_pack', 'printable', 'asset_pack']);

export async function whatAFormTakes(formKey: string, founderId: string): Promise<WhatAFormTakes> {
  const form = formNamed(formKey);
  const known = FORM_KNOWLEDGE[form.key] ?? [];
  const unknown = ASPECTS.filter((a) => !known.some((k) => k.aspect === a));

  // THE PAYMENT IT WOULD NEED, as the hands can take payment today.
  const exchanges = new Map<string, boolean>();
  for (const r of (await query('SELECT exchange, available FROM probe_exchanges', []))
    .rows as unknown as Array<Record<string, unknown>>) exchanges.set(String(r.exchange), Number(r.available) === 1);
  const missing = form.needsExchange.filter((x) => exchanges.get(x) !== true);
  const pay = form.needsExchange.length === 0 ? null
    : missing.length === form.needsExchange.length
      ? `Foundry cannot take ${missing.join(' or ').replace(/_/g, ' ')} yet`
      : `Foundry can take ${form.needsExchange.filter((x) => !missing.includes(x)).join(' or ').replace(/_/g, ' ')}`;

  // AND WHERE IT WOULD BE FOUND. Only a shop he has confirmed is his counts.
  // STANDING DELIBERATELY DOES NOT APPLY, and this is baselined for it: an
  // experimental asset's shop is still his shop.
  let where: string | null = null;
  if (ETSY_FORMS.has(form.key)) {
    const shop = (await query(
      `SELECT s.provider_account_label FROM company_senses s JOIN products p ON p.id = s.product_id
        WHERE p.owner_id = ? AND p.deleted_at IS NULL AND ${realCompany('p')}
          AND s.provider = 'etsy' AND s.disconnected_at IS NULL
          AND s.identity_confirmed_at IS NOT NULL AND s.identity_disputed_at IS NULL
        ORDER BY s.rowid LIMIT 1`, [founderId])).rows[0] as Record<string, unknown> | undefined;
    where = shop
      ? `a listing on ${shop.provider_account_label == null ? 'the Etsy shop you connected' : `${String(shop.provider_account_label)}, the Etsy shop you connected`} — read-only, so you publish it and answer its buyers on Etsy yourself`
      : 'no Etsy shop is connected, so a listing would be yours to place and watch by hand';
  }

  const canServe = [where, pay].filter((s): s is string => s !== null).join('; ')
    || 'nothing in Foundry is connected that could run a test of this kind';
  return { form: form.key, label: form.label, known, unknown, canServe: canServe.charAt(0).toUpperCase() + canServe.slice(1) + '.' };
}
