// =============================================================================
// FOUNDRY — what the hands can make, and the gate each thing must pass
//
// Two real experiments so far, and a person made both deliverables: a brief
// pulled by hand from a procurement record, a workbook built by hand. The
// owner asked not to be the job, so the institution needs recipes it can
// execute itself — and, more than recipes, a gate that refuses what it made
// when it is not good enough, because a product nobody checked is how a small
// workshop's name is spent.
//
// THE FIRST RECIPE IS A BRIEF MADE OF ROWS. The eyes keep what they returned,
// item by item, with an address and a date (`retrieval_items`). A data brief
// is a shortlist of those items for one question, and every item in it cites
// the row it came from. The gate reads that back: an item whose address is
// not a retrieval row is invented and the brief is refused. Counts in the
// brief are the retrievals' own counts. No sentence in it is composed by a
// model; the words are a template and the facts are rows.
//
// WHAT IT CANNOT MAKE IS SAID AS PLAINLY. A tool page, a template file, a
// directory and an alert each name what would have to exist first, so the
// forge can design only for what the hands can do today and the record shows
// what to build next.
// =============================================================================
import { query } from '../../../db/client.js';
import { BANNED_CLAIMS, DELIVERABLE_MAX_AGE_DAYS, HAND, materialOf, recordMaterial } from '../hand.js';
import type { Material, OfferShapePlan } from '../hand.js';

export const PRODUCT_KINDS = ['data_brief', 'static_tool', 'template_file', 'directory', 'monitoring_alert'] as const;
export type ProductKind = typeof PRODUCT_KINDS[number];

export interface KindFacts {
  kind: ProductKind;
  whatItIs: string;
  /** Whether the hands can make one today, and what is missing when they cannot. */
  canMake: boolean;
  needs: string | null;
}

export const KINDS: KindFacts[] = [
  { kind: 'data_brief', whatItIs: 'a dated shortlist of public items for one question, each citing its source, delivered by email after payment', canMake: true, needs: null },
  // A FREE TOOL, beside the paid brief on the same page (products/tool.ts): its
  // specification is data, one reviewed program computes it, and the gate
  // reproduces every worked example with that program's own arithmetic.
  { kind: 'static_tool', whatItIs: 'a free calculator on the test\'s own page, computing in the reader\'s browser, beside the paid brief it leads to', canMake: true, needs: null },
  { kind: 'template_file', whatItIs: 'a spreadsheet or document file the buyer fills in', canMake: false,
    // ONE RECIPE EXISTS — the job review (recipes/job-review.ts), checked by hand and by
    // LibreOffice — as a prototype for the owner's decision, not a kind Foundry may make.
    needs: 'a buyer who used the one recipe that exists (the job review) on real jobs, and a check in the spreadsheets buyers use' },
  { kind: 'directory', whatItIs: 'a page of listed items, refreshed on a cycle', canMake: false, needs: 'a page recipe and a steward that refreshes it' },
  { kind: 'monitoring_alert', whatItIs: 'a message when a watched source changes', canMake: false, needs: 'subscribers gathered by the Workshop and a watched source' },
];

export function kindsFoundryCanMake(): KindFacts[] { return KINDS.filter((k) => k.canMake); }

// ─── The brief ───────────────────────────────────────────────────────────────

export interface BriefSpec {
  kind: 'data_brief';
  title: string;
  /** The words the eyes were asked with; the brief is built from those retrievals. */
  terms: string;
  /** Which kinds of source to draw on. */
  sourceTypes: string[];
  /** What the brief covers and does not, in the Workshop's words. */
  coverage: string;
  /** The most items. */
  limit: number;
}

/**
 * WHAT A PAID BRIEF MAY BE MADE FROM (Roadmap 2027 R23). The eyes read five
 * kinds of source; reading is not reselling. Three of them are refused for
 * sale, each for a reason the owner can check, and a brief is made only from
 * the two that remain: public discussion (cited by link, never quoted) and
 * public package and repository directories.
 */
