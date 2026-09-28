// =============================================================================
// THE BUYER CAN GET THE FILE, ON THE PHONE THEY BOUGHT IT ON.
//
// The owner's handoff of 28 September: Etsy's app does not download digital
// purchases; a buyer is sent to a browser or a computer. A buyer on an iPhone
// who cannot find the file is the most likely first help request this listing
// will ever get, and the owner's acts said nothing about it.
//
// So the acts carry the answer to give, where to find it, and its source with
// the date and who read it. They do not ask him to change the listing's own
// text during the test: that would change what the sealed test measures.
// =============================================================================
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OWNER_ACTS_MD } from '../../src/services/venture/proof-2-content.js';

describe('helping a buyer get the file', () => {
  it('says the app cannot download it, and the exact way that works', () => {
    expect(OWNER_ACTS_MD).toMatch(/Etsy's app cannot download digital purchases/);
    expect(OWNER_ACTS_MD).toMatch(/in a browser/);
    expect(OWNER_ACTS_MD).toMatch(/Purchases/);
  });

  it('names its source, when it was read and by whom, and that this environment could not read it', () => {
    expect(OWNER_ACTS_MD).toMatch(/How to Download a Digital Item/);
    expect(OWNER_ACTS_MD).toMatch(/28 September 2026/);
    expect(OWNER_ACTS_MD).toMatch(/could not open Etsy's pages/);
  });

  it('does not change the sealed listing during the test', () => {
    expect(OWNER_ACTS_MD).toMatch(/not the listing's own text during the test/);
    expect(OWNER_ACTS_MD).toBe(readFileSync('river/proof-2/owner-acts.md', 'utf8'));
  });
});
