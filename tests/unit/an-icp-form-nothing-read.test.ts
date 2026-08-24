import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// AN ICP FORM NOTHING READ, WRITING OVER A FIELD FOUR PROMPTS DO.
//
// The Koldly page carried a second Ideal Customer Profile editor. It said
// "Koldly uses this to target outbound campaigns", and on save it ran
// `UPDATE products SET stack_description = ?` with a JSON blob of the ICP —
// destroying the stack description that column is for, which the competitive
// scan, the expansion analysis, the ethics audit and the cohort-pattern reader
// all put into their prompts. Nothing anywhere read the ICP it wrote.
//
// `GET /internal/icp`, the endpoint the copy pointed at, returns five constants
// describing FOUNDRY's own ideal customer — "Technical founder / solo
// developer", "No operational layer". It takes no company id. It could not have
// served this form's answers to anyone.
//
// The ICP that IS read lives in `product_dna` — icp_description, icp_pain,
// icp_trigger — behind a tier gate and a `can_manage_company` capability,
// because editing it changes what the whole institution believes about the
// company. A second editor for the same concept, with neither gate, writing to
// the wrong column, is not a feature.
// =============================================================================

const page = readFileSync('src/routes/dashboard/koldly.ts', 'utf8');
const code = stripComments(page);

describe('the second ICP editor', () => {
  it('no longer writes over the stack description', () => {
    expect(code).not.toContain('UPDATE products SET stack_description');
  });

  it('is gone entirely rather than pointed somewhere else', () => {
    expect(code).not.toContain("koldlyRoutes.post('/koldly/icp'");
    expect(code).not.toContain('icpSchema');
    expect(code).not.toContain('qualifying_signals');
  });

  it('points at the DNA, which is where the ICP the agents read lives', () => {
    expect(page).toContain('/dna');
  });
});

describe('what the page says about the integration', () => {
  it('does not call a configured environment variable a connection', () => {
    expect(code).not.toContain("'Connected'");
    expect(code).toContain('Configured (not tested)');
  });

  it('says the ICP endpoint returns a fixed profile', () => {
    expect(code).toContain('a FIXED profile');
  });

  it('says the two company-scoped endpoints require a scoped principal', () => {
    expect(code).toContain('Requires a principal scoped to that company');
  });
});

describe('the endpoint itself', () => {
  const eco = stripComments(readFileSync('src/routes/internal/ecosystem.ts', 'utf8'));

  it('is still a constant, which is why the page now says so', () => {
    // Not a defect to fix here: serving a company's ICP from an unscoped
    // endpoint would widen exactly the surface OWNER_DECISIONS §12 is about.
    expect(eco).toContain("target_role: 'Technical founder / solo developer'");
    expect(eco).not.toMatch(/\/internal\/icp[\s\S]{0,400}product_id/);
  });
});