export const REFUSED_FOR_SALE: Record<string, string> = {
  job_posting: 'the jobs board\'s terms do not allow its listings to be resold',
  app_store: 'Apple\'s terms do not allow its search results to be resold',
  review: 'reviews are strangers\' own words, and Apple\'s terms do not allow them to be resold',
};
export const PAID_BRIEF_SOURCES = ['community', 'directory'] as const;

/** Why each named source may not go into something sold, or nothing. */
export function sourcesRefusedForSale(sourceTypes: readonly string[]): string[] {
  return sourceTypes.filter((t) => t in REFUSED_FOR_SALE).map((t) => `${t.replace(/_/g, ' ')}: ${REFUSED_FOR_SALE[t]!}`);
}

/**
 * NOBODY'S WORDS REPUBLISHED. A discussion's title or a review's text is what
 * a stranger wrote; the brief names where it is and when, and links to it, and
 * never carries the words themselves.
 */
export function neutralLabel(item: Pick<BriefItem, 'label' | 'url' | 'sourceType'>): string {
  if (item.sourceType !== 'community' && item.sourceType !== 'review') return item.label;
  let host = 'a public site';
  try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch { /* keep the plain words */ }
  return item.sourceType === 'review' ? `A review on ${host}` : `A public discussion on ${host}`;
}

export interface BriefItem { id: string; label: string; url: string; datedAt: string | null; said: string | null; sourceType: string; source: string }

/** The rows a brief would be made of: relevant items from this founder's own retrievals, newest first, one per address. */
export async function rowsForBrief(founderId: string, spec: BriefSpec): Promise<{ items: BriefItem[]; retrievals: Array<{ sourceType: string; source: string; returned: number; relevant: number; at: string }>; pulledAt: Date | null }> {
  const placeholders = spec.sourceTypes.map(() => '?').join(',');
  const retrievals = (await query(
    `SELECT id, source_type, source, returned_count, relevant_count, retrieved_at FROM market_retrievals
      WHERE founder_id = ? AND evidence_mode = 'real' AND source_type IN (${placeholders}) AND terms = ?
      ORDER BY retrieved_at DESC, rowid DESC LIMIT 12`, [founderId, ...spec.sourceTypes, spec.terms])).rows as unknown as Array<Record<string, unknown>>;
  if (retrievals.length === 0) return { items: [], retrievals: [], pulledAt: null };
  const ids = retrievals.map((r) => String(r.id));
  const raw = (await query(
    `SELECT i.id, i.label, i.url, i.dated_at, i.said, r.source_type, r.source FROM retrieval_items i
       JOIN market_retrievals r ON r.id = i.retrieval_id
      WHERE i.retrieval_id IN (${ids.map(() => '?').join(',')}) AND i.relevant = 1 AND i.url IS NOT NULL
      ORDER BY i.dated_at DESC, i.rowid`, ids)).rows as unknown as Array<Record<string, unknown>>;
  const seen = new Set<string>();
  const items: BriefItem[] = [];
  for (const r of raw) {
    const url = String(r.url);
    if (seen.has(url)) continue;
    seen.add(url);
    items.push({ id: String(r.id), label: String(r.label), url, datedAt: r.dated_at == null ? null : String(r.dated_at),
      said: r.said == null ? null : String(r.said), sourceType: String(r.source_type), source: String(r.source) });
    if (items.length >= spec.limit) break;
  }
  const pulledAt = new Date(String(retrievals[0]!.retrieved_at).replace(' ', 'T') + (String(retrievals[0]!.retrieved_at).includes('Z') ? '' : 'Z'));
  return {
    items,
    retrievals: retrievals.map((r) => ({ sourceType: String(r.source_type), source: String(r.source), returned: Number(r.returned_count), relevant: Number(r.relevant_count), at: String(r.retrieved_at).slice(0, 10) })),
    pulledAt,
  };
}

const day = (d: Date): string => d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'UTC' });

