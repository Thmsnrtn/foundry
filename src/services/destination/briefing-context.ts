// =============================================================================
// FOUNDRY — Destination Briefing Context (V3.1 Layer A)
// Builds the destination block injected into briefing headlines and
// agent system prompts. Pure read; no mutations.
// =============================================================================

import { computeGap, getNorthStar, type NorthStarGap } from './north-star.js';
import { getActiveTree, type OutcomeBranch } from './outcome-tree.js';

export interface DestinationContext {
  has_north_star: boolean;
  north_star_summary: string | null;          // one-line founder-written summary
  arr_progress_line: string | null;           // "$48K / $600K ARR (8% — 280 days to target)"
  paying_progress_line: string | null;        // "12 / 50 paying accounts (24%)"
  on_track: boolean | null;
  active_branch_count: number;
  top_branches: Array<{
    label: string;
    progress_pct: number | null;
    kill_criterion: string;
  }>;
  /**
   * Single human-readable block ready to drop into a briefing headline,
   * a system prompt, or any text surface. Empty string if no destination set
   * — callers should branch on empty rather than null-checking each field.
   */
  briefing_block: string;
}

/**
 * Build the destination context for a product.
 * Returns a context object; never throws on missing data — instead returns
 * `has_north_star: false` and an empty `briefing_block`.
 */
export async function buildDestinationContext(
  productId: string
): Promise<DestinationContext> {
  const ns = await getNorthStar(productId);
  if (!ns) {
    return emptyContext();
  }

  const gap = await computeGap(productId);
  const tree = await getActiveTree(productId);

  const arrLine = formatArrLine(gap);
  const payingLine = formatPayingLine(gap);
  const topBranches = pickTopBranches(tree, 3);

  const briefingBlock = buildBriefingBlock({
    summary: ns.destination_summary,
    arr_line: arrLine,
    paying_line: payingLine,
    on_track: gap?.on_track ?? null,
    top_branches: topBranches,
  });

  return {
    has_north_star: true,
    north_star_summary: ns.destination_summary,
    arr_progress_line: arrLine,
    paying_progress_line: payingLine,
    on_track: gap?.on_track ?? null,
    active_branch_count: tree.length,
    top_branches: topBranches,
    briefing_block: briefingBlock,
  };
}

// ─── Formatters ───────────────────────────────────────────────────────────────

function emptyContext(): DestinationContext {
  return {
    has_north_star: false,
    north_star_summary: null,
    arr_progress_line: null,
    paying_progress_line: null,
    on_track: null,
    active_branch_count: 0,
    top_branches: [],
    briefing_block: '',
  };
}

function formatArrLine(gap: NorthStarGap | null): string | null {
  if (!gap || gap.arr_target_dollars == null) return null;
  const target = formatUsdK(gap.arr_target_dollars);
  const current = gap.arr_current_dollars != null
    ? formatUsdK(gap.arr_current_dollars)
    : '?';
  const pct = gap.arr_progress_pct != null
    ? ` (${Math.round(gap.arr_progress_pct)}%`
    : '';
  const days = gap.days_to_target != null
    ? ` — ${gap.days_to_target} days to target)`
    : pct ? ')' : '';
  return `${current} / ${target} ARR${pct}${days}`;
}

function formatPayingLine(gap: NorthStarGap | null): string | null {
  if (!gap || gap.paying_accounts_target == null) return null;
  const current = gap.paying_accounts_current ?? 0;
  const target = gap.paying_accounts_target;
  const pct = gap.paying_accounts_progress_pct != null
    ? ` (${Math.round(gap.paying_accounts_progress_pct)}%)`
    : '';
  return `${current} / ${target} paying accounts${pct}`;
}

function pickTopBranches(
  tree: OutcomeBranch[],
  limit: number
): DestinationContext['top_branches'] {
  // Prioritize root branches with both target and current values, ranked by
  // gap-to-target (largest gap first — most attention needed).
  const roots = tree.filter(b => b.parent_branch_id === null);
  const scored = roots.map(b => {
    let progressPct: number | null = null;
    if (b.current_value != null && b.target_value != null && b.target_value > 0) {
      progressPct = Math.max(0, Math.min(100, (b.current_value / b.target_value) * 100));
    }
    return { branch: b, progress: progressPct };
  });
  scored.sort((a, b) => {
    // Branches with progress info first; among them, lowest progress first
    if (a.progress != null && b.progress == null) return -1;
    if (a.progress == null && b.progress != null) return 1;
    if (a.progress != null && b.progress != null) return a.progress - b.progress;
    return 0;
  });
  return scored.slice(0, limit).map(({ branch, progress }) => ({
    label: branch.label,
    progress_pct: progress,
    kill_criterion: branch.kill_criterion,
  }));
}

function buildBriefingBlock(parts: {
  summary: string | null;
  arr_line: string | null;
  paying_line: string | null;
  on_track: boolean | null;
  top_branches: DestinationContext['top_branches'];
}): string {
  const lines: string[] = [];
  if (parts.summary) lines.push(`North Star: ${parts.summary}`);

  const progressLines: string[] = [];
  if (parts.arr_line) progressLines.push(parts.arr_line);
  if (parts.paying_line) progressLines.push(parts.paying_line);
  if (progressLines.length > 0) {
    lines.push(`Progress: ${progressLines.join(' · ')}`);
  }

  if (parts.on_track === true) lines.push('Pace: on track');
  if (parts.on_track === false) lines.push('Pace: behind');

  if (parts.top_branches.length > 0) {
    lines.push('Active branches:');
    for (const b of parts.top_branches) {
      const pct = b.progress_pct != null ? ` (${Math.round(b.progress_pct)}%)` : '';
      lines.push(`  · ${b.label}${pct}`);
    }
  }

  return lines.join('\n');
}

function formatUsdK(amount: number): string {
  if (amount >= 1_000_000) return `$${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1000) return `$${Math.round(amount / 1000)}K`;
  return `$${Math.round(amount)}`;
}
