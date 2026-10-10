// =============================================================================
// FOUNDRY — ONE PRODUCT, ONE VERSION, WHATEVER CHANNEL SHOWS IT (F2).
//
// The canonical listing is composed from the experiment's own rows — the offer
// shape the hand recorded, the printable it made — never written fresh for a
// channel. Every channel shows the same title, version, price, file and
// disclosure; a channel adapter may only re-format it. What the file IS
// (fillable, tagged) is read from the file's own bytes, never assumed.
//
// THE AI DISCLOSURE IS PART OF THE PRODUCT, not a channel setting: none of the
// three marketplaces' APIs has a field for it (channels.ts), so it is written
// into the description every channel carries, with the date it was made.
//
// And it is held to the same honesty gate as the Workshop's page: a banned
// claim or an invented figure in it refuses the listing (fabricationScan).
// =============================================================================
import { query } from '../../../db/client.js';

/** The HTTP every channel adapter uses: the SSRF-guarded fetch, or a recorded fixture in a test. */
export type ChannelHttp = (url: string, init?: RequestInit) => Promise<Response>;
let substitute: ChannelHttp | null = null;
/** For tests: answer channel requests from recorded fixtures (null restores the network). */
export function useChannelHttp(h: ChannelHttp | null): void { substitute = h; }
export async function channelHttp(url: string, init?: RequestInit): Promise<Response> {
  if (substitute) return substitute(url, init);
  const { safeFetch } = await import('../../outbound/ssrf.js');
  return safeFetch(url, { ...init, signal: init?.signal ?? AbortSignal.timeout(30_000) });
}

export interface CanonicalListing {
  founderId: string; experimentId: string;
  /** The asset the door acts for (products.from_experiment_id), or null before one exists. */
  productId: string | null;
  version: number; title: string; priceCents: number; currency: 'usd';
  description: string;
  file: { filename: string; bytes: number; sha256: string; pages: number; pdf: Buffer; fillable: boolean; tagged: boolean };
  aiMade: { on: string; sentence: string };
  evidenceMode: 'real' | 'sandbox' | 'reference';
}

type Row = Record<string, unknown>;

/** Compose the canonical listing for an experiment's printable, or say why there is none. */
export async function canonicalListing(founderId: string, experimentId: string): Promise<CanonicalListing | { refused: string }> {
  const exp = (await query(
    `SELECT e.evidence_mode, (SELECT p.id FROM products p WHERE p.from_experiment_id = e.id AND p.deleted_at IS NULL) AS product_id
       FROM venture_experiments e WHERE e.id = ? AND e.founder_id = ?`, [experimentId, founderId])).rows[0] as Row | undefined;
  if (!exp) return { refused: 'there is no such test of yours' };
  // One live row per kind (idx_experiment_materials_live).
  const mat = async (kind: string): Promise<{ body: string } | null> => {
    const r = (await query(
      `SELECT body FROM experiment_materials WHERE experiment_id = ? AND founder_id = ? AND kind = ? AND superseded_at IS NULL`,
      [experimentId, founderId, kind])).rows[0] as Row | undefined;
    return r ? { body: String(r.body) } : null;
  };
  const shapeRow = await mat('offer_shape');
  const deliverable = await mat('deliverable');
  const { printablePlanOf, printableOf } = await import('../products/printable.js');
  const plan = printablePlanOf(shapeRow?.body);
  const file = deliverable ? printableOf({ body: deliverable.body } as never) : null;
  if (!shapeRow || !plan || !file) return { refused: 'this test does not sell a printable file' };
  if (plan.held) return { refused: `the panel was split on it and it waits for you: ${plan.held}` };
  if (plan.sha256 !== file.sha256 || plan.version !== file.version) return { refused: 'the file and its offer disagree about which version is for sale' };
  const shape = JSON.parse(shapeRow.body) as { price?: { amountCents?: number; recurring?: unknown; chosen?: unknown }; shape?: { sells?: string }; spec?: { subtitle?: string } };
  const priceCents = Number(shape.price?.amountCents ?? 0);
  if (!(priceCents > 0) || shape.price?.recurring || shape.price?.chosen) return { refused: 'only a file at one fixed price is listed on a channel' };

  const pdf = Buffer.from(file.pdfBase64, 'base64');
  const raw = pdf.toString('latin1');
  const fillable = /\/AcroForm\b/.test(raw);
  const tagged = /\/StructTreeRoot\b/.test(raw) && /\/Marked\s+true/.test(raw);
  const madeOn = file.madeAt.slice(0, 10);
  const aiMade = {
    on: madeOn,
    sentence: `Made with AI: its words were written by an AI model inside a fixed layout, and the file was checked by a program before it was listed (version ${String(file.version)}, ${madeOn}).`,
  };
  const what = [fillable ? 'fillable' : null, tagged ? 'tagged for screen readers' : null].filter(Boolean).join(', ');
  const description = [
    `${file.title} — version ${String(file.version)}`,
    shape.spec?.subtitle ? shape.spec.subtitle : null,
    shape.shape?.sells ? shape.shape.sells : null,
    // WHAT THE FILE IS, FROM ITS BYTES (F3 audit of F2): "fill in on screen" only
    // of a file that has fields; this said it of every file.
    `A ${String(file.pages)}-page PDF${what ? ` (${what})` : ''}, to print at home${fillable ? ' or fill in on screen' : ''}.`,
    aiMade.sentence,
  ].filter((x): x is string => !!x && x.trim() !== '').join('\n\n');

  const { fabricationScan } = await import('../products/printable.js');
  const { BANNED_CLAIMS } = await import('../hand.js');
  const lower = description.toLowerCase();
  const banned = BANNED_CLAIMS.filter((b) => lower.includes(b));
  const invented = fabricationScan(description);
  if (banned.length || invented.length) return { refused: `the listing would say what nobody can stand behind: ${[...banned, ...invented].join('; ')}` };

  return {
    founderId, experimentId, productId: exp.product_id == null ? null : String(exp.product_id),
    version: file.version, title: file.title, priceCents, currency: 'usd', description,
    file: { filename: file.filename, bytes: file.bytes, sha256: file.sha256, pages: file.pages, pdf, fillable, tagged },
    aiMade, evidenceMode: String(exp.evidence_mode) as CanonicalListing['evidenceMode'],
  };
}
