// =============================================================================
// FOUNDRY — The public Workshop: one durable identity the world can trust.
//
// Apex Micro is the permanent public workshop operated by the owner as a
// person. It is not a company Foundry invented, not a persona, and not a
// second institution: it is the one face through which every externally
// exposed experiment enters the world, so that the hundredth test costs the
// owner no domain, no mailbox, no DNS and no site. Its rows are the source
// every public page is projected from; nothing public is authored anywhere
// else.
//
// STOPPING NEW ECONOMIC ACTIVITY IS NOT ABANDONING WHAT IS OWED. The owner's
// pause here stops offers, placements and new tests. Deliveries, refunds,
// the public record and the contact path carry on, because a customer's claim
// on the Workshop does not depend on whether the owner is paying attention.
// =============================================================================
import { query } from '../../db/client.js';

export interface PublicWorkshop {
  founderId: string; productId: string; publicName: string; operatorName: string; origin: string; zoneName: string;
  contactEmail: string; statement: string; about: string; workerName: string; kvNamespaceId: string | null;
  postalAddress: string | null; contactGapDays: number; contactCeilingPerYear: number;
  /**
   * WHERE APEX MICRO KEEPS ITS OWN POST. A store of the Workshop's, written by
   * the edge before Foundry is told anything, so that Foundry being down
   * cannot lose a message. Never the page store, which the world can read.
   * Absent means the Workshop cannot be given ears.
   */
  mailKvNamespaceId: string | null;
  economicPause: { at: string; reason: string; by: string } | null;
  health: Record<string, unknown> | null; healthAt: string | null;
}

/** The owner-approved founding voice, kept in code so the rows can be seeded
 * from it and the doctrine can point at one text. Polished, not rewritten. */
export const APEX_MICRO = {
  publicName: 'Apex Micro',
  operatorName: 'Thomas Norton',
  zoneName: 'apexmicro.ai',
  contactLocalPart: 'thomas',
  tagline: 'a small digital workshop run by Thomas Norton',
  // SAID THE WAY A PERSON SAYS IT. The first version explained the business
  // model — what an experiment is, what happens to one, why some are closed —
  // before a visitor knew what was made here. It was accurate and it read like
  // a prospectus. Every fact in it survives: it is his, it is small, the things
  // are tried for real, software does much of the work, the responsibility is
  // his, and what does not work is closed and says so.
  statement: [
    'Apex Micro is my small digital workshop. I build practical, niche things, try them out in the real world, and keep working on the ones that turn out to be useful.',
    'I\'m Thomas Norton. Software I\'ve built does a lot of the research and the day-to-day running, but everything here is mine and so is the responsibility. Each thing says what it costs, what you get and what it doesn\'t cover. The ones that don\'t work get closed, and their page stays up saying so.',
  ].join('\n\n'),
} as const;

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

function project(r: Row): PublicWorkshop {
  return {
    founderId: String(r.founder_id), productId: String(r.product_id), publicName: String(r.public_name), operatorName: String(r.operator_name),
    origin: String(r.origin), zoneName: String(r.zone_name), contactEmail: String(r.contact_email), statement: String(r.statement), about: String(r.about ?? ''),
    workerName: String(r.worker_name), kvNamespaceId: r.kv_namespace_id == null ? null : String(r.kv_namespace_id),
    postalAddress: r.postal_address == null ? null : String(r.postal_address),
    mailKvNamespaceId: r.mail_kv_namespace_id == null ? null : String(r.mail_kv_namespace_id),
    contactGapDays: Number(r.contact_gap_days), contactCeilingPerYear: Number(r.contact_ceiling_per_year),
    economicPause: r.economic_pause_at == null ? null : { at: String(r.economic_pause_at), reason: String(r.economic_pause_reason ?? ''), by: String(r.economic_pause_by ?? '') },
    health: r.health_json == null ? null : (JSON.parse(String(r.health_json)) as Record<string, unknown>), healthAt: r.health_at == null ? null : String(r.health_at),
  };
}

export async function publicWorkshopOf(founderId: string): Promise<PublicWorkshop | null> {
  const r = (await rows('SELECT * FROM public_workshop WHERE founder_id = ?', [founderId]))[0];
  return r ? project(r) : null;
}

/** The Workshop an experiment belongs to: its owner's. */
export async function publicWorkshopOfExperiment(experimentId: string): Promise<PublicWorkshop | null> {
  const r = (await rows('SELECT w.* FROM public_workshop w JOIN venture_experiments e ON e.founder_id = w.founder_id WHERE e.id = ?', [experimentId]))[0];
  return r ? project(r) : null;
}