/** THE BRIEF AS TEXT. A template and rows; not a sentence of it is composed. */
export function renderBrief(spec: BriefSpec, made: Awaited<ReturnType<typeof rowsForBrief>>, workshop: string): string {
  const pulled = made.pulledAt ? day(made.pulledAt) : 'no pull date';
  const sources = [...new Set(made.retrievals.map((r) => r.sourceType.replace(/_/g, ' ')))].join(', ');
  const lines: string[] = [];
  lines.push(`# ${spec.title} — ${pulled} edition`, '');
  lines.push(`**Pulled:** ${pulled}, from ${sources || 'no source'} · **Items:** ${String(made.items.length)}`, '');
  lines.push('## What this is, and what it is not', '');
  lines.push(`This is a shortlist, not a database. Every item below links to the public record it was read from, with the date it carried. ${spec.coverage}`, '');
  lines.push('**Coverage is limited to what was read.** ' + made.retrievals.map((r) => `${r.sourceType.replace(/_/g, ' ')} returned ${String(r.returned)} result(s) on ${r.at}, of which ${String(r.relevant)} were about the subject`).join('; ') + '.', '');
  lines.push('**Relevance is judged from the text the source showed.** Nothing beyond that text was opened, and an item can be about the subject and still be no use to you.', '');
  lines.push('Items are listed newest first.', '', '---', '');
  made.items.forEach((it, i) => {
    const quoted = it.sourceType !== 'community' && it.sourceType !== 'review';
    lines.push(`### ${String(i + 1)}. ${neutralLabel(it)}`);
    if (it.datedAt) lines.push(`- **Dated:** ${it.datedAt.slice(0, 10)}`);
    if (it.said && quoted) lines.push(`- **What the record says:** "${it.said.replace(/\s+/g, ' ').slice(0, 300)}"`);
    lines.push(`- **Source:** ${it.url}`, '');
  });
  lines.push('---', '', `Compiled by ${workshop} from public sources. If it is no use to you, you can have your money back.`);
  return lines.join('\n');
}

/**
 * THE GATE A BRIEF MUST PASS. Read back from the text, against the rows:
 * every item cites an address that is a retrieval row of this owner's, the
 * pull is fresh, the coverage is stated, nothing is a placeholder, nothing
 * is a banned claim, and no person is named.
 */
