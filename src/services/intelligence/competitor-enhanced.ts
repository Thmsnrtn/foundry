// =============================================================================
// FOUNDRY — Enhanced Competitor Intelligence
// Historical pricing snapshots and feature-level tracking.
// Based on migration 029 (competitor_pricing_snapshots, competitor_feature_tracking).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PricingTier {
  name: string;
  price: number | null; // monthly USD, null if custom/contact
  billing_period?: 'monthly' | 'annual';
  features: string[];
}

export interface PricingSnapshot {
  id: string;
  product_id: string;
  competitor_name: string;
  snapshot_date: string;
  tiers: PricingTier[];
  pricing_changed: boolean;
  change_summary: string | null;
  created_at: string;
}

export interface CompetitorFeature {
  id: string;
  product_id: string;
  competitor_name: string;
  feature_name: string;
  first_seen_at: string;
  source: 'changelog' | 'product_page' | 'job_posting' | 'review';
  notes: string | null;
  our_equivalent: 'shipped' | 'planned' | 'not_planned' | 'unknown';
  created_at: string;
}

export interface PricingDiff {
  added_tiers: string[];
  removed_tiers: string[];
  price_changes: Array<{ tier: string; old_price: number | null; new_price: number | null }>;
  feature_changes: Array<{ tier: string; added: string[]; removed: string[] }>;
}

// ─── Pricing Snapshots ────────────────────────────────────────────────────────

export async function recordPricingSnapshot(
  productId: string,
  competitorName: string,
  tiers: PricingTier[]
): Promise<{ id: string; changed: boolean; diff: PricingDiff | null }> {
  const id = nanoid();
  const today = new Date().toISOString().slice(0, 10);

  // Check if snapshot for today already exists
  const existing = await query(
    `SELECT id FROM competitor_pricing_snapshots WHERE product_id=? AND competitor_name=? AND snapshot_date=?`,
    [productId, competitorName, today]
  );
  if (existing.rows.length > 0) {
    return { id: (existing.rows[0] as Record<string, unknown>).id as string, changed: false, diff: null };
  }

  // Get the most recent previous snapshot to diff against
  const previous = await query(
    `SELECT pricing_json FROM competitor_pricing_snapshots
     WHERE product_id=? AND competitor_name=?
     ORDER BY snapshot_date DESC LIMIT 1`,
    [productId, competitorName]
  );

  let pricingChanged = false;
  let changeSummary: string | null = null;
  let diff: PricingDiff | null = null;

  if (previous.rows.length > 0) {
    const prevTiers = (() => {
      try { return JSON.parse((previous.rows[0] as Record<string, unknown>).pricing_json as string || '[]'); }
      catch { return []; }
    })() as PricingTier[];

    diff = computePricingDiff(prevTiers, tiers);
    pricingChanged = diff.added_tiers.length > 0 || diff.removed_tiers.length > 0
      || diff.price_changes.length > 0 || diff.feature_changes.some(f => f.added.length > 0 || f.removed.length > 0);

    if (pricingChanged) {
      const summaryParts: string[] = [];
      if (diff.added_tiers.length > 0) summaryParts.push(`New tiers: ${diff.added_tiers.join(', ')}`);
      if (diff.removed_tiers.length > 0) summaryParts.push(`Removed tiers: ${diff.removed_tiers.join(', ')}`);
      if (diff.price_changes.length > 0) {
        summaryParts.push(diff.price_changes.map(pc =>
          `${pc.tier}: $${pc.old_price ?? '?'} → $${pc.new_price ?? '?'}`
        ).join('; '));
      }
      changeSummary = summaryParts.join('. ');
    }
  }

  await query(
    `INSERT INTO competitor_pricing_snapshots (id, product_id, competitor_name, snapshot_date, pricing_json, pricing_changed, change_summary)
     VALUES (?,?,?,?,?,?,?)`,
    [id, productId, competitorName, today, JSON.stringify(tiers), pricingChanged ? 1 : 0, changeSummary]
  );

  return { id, changed: pricingChanged, diff };
}

export async function getPricingHistory(
  productId: string,
  competitorName: string,
  limit = 10
): Promise<PricingSnapshot[]> {
  const result = await query(
    `SELECT * FROM competitor_pricing_snapshots
     WHERE product_id=? AND competitor_name=?
     ORDER BY snapshot_date DESC LIMIT ?`,
    [productId, competitorName, limit]
  );

  return result.rows.map(r => parsePricingRow(r as Record<string, unknown>));
}

export async function getLatestPricingSnapshot(
  productId: string,
  competitorName: string
): Promise<PricingSnapshot | null> {
  const result = await query(
    `SELECT * FROM competitor_pricing_snapshots
     WHERE product_id=? AND competitor_name=?
     ORDER BY snapshot_date DESC LIMIT 1`,
    [productId, competitorName]
  );
  if (result.rows.length === 0) return null;
  return parsePricingRow(result.rows[0] as Record<string, unknown>);
}

export async function getRecentPricingChanges(productId: string, days = 30): Promise<PricingSnapshot[]> {
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
  const result = await query(
    `SELECT * FROM competitor_pricing_snapshots
     WHERE product_id=? AND pricing_changed=1 AND snapshot_date >= ?
     ORDER BY snapshot_date DESC`,
    [productId, since]
  );
  return result.rows.map(r => parsePricingRow(r as Record<string, unknown>));
}

// ─── Feature Tracking ─────────────────────────────────────────────────────────

