// =============================================================================
// Tests: DNA auto-fill wiring + clobber-guard (Phase 1.6)
//
// The extractor (extractDNAFromAssets) was built in Wave 2 but never wired to
// anything. Phase 1.6 gathers assets, drafts, and persists — and must never
// overwrite a founder's own words.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { pickEmptyFieldUpdates } from '../../src/services/wisdom/dna-autofill.js';

const base = resolve(__dirname, '../../src');
const read = (rel: string) => readFileSync(resolve(base, rel), 'utf-8');

describe('pickEmptyFieldUpdates (clobber-guard)', () => {
  it('fills only fields that are empty on the existing record', () => {
    const existing = { icp_description: 'my own words', icp_pain: '' };
    const draft = { icp_description: 'AI draft', icp_pain: 'AI pain', icp_trigger: 'AI trigger' };
    const updates = pickEmptyFieldUpdates(existing, draft);
    expect(updates).toEqual({ icp_pain: 'AI pain', icp_trigger: 'AI trigger' });
    expect(updates.icp_description).toBeUndefined(); // never overwrites founder text
  });

  it('fills everything when there is no existing record', () => {
    const draft = { icp_description: 'a', market_insight: 'b' };
    expect(pickEmptyFieldUpdates(null, draft)).toEqual({ icp_description: 'a', market_insight: 'b' });
  });

  it('ignores empty / whitespace-only draft values', () => {
    const draft = { icp_description: '   ', icp_pain: 'real' };
    expect(pickEmptyFieldUpdates(null, draft)).toEqual({ icp_pain: 'real' });
  });

  it('treats whitespace-only existing values as empty (fillable)', () => {
    const existing = { icp_description: '   ' };
    expect(pickEmptyFieldUpdates(existing, { icp_description: 'draft' })).toEqual({ icp_description: 'draft' });
  });
});

describe('DNA auto-fill is wired into onboarding and the DNA page', () => {
  it('onboarding auto-drafts DNA after the audit', () => {
    expect(read('routes/dashboard/onboarding.ts')).toMatch(/autofillProductDNA\(/);
  });

  it('the DNA page exposes a "Draft with AI" endpoint and button', () => {
    const products = read('routes/dashboard/products.ts');
    expect(products).toMatch(/dna\/autodraft/);
    expect(products).toMatch(/Draft with AI/);
  });

  it('external assets are run through the prompt shield before the model', () => {
    expect(read('services/wisdom/dna-autofill.ts')).toMatch(/shieldOrLog/);
  });
});