export async function checkBriefQuality(founderId: string, m: Material, now: Date = new Date()): Promise<{ ok: boolean; failures: string[] }> {
  const failures: string[] = [];
  const ageDays = m.pulledAt ? (now.getTime() - new Date(m.pulledAt).getTime()) / 86_400_000 : Number.POSITIVE_INFINITY;
  if (!(ageDays <= DELIVERABLE_MAX_AGE_DAYS)) failures.push(m.pulledAt ? `pulled ${String(Math.floor(ageDays))} days ago; the limit is ${String(DELIVERABLE_MAX_AGE_DAYS)}` : 'no pull date');
  const items = (m.body.match(/^### /gm) ?? []).length;
  if (items < 1) failures.push('no items');
  const cited = [...m.body.matchAll(/^- \*\*Source:\*\* (\S+)$/gm)].map((x) => x[1]!);
  if (cited.length < items) failures.push(`${String(items)} items but ${String(cited.length)} cite a source`);
  for (const url of cited) {
    const row = (await query('SELECT id FROM retrieval_items WHERE founder_id = ? AND url = ? LIMIT 1', [founderId, url])).rows[0];
    if (!row) failures.push(`an item cites ${url}, which is not a row anything retrieved`);
  }
  if (!/coverage|covers|limited to/i.test(m.body)) failures.push('coverage limits are not stated');
  if (/\[[A-Z ]+\]|\{[a-zA-Z ]+\}|TODO|TBD/.test(m.body)) failures.push('placeholder text remains');
  for (const phrase of BANNED_CLAIMS) if (m.body.toLowerCase().includes(phrase)) failures.push(`banned claim: "${phrase}"`);
  const { publicWorkshopOf } = await import('../../public-workshop/settings.js');
  const w = await publicWorkshopOf(founderId);
  if (w && m.body.includes(w.operatorName)) failures.push('a person is named; the Workshop is the voice');
  return { ok: failures.length === 0, failures };
}

// ─── The offer, in the Workshop's voice ──────────────────────────────────────

/**
 * The message that carries a brief: a template and the plan's facts, no person
 * named, opt-out plain, and the terms as the plan has them (R29). It said
 * "one-time, no subscription" whatever the plan was, so a weekly offer read as
 * a single purchase and a pay-what-it-was-worth offer as a fixed price.
 */
export function renderOfferTemplate(plan: OfferShapePlan, workshop: string, region: string): string {
  const dollars = (plan.price.amountCents / 100).toFixed(plan.price.amountCents % 100 === 0 ? 0 : 2);
  const terms = plan.price.recurring
    ? `It's $${dollars} a week until you cancel. You can cancel any time from the link in every email, and nothing is charged after you cancel.`
    : plan.price.chosen
      ? `You pay what it was worth to you, $${dollars} suggested, or nothing. No subscription.`
      : `It's $${dollars}, one-time. No subscription.`;
  return [
    'Hi,',
    '',
    `${workshop} is a small digital workshop in ${region}. It has put together ${plan.shape.sells}`,
    '',
    `${terms} What's in it, and what it doesn't cover:`,
    '',
    '[APEX MICRO EXPERIMENT PAGE]',
    '',
    `${plan.shape.sellsTo} This is being tried with a small number of businesses, and each is written to once — if it isn't relevant, no reply needed and you won't hear from ${workshop} again.`,
    '',
    workshop,
    '',
  ].join('\n');
}

// ─── Making the materials ────────────────────────────────────────────────────

export interface Made { deliverableId: string; offerTemplateId: string; offerShapeId: string; items: number; quality: { ok: boolean; failures: string[] } }

/**
 * MAKE WHAT A BRIEF NEEDS. The offer shape (the plan) is recorded as the
 * hand's; the brief is rendered from rows and refused by its own gate when it
 * is not good enough — refused, not recorded, so a bad brief never becomes a
 * deliverable a later hand could send.
 */
export async function makeBrief(input: { founderId: string; experimentId: string; spec: BriefSpec; plan: OfferShapePlan; now?: Date }): Promise<Made | { refused: string }> {
  // WHAT MAY BE SOLD IS ASKED FIRST (R23), before anything is looked up or made.
  const refusedForSale = sourcesRefusedForSale(input.spec.sourceTypes);
  if (refusedForSale.length > 0) return { refused: `a brief that is sold may not be made from ${refusedForSale.join('; ')}` };
  const { publicWorkshopOf } = await import('../../public-workshop/settings.js');
  const w = await publicWorkshopOf(input.founderId);
  if (!w) return { refused: 'there is no Workshop to speak as' };
  const made = await rowsForBrief(input.founderId, input.spec);
  if (made.items.length === 0) return { refused: `nothing retrieved for "${input.spec.terms}" from ${input.spec.sourceTypes.join(', ')} is about the subject; a brief of nothing is not a product` };
  const body = renderBrief(input.spec, made, w.publicName);
  const probe: Material = { id: 'probe', kind: 'deliverable', title: input.spec.title, body, pulledAt: made.pulledAt?.toISOString() ?? null, digest: '', paymentLinkUrl: null, recordedAt: '' };
  const quality = await checkBriefQuality(input.founderId, probe, input.now ?? new Date());
  if (!quality.ok) return { refused: `the brief did not pass its own gate: ${quality.failures.join('; ')}` };
  const offerShapeId = await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'offer_shape', title: 'offer shape', body: JSON.stringify({ ...input.plan, kind: 'data_brief', spec: input.spec }), by: HAND });
  const deliverableId = await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'deliverable', title: input.spec.title, body, pulledAt: made.pulledAt, by: HAND });
  const offerTemplateId = await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'offer_template', title: `Offer: ${input.spec.title}`, body: renderOfferTemplate(input.plan, w.publicName, 'Massachusetts'), by: HAND });
  return { deliverableId, offerTemplateId, offerShapeId, items: made.items.length, quality };
}