/** The company the Workshop acts and sends as: the owner's one earned real company. */
async function earnedCompanyOf(founderId: string): Promise<string | null> {
  const r = await rows(`SELECT id FROM products WHERE owner_id = ? AND standing = 'earned' AND reality = 'real' AND deleted_at IS NULL`, [founderId]);
  return r.length === 1 ? String(r[0].id) : null;
}

export class WorkshopRefused extends Error {
  constructor(public readonly code: string, detail?: string) { super(detail ? `${code}: ${detail}` : code); this.name = 'WorkshopRefused'; }
}

/** Idempotent: the Workshop exists once per owner, from the approved voice. */
export async function establishPublicWorkshop(input: { founderId: string; zoneName?: string; about?: string }): Promise<PublicWorkshop> {
  const existing = await publicWorkshopOf(input.founderId);
  if (existing) return existing;
  const productId = await earnedCompanyOf(input.founderId);
  if (!productId) throw new WorkshopRefused('no_earned_company', 'the Workshop acts as your one earned real company, and Foundry cannot tell which that is');
  const zone = (input.zoneName ?? APEX_MICRO.zoneName).toLowerCase();
  await query(
    `INSERT INTO public_workshop (founder_id, product_id, public_name, operator_name, origin, zone_name, contact_email, statement, about)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [input.founderId, productId, APEX_MICRO.publicName, APEX_MICRO.operatorName, `https://${zone}`, zone, `${APEX_MICRO.contactLocalPart}@${zone}`, APEX_MICRO.statement, input.about ?? '']);
  return (await publicWorkshopOf(input.founderId))!;
}

export async function setWorkshopStore(founderId: string, kvNamespaceId: string): Promise<void> {
  await query(`UPDATE public_workshop SET kv_namespace_id = ?, updated_at = datetime('now') WHERE founder_id = ?`, [kvNamespaceId, founderId]);
}

/** Owner-supplied only. Never his home address by default; never invented. */
/** The store the Workshop keeps its own post in. Never the page store. */
export async function setMailStore(founderId: string, namespaceId: string | null): Promise<void> {
  await query(`UPDATE public_workshop SET mail_kv_namespace_id = ?, updated_at = datetime('now') WHERE founder_id = ?`, [namespaceId?.trim() || null, founderId]);
}

/**
 * THE ADDRESS AS THE OWNER GAVE IT, AND NOTHING ELSE.
 *
 * A postal address arrives from a person as lines, and the lines are part of
 * what is true about it: a suite and a mailbox number on their own line are not
 * decoration. It is therefore stored exactly as supplied and reshaped only at
 * the moment of rendering — a block where a block reads (the site footer, the
 * legal pages) and one line where only one line fits (an email footer). One
 * recorded truth, two readings of it, no second copy to drift.
 */
export function postalLines(address: string | null): string[] {
  return (address ?? '').split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
}

export async function setPostalAddress(founderId: string, address: string | null): Promise<void> {
  // Trailing and leading blanks are noise; the lines between them are not.
  const a = postalLines(address).join('\n') || null;
  await query(`UPDATE public_workshop SET postal_address = ?, updated_at = datetime('now') WHERE founder_id = ?`, [a, founderId]);
}

/** Owner-supplied biography, for the About page. Nothing is mined for it. */
export async function setAbout(founderId: string, about: string): Promise<void> {
  await query(`UPDATE public_workshop SET about = ?, updated_at = datetime('now') WHERE founder_id = ?`, [about.trim(), founderId]);
}

export async function pauseNewEconomicActivity(input: { founderId: string; reason: string }): Promise<void> {
  const reason = input.reason.trim();
  if (!reason) throw new WorkshopRefused('reason_required');
  await query(
    `UPDATE public_workshop SET economic_pause_at = datetime('now'), economic_pause_reason = ?, economic_pause_by = ?, updated_at = datetime('now')
      WHERE founder_id = ? AND economic_pause_at IS NULL`, [reason, `founder:${input.founderId}`, input.founderId]);
}

export async function resumeEconomicActivity(founderId: string): Promise<void> {
  await query(`UPDATE public_workshop SET economic_pause_at = NULL, economic_pause_reason = NULL, economic_pause_by = NULL, updated_at = datetime('now') WHERE founder_id = ?`, [founderId]);
}

export async function newEconomicActivityPaused(founderId: string): Promise<boolean> {
  return (await publicWorkshopOf(founderId))?.economicPause !== null && (await publicWorkshopOf(founderId)) !== null;
}

export async function recordWorkshopHealth(founderId: string, health: Record<string, unknown>): Promise<void> {
  await query(`UPDATE public_workshop SET health_json = ?, health_at = datetime('now'), updated_at = datetime('now') WHERE founder_id = ?`, [JSON.stringify(health), founderId]);
}
