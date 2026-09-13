import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// AN ICP FORM NOTHING READ — AND THE ENDPOINT IT POINTED AT, WHICH IS STILL HERE.
//
// A Commercial Foundry page carried a second Ideal Customer Profile editor. It
// said the outbound integration used it to target campaigns, and on save it ran
// `UPDATE products SET stack_description = ?` with a JSON blob of the ICP —
// destroying the stack description that column is for, which the competitive
// scan, the expansion analysis, the ethics audit and the cohort-pattern reader
// all put into their prompts. Nothing anywhere read the ICP it wrote. That page
// has since been removed, and the editor with it.
//
// What did NOT go is `GET /internal/icp`, the endpoint the copy pointed at. It
// returns five constants describing FOUNDRY's own ideal customer — "Technical
// founder / solo developer", "No operational layer" — and takes no company id,
// which is why it could not have served that form's answers to anyone.
//
// The ICP that IS read lives in `product_dna` — icp_description, icp_pain,
// icp_trigger — behind a tier gate and a `can_manage_company` capability,
// because editing it changes what the whole institution believes about the
// company. The reason `/internal/icp` must stay a fixed profile outlives the
// page that misread it: making it company-scoped would serve a named company's
// profile from an endpoint with no such gate, which is the surface
// OWNER_DECISIONS §12 is about. That is the check kept here.
// =============================================================================

describe('the internal ICP endpoint', () => {
  const eco = stripComments(readFileSync('src/routes/internal/ecosystem.ts', 'utf8'));

  it('is still a constant describing Foundry, not a company', () => {
    expect(eco).toContain("target_role: 'Technical founder / solo developer'");
  });

  it('takes no company id, so there is nothing for it to leak', () => {
    expect(eco, 'a company-scoped ICP here would widen exactly the surface §12 names')
      .not.toMatch(/\/internal\/icp[\s\S]{0,400}product_id/);
  });
});