export async function trackCompetitorFeature(
  productId: string,
  competitorName: string,
  featureName: string,
  opts: {
    source: CompetitorFeature['source'];
    notes?: string;
    our_equivalent?: CompetitorFeature['our_equivalent'];
  }
): Promise<{ id: string; isNew: boolean }> {
  const existing = await query(
    `SELECT id FROM competitor_feature_tracking WHERE product_id=? AND competitor_name=? AND feature_name=?`,
    [productId, competitorName, featureName]
  );

  if (existing.rows.length > 0) {
    return { id: (existing.rows[0] as Record<string, unknown>).id as string, isNew: false };
  }

  const id = nanoid();
  await query(
    `INSERT INTO competitor_feature_tracking (id, product_id, competitor_name, feature_name, first_seen_at, source, notes, our_equivalent)
     VALUES (?,?,?,?,datetime('now'),?,?,?)`,
    [id, productId, competitorName, featureName, opts.source, opts.notes ?? null, opts.our_equivalent ?? 'unknown']
  );
  return { id, isNew: true };
}

export async function updateFeatureEquivalent(
  featureId: string,
  our_equivalent: CompetitorFeature['our_equivalent']
): Promise<void> {
  await query(
    `UPDATE competitor_feature_tracking SET our_equivalent=? WHERE id=?`,
    [our_equivalent, featureId]
  );
}

export async function getCompetitorFeatures(
  productId: string,
  competitorName?: string,
  our_equivalent?: CompetitorFeature['our_equivalent']
): Promise<CompetitorFeature[]> {
  let where = 'product_id=?';
  const params: unknown[] = [productId];

  if (competitorName) { where += ' AND competitor_name=?'; params.push(competitorName); }
  if (our_equivalent) { where += ' AND our_equivalent=?'; params.push(our_equivalent); }

  const result = await query(
    `SELECT * FROM competitor_feature_tracking WHERE ${where} ORDER BY first_seen_at DESC`,
    params
  );

  return result.rows.map(r => {
    const row = r as Record<string, unknown>;
    return {
      id: row.id as string,
      product_id: row.product_id as string,
      competitor_name: row.competitor_name as string,
      feature_name: row.feature_name as string,
      first_seen_at: row.first_seen_at as string,
      source: row.source as CompetitorFeature['source'],
      notes: (row.notes as string) ?? null,
      our_equivalent: row.our_equivalent as CompetitorFeature['our_equivalent'],
      created_at: row.created_at as string,
    };
  });
}

export async function getFeatureGapSummary(productId: string): Promise<{
  unknown_count: number;
  planned_count: number;
  shipped_count: number;
  not_planned_count: number;
  by_competitor: Array<{ competitor: string; unknown: number; planned: number; shipped: number }>;
}> {
  const result = await query(
    `SELECT competitor_name, our_equivalent, COUNT(*) as c
     FROM competitor_feature_tracking
     WHERE product_id=?
     GROUP BY competitor_name, our_equivalent`,
    [productId]
  );

  const rows = result.rows as Array<Record<string, unknown>>;
  let unknown_count = 0, planned_count = 0, shipped_count = 0, not_planned_count = 0;
  const byCompetitor: Record<string, { unknown: number; planned: number; shipped: number }> = {};

  for (const row of rows) {
    const comp = row.competitor_name as string;
    const eq = row.our_equivalent as string;
    const c = Number(row.c);

    if (!byCompetitor[comp]) byCompetitor[comp] = { unknown: 0, planned: 0, shipped: 0 };
    if (eq === 'unknown') { unknown_count += c; byCompetitor[comp].unknown += c; }
    if (eq === 'planned') { planned_count += c; byCompetitor[comp].planned += c; }
    if (eq === 'shipped') { shipped_count += c; byCompetitor[comp].shipped += c; }
    if (eq === 'not_planned') not_planned_count += c;
  }

  return {
    unknown_count, planned_count, shipped_count, not_planned_count,
    by_competitor: Object.entries(byCompetitor).map(([competitor, counts]) => ({ competitor, ...counts })),
  };
}

// ─── Internal ─────────────────────────────────────────────────────────────────

function parsePricingRow(row: Record<string, unknown>): PricingSnapshot {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    competitor_name: row.competitor_name as string,
    snapshot_date: row.snapshot_date as string,
    tiers: (() => { try { return JSON.parse(row.pricing_json as string || '[]'); } catch { return []; } })(),
    pricing_changed: row.pricing_changed === 1 || row.pricing_changed === true,
    change_summary: (row.change_summary as string) ?? null,
    created_at: row.created_at as string,
  };
}

function computePricingDiff(prev: PricingTier[], curr: PricingTier[]): PricingDiff {
  const prevNames = new Set(prev.map(t => t.name));
  const currNames = new Set(curr.map(t => t.name));

  const added_tiers = curr.filter(t => !prevNames.has(t.name)).map(t => t.name);
  const removed_tiers = prev.filter(t => !currNames.has(t.name)).map(t => t.name);

  const price_changes: PricingDiff['price_changes'] = [];
  const feature_changes: PricingDiff['feature_changes'] = [];

  for (const currTier of curr) {
    const prevTier = prev.find(t => t.name === currTier.name);
    if (!prevTier) continue;

    if (prevTier.price !== currTier.price) {
      price_changes.push({ tier: currTier.name, old_price: prevTier.price, new_price: currTier.price });
    }

    const prevFeatures = new Set(prevTier.features);
    const currFeatures = new Set(currTier.features);
    const added = currTier.features.filter(f => !prevFeatures.has(f));
    const removed = prevTier.features.filter(f => !currFeatures.has(f));
    if (added.length > 0 || removed.length > 0) {
      feature_changes.push({ tier: currTier.name, added, removed });
    }
  }

  return { added_tiers, removed_tiers, price_changes, feature_changes };
}