/**
 * THE STEWARD'S PASS OVER BRIEFS. A brief that is live, or about to be, or
 * still owed or still subscribed to, and older than the freshness rule allows,
 * has its sealed words asked again of its own sources (R28) and is re-made from
 * what came back, through the same gate. A refresh that fails its gate is
 * said so and the old edition stands until the rule stops it being sent.
 */
export async function refreshStaleBriefs(now: Date = new Date()): Promise<Array<{ experimentId: string; refreshed: boolean; because: string }>> {
  // AND A TEST NOBODY IS RUNNING ANY MORE THAT STILL OWES SOMEBODY.
  //
  // This watched live tests only. What is owed outlives the test — that is the
  // whole purchase pathway — and until now the STEWARDSHIP of what is owed did
  // not: a buyer who paid as a test settled was owed a brief, the brief went
  // past its freshness limit, the quality gate refused the delivery (rightly),
  // and nothing was ever going to re-pull it. The obligation then said "the
  // delivery goes out on the next pass" on every pass, for ever, which is the
  // promise-it-cannot-keep this institution refuses to make.
  //
  // So the steward follows the obligation, not the lifecycle.
  const { OPEN_OBLIGATION, STILL_RECURS } = await import('../obligations.js');
  const live = (await query(
    `SELECT e.id, e.founder_id FROM venture_experiments e
      WHERE e.evidence_mode = 'real'
        AND ( (e.retired_at IS NULL AND e.validity = 'valid'
               AND ((e.decision = 'approved' AND e.ran_at IS NULL) OR e.decision IS NULL))
           OR EXISTS (SELECT 1 FROM experiment_fulfilments f
                       WHERE f.experiment_id = e.id AND ${OPEN_OBLIGATION('f')})
          -- A SUBSCRIPTION THAT WILL CHARGE AGAIN (R28): the next week's
          -- edition is made before the week is paid for, not after.
          OR EXISTS (SELECT 1 FROM experiment_fulfilments f
                       WHERE f.experiment_id = e.id AND ${STILL_RECURS('f')}) )
        AND EXISTS (SELECT 1 FROM experiment_materials m WHERE m.experiment_id = e.id AND m.kind = 'offer_shape' AND m.superseded_at IS NULL AND m.body LIKE '%"kind":"data_brief"%')
      ORDER BY e.proposed_at`, [])).rows as unknown as Array<Record<string, unknown>>;
  const out: Array<{ experimentId: string; refreshed: boolean; because: string }> = [];
  for (const e of live) {
    const r = await refreshBrief({ founderId: String(e.founder_id), experimentId: String(e.id), now }).catch((err: unknown) => ({ refreshed: false, because: err instanceof Error ? err.message : String(err) }));
    if (r.because !== 'still fresh') out.push({ experimentId: String(e.id), ...r });
  }
  return out;
}

/** The relevant, linked rows of these words pulled after `since`: what a new edition may be made of. */
async function newerItemUrls(founderId: string, spec: BriefSpec, since: Date): Promise<string[]> {
  const ph = spec.sourceTypes.map(() => '?').join(',');
  const at = since.toISOString().replace('T', ' ').slice(0, 19);
  return ((await query(
    `SELECT DISTINCT i.url FROM retrieval_items i JOIN market_retrievals r ON r.id = i.retrieval_id
      WHERE r.founder_id = ? AND r.evidence_mode = 'real' AND r.source_type IN (${ph}) AND r.terms = ?
        AND i.relevant = 1 AND i.url IS NOT NULL AND r.retrieved_at > ?`,
    [founderId, ...spec.sourceTypes, spec.terms, at])).rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.url));
}

