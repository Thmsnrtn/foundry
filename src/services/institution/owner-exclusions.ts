// =============================================================================
// FOUNDRY — never this one
//
// The owner is allowed to say "not that company", and mean it about the company
// rather than about one of its mailboxes. Everything else in this institution
// reasons about whether a business is a good idea to contact; this reasons about
// whether it is permitted, and the answer outranks every judgment underneath it:
// qualification, opportunity score, expected value, a cohort that would rather
// be one larger, and any recommendation the institution makes to itself.
//
// The enforcement is in the database (migration 299), not here. This module is
// how the rest of the code writes the boundary, reads it, and explains it —
// the refusal happens whether or not anybody remembered to call it.
//
// RESEARCH IS NOT OUTREACH. Nothing here stops the institution reading a public
// page about an excluded business. What it stops is that business becoming a
// participant in anything that writes to people.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

export type MarkKind = 'name' | 'domain' | 'email' | 'phone' | 'address';

export interface Mark { kind: MarkKind; value: string; source: string }

export interface OwnerExclusion {
  id: string; entity: string; because: string; setAt: string;
  marks: Mark[];
}

export interface LiftedExclusion {
  entity: string; liftedAt: string; liftedBy: string; because: string;
}

/**
 * WHAT HE LIFTED, AND WHO LIFTED IT. Read rather than merely written, because
 * a boundary that was taken away is exactly the kind of fact an owner should be
 * able to find later — and `lifted_by` is the part that says the institution
 * did not take it away by itself.
 */
export async function liftedExclusionsFor(founderId: string): Promise<LiftedExclusion[]> {
  return ((await query(
    `SELECT entity, lifted_at, lifted_by, lifted_reason FROM owner_exclusions
      WHERE founder_id = ? AND lifted_at IS NOT NULL ORDER BY lifted_at`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    entity: String(r.entity), liftedAt: String(r.lifted_at),
    liftedBy: String(r.lifted_by), because: String(r.lifted_reason),
  }));
}

/** Lower-cased and trimmed, because a match must be a comparison and not a hope. */
function normalise(kind: MarkKind, value: string): string {
  const v = value.trim().toLowerCase();
  if (kind === 'domain') return v.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '');
  if (kind === 'phone') return v.replace(/[^\d]/g, '');
  return v.replace(/\s+/g, ' ');
}

/**
 * NEVER THIS ONE. The owner's act, carrying every public mark that can be
 * resolved for the business, so a later discovery pass meeting it under another
 * representation still meets the boundary.
 */
export async function excludeEntity(input: {
  founderId: string; entity: string; because: string; by: string; marks: Mark[];
}): Promise<{ id: string; marks: number }> {
  const existing = (await query(
    'SELECT id FROM owner_exclusions WHERE founder_id = ? AND lower(entity) = lower(?) AND lifted_at IS NULL',
    [input.founderId, input.entity.trim()])).rows[0] as Record<string, unknown> | undefined;
  const id = existing ? String(existing.id) : nanoid();
  if (!existing) {
    await query(
      `INSERT INTO owner_exclusions (id, founder_id, entity, because, set_by)
       VALUES (?,?,?,?,?)`,
      [id, input.founderId, input.entity.trim(), input.because.trim(), input.by]);
  }
  let n = 0;
  for (const m of input.marks) {
    const value = normalise(m.kind, m.value);
    if (!value) continue;
    try {
      await query(
        `INSERT INTO owner_exclusion_marks (id, exclusion_id, kind, value, source)
         VALUES (?,?,?,?,?)`, [nanoid(), id, m.kind, value, m.source.trim()]);
      n += 1;
    } catch { /* UNIQUE: the same mark twice is the same boundary */ }
  }
  return { id, marks: n };
}

/** Only the owner lifts it, and only in words that go on the row. */
export async function liftExclusion(input: {
  founderId: string; id: string; because: string;
}): Promise<{ lifted: boolean; because: string }> {
  try {
    await query(
      `UPDATE owner_exclusions SET lifted_at = datetime('now'), lifted_by = ?, lifted_reason = ?
        WHERE id = ? AND founder_id = ? AND lifted_at IS NULL`,
      [`founder:${input.founderId}`, input.because.trim(), input.id, input.founderId]);
    return { lifted: true, because: input.because.trim() };
  } catch (e) {
    return { lifted: false, because: e instanceof Error ? e.message : String(e) };
  }
}

