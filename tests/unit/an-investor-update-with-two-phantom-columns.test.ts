import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// AN INVESTOR UPDATE WITH TWO PHANTOM COLUMNS.
//
// `investor-update.ts` read `metric_snapshots.mrr_growth_pct` and
// `metric_snapshots.customer_count`. Neither has ever been a column — the same
// pair the fundraising assessment was found reading earlier in this campaign.
// Off a `SELECT *` row they are `undefined` forever, so every monthly investor
// update ever generated reported growth and customer count as "N/A", and the
// prior snapshot fetched two queries above to compute growth was never used.
//
// THE GENERATOR IS GONE, AND WITH IT THE CASES THAT DROVE IT. The monthly
// investor update was written by a Commercial Foundry route; when those went,
// `scp/investor/investor-update.ts` had no caller and `investor_updates` had no
// writer, so the module and the table were removed. Three cases here exercised
// that generator end to end and could not survive it — the defect they pinned
// is gone because the code that carried it is gone, not because it was fixed.
// The phantom-column half of the same defect in `fundraising-readiness.ts` is
// still live and still covered, by `a-fraction-compared-against-a-percentage`.
//
// What remains is the milder version the same read found, in a file that is
// still live: the email digest labelled the change between the two most recent
// snapshots "WoW" — week over week — when for a daily reporter it is yesterday
// against the day before.
// =============================================================================

describe('the email digest', () => {
  it('no longer calls an arbitrary interval week over week', () => {
    const src = stripComments(readFileSync('src/services/scp/briefing/email-digest.ts', 'utf8'));
    expect(src).not.toContain('WoW');
    expect(src).toContain('over 1 day');
  });
});
