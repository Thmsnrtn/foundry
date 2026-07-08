// =============================================================================
// FOUNDRY — Audit review-file selection (Phase 2.3)
// Picks the handful of source files that most inform the highest-stakes audit
// dimensions (security/trust, billing, error handling, config) so the scorer
// reviews real code instead of regex-derived counts. Budget-capped so the
// scoring prompt stays bounded.
// =============================================================================

export interface ReviewFile {
  path: string;
  content: string;
}

// Per-category path matchers, highest-stakes first. Order matters: earlier
// categories get first pick of the budget.
const CATEGORIES: Array<{ label: string; match: (p: string) => boolean }> = [
  { label: 'auth/security', match: (p) => /(auth|middleware|session|permission|rbac)/i.test(p) },
  { label: 'billing', match: (p) => /(stripe|billing|subscription|checkout|pricing)/i.test(p) },
  { label: 'error handling', match: (p) => /(error|exception|handler|resilien|retry)/i.test(p) },
  { label: 'config', match: (p) => /(fly\.toml|dockerfile|docker-compose|\.env\.example|config)/i.test(p) },
];

const MAX_FILES = 8;
const MAX_CHARS_PER_FILE = 2500;
const MAX_TOTAL_CHARS = 14_000;

/**
 * From the fetched key files, select a budget-capped set of the most
 * decision-relevant files, at least one per category when available, then
 * filling remaining budget by category priority. Content is truncated per
 * file and across the whole set. Caller sanitizes before prompting.
 */
export function selectReviewFiles(keyFiles: Map<string, string>): ReviewFile[] {
  const entries = Array.from(keyFiles.entries())
    .filter(([, content]) => content && content.trim().length > 0);

  // Bucket paths by category (a file lands in its first matching category).
  const buckets = new Map<string, string[]>();
  for (const { label } of CATEGORIES) buckets.set(label, []);
  for (const [path] of entries) {
    const cat = CATEGORIES.find((c) => c.match(path));
    if (cat) buckets.get(cat.label)!.push(path);
  }

  const contentByPath = new Map(entries);
  const selected: ReviewFile[] = [];
  const seen = new Set<string>();
  let totalChars = 0;

  const tryAdd = (path: string): boolean => {
    if (seen.has(path) || selected.length >= MAX_FILES) return false;
    const raw = contentByPath.get(path);
    if (!raw) return false;
    const content = raw.slice(0, MAX_CHARS_PER_FILE);
    if (totalChars + content.length > MAX_TOTAL_CHARS) return false;
    selected.push({ path, content });
    seen.add(path);
    totalChars += content.length;
    return true;
  };

  // Round 1: one file per category (broad coverage before depth).
  for (const { label } of CATEGORIES) {
    const paths = buckets.get(label)!;
    if (paths.length > 0) tryAdd(paths[0]);
  }

  // Round 2: fill remaining budget by category priority.
  for (const { label } of CATEGORIES) {
    for (const path of buckets.get(label)!) {
      if (selected.length >= MAX_FILES || totalChars >= MAX_TOTAL_CHARS) break;
      tryAdd(path);
    }
  }

  return selected;
}