/** What he has said never to, so a page can show it and a pass can filter on it. */
export async function exclusionsFor(founderId: string): Promise<OwnerExclusion[]> {
  const xs = (await query(
    `SELECT id, entity, because, set_at FROM owner_exclusions
      WHERE founder_id = ? AND lifted_at IS NULL ORDER BY set_at, rowid`, [founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  const out: OwnerExclusion[] = [];
  for (const x of xs) {
    const marks = (await query(
      'SELECT kind, value, source FROM owner_exclusion_marks WHERE exclusion_id = ? ORDER BY kind, value',
      [String(x.id)])).rows as unknown as Array<Record<string, unknown>>;
    out.push({
      id: String(x.id), entity: String(x.entity), because: String(x.because),
      setAt: String(x.set_at),
      marks: marks.map((m) => ({ kind: String(m.kind) as MarkKind, value: String(m.value), source: String(m.source) })),
    });
  }
  return out;
}

/**
 * WOULD THIS BUSINESS BE REFUSED? Asked BEFORE a cohort is formed, so a pass
 * that finds an excluded business drops it quietly rather than writing a row
 * the database will refuse — and so the owner can be told the cohort is 43
 * rather than 44 because of a boundary he set, not because of a bug.
 */
export async function whyExcluded(input: {
  founderId: string; name?: string | null; email?: string | null; url?: string | null;
}): Promise<{ excluded: boolean; entity: string | null; matched: string | null }> {
  const name = (input.name ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  const email = (input.email ?? '').trim().toLowerCase();
  const url = (input.url ?? '').trim().toLowerCase();
  const rows = (await query(
    `SELECT x.entity AS entity, m.kind AS kind, m.value AS value
       FROM owner_exclusion_marks m JOIN owner_exclusions x ON x.id = m.exclusion_id
      WHERE x.founder_id = ? AND x.lifted_at IS NULL`, [input.founderId]))
    .rows as unknown as Array<Record<string, unknown>>;
  for (const r of rows) {
    const kind = String(r.kind); const value = String(r.value);
    const hit =
      (kind === 'email' && email !== '' && email === value)
      || (kind === 'domain' && email.endsWith(`@${value}`))
      || (kind === 'domain' && url !== '' && url.includes(value))
      || (kind === 'name' && name !== '' && name.includes(value));
    if (hit) return { excluded: true, entity: String(r.entity), matched: `${kind}:${value}` };
  }
  return { excluded: false, entity: null, matched: null };
}

/**
 * THE BOUNDARIES THE OWNER HAS ALREADY DRAWN, written into a database that may
 * not have them yet.
 *
 * An exclusion he stated once has to survive a fresh machine, a restored
 * backup and a rebuilt cohort, so it lives here as a standing fact and is
 * applied before any discovery pass runs rather than remembered by whoever
 * happens to be assembling a list. Idempotent: re-applying changes nothing,
 * and an exclusion he has since lifted is NOT reinstated by re-running this —
 * `excludeEntity` only touches rows that are still standing, and a lift is his
 * act to make and his to keep.
 *
 * THE REASON IS DELIBERATELY NOT HERE. He gave one and asked that it not be
 * exposed; a reason written into a row is a reason that travels with every
 * copy of the database and every page that renders it. What has to be true is
 * that the business is never written to, and that is enforced by the marks
 * below and by the triggers in migration 299 — not by the explanation.
 */
export const STANDING_EXCLUSIONS: Array<{ entity: string; because: string; marks: Mark[] }> = [
  {
    entity: 'Nirvana Upfitters, Leominster MA',
    because: 'The owner excluded this business from anything Foundry initiates. He gave his reason privately '
      + 'and asked that it not be exposed, so it is not recorded here. The exclusion stands until he lifts it '
      + 'himself, and lifting it requires his own hand and a reason on the row.',
    marks: [
      { kind: 'name', value: 'nirvana upfitters', source: 'the owner named the business' },
      { kind: 'domain', value: 'nirvanaupfitters.com', source: 'the business\'s own public website' },
      { kind: 'email', value: 'info@nirvanaupfitters.com', source: 'the address published on the business\'s own public website' },
    ],
  },
];

/**
 * Apply them. Returns what is now standing so a caller can say the cohort is
 * one smaller because of a decision the owner made, rather than a miscount.
 */
export async function applyStandingExclusions(founderId: string): Promise<{
  entity: string; marks: number; alreadyStood: boolean;
}[]> {
  const out: { entity: string; marks: number; alreadyStood: boolean }[] = [];
  const before = await exclusionsFor(founderId);
  for (const x of STANDING_EXCLUSIONS) {
    const stood = before.some((b) => b.entity.toLowerCase() === x.entity.toLowerCase());
    const r = await excludeEntity({
      founderId, entity: x.entity, because: x.because, by: `founder:${founderId}`, marks: x.marks,
    });
    out.push({ entity: x.entity, marks: r.marks, alreadyStood: stood });
  }
  return out;
}