/** REFRESH A BRIEF THAT IS GOING STALE, from the same rows the eyes keep pulling. */
export async function refreshBrief(input: { founderId: string; experimentId: string; now?: Date }): Promise<{ refreshed: boolean; because: string }> {
  const shape = await materialOf(input.experimentId, 'offer_shape');
  if (!shape) return { refreshed: false, because: 'no offer shape' };
  let parsed: (OfferShapePlan & { kind?: string; spec?: BriefSpec }) | null = null;
  try { parsed = JSON.parse(shape.body) as OfferShapePlan & { kind?: string; spec?: BriefSpec }; } catch { parsed = null; }
  if (!parsed?.spec || parsed.kind !== 'data_brief') return { refreshed: false, because: 'not a brief the hands made' };
  const now = input.now ?? new Date();
  const current = await materialOf(input.experimentId, 'deliverable');
  const fresh = current && current.pulledAt && (now.getTime() - new Date(current.pulledAt).getTime()) / 86_400_000 <= DELIVERABLE_MAX_AGE_DAYS - 2;
  if (fresh) return { refreshed: false, because: 'still fresh' };
  const { publicWorkshopOf } = await import('../../public-workshop/settings.js');
  const w = await publicWorkshopOf(input.founderId);
  if (!w) return { refreshed: false, because: 'no Workshop' };
  // ASK THE SEALED WORDS AGAIN (R28), of the sources they were first asked of,
  // at most once in six days and only where the source's terms are written
  // down. Before this nothing pulled a brief's question twice, and week two
  // was whatever something else had happened to retrieve.
  const { rePullSealedQuery } = await import('../sources/re-pull.js');
  const asked = await rePullSealedQuery({ founderId: input.founderId, terms: parsed.spec.terms, sourceTypes: parsed.spec.sourceTypes, now });
  const made = await rowsForBrief(input.founderId, parsed.spec);
  // A refresh needs newer rows. Re-rendering the same pull is not freshness,
  // and would put a new date on an old edition.
  // AN EMPTY ANSWER IS NOT A NEW EDITION (R28). Asking again and hearing
  // nothing records that the question was asked; it does not make last week's
  // rows this week's. A refresh needs a relevant row from a pull newer than the
  // current edition, and a weekly brief needs one the last edition did not
  // carry, or week two is week one with a new date.
  const since = current?.pulledAt ? new Date(current.pulledAt) : null;
  const newer = since === null ? made.items.map((i) => i.url) : await newerItemUrls(input.founderId, parsed.spec, since);
  const recurs = Boolean((parsed as { price?: { recurring?: unknown } }).price?.recurring);
  const unseen = recurs && current ? newer.filter((u) => !current.body.includes(u)) : newer;
  if (made.items.length === 0 || !made.pulledAt || unseen.length === 0 || (current?.pulledAt && made.pulledAt.getTime() <= new Date(current.pulledAt).getTime())) {
    return { refreshed: false, because: `nothing fresh was retrieved${asked.notAsked.length ? ` (${asked.notAsked.join('; ')})` : ''}` };
  }
  const body = renderBrief(parsed.spec, made, w.publicName);
  const probe: Material = { id: 'probe', kind: 'deliverable', title: parsed.spec.title, body, pulledAt: made.pulledAt?.toISOString() ?? null, digest: '', paymentLinkUrl: null, recordedAt: '' };
  const quality = await checkBriefQuality(input.founderId, probe, now);
  if (!quality.ok) return { refreshed: false, because: quality.failures.join('; ') };
  await recordMaterial({ founderId: input.founderId, experimentId: input.experimentId, kind: 'deliverable', title: parsed.spec.title, body, pulledAt: made.pulledAt, by: HAND });
  return { refreshed: true, because: `re-pulled from ${String(made.retrievals.length)} retrieval(s), ${String(made.items.length)} item(s)` };
}
