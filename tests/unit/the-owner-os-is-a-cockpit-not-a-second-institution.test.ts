import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// =============================================================================
// THE OWNER OS IS A COCKPIT, NOT A SECOND INSTITUTION.
//
// The reconstruction deliberately lives after the canonical owner stylesheet
// while the visual cutover is proven. The base sheet still carries the phone,
// accessibility and component invariants accumulated from browser failures;
// the live sheet is allowed to change presentation, not to fork those rules or
// manufacture owner state. These are static boundaries around that migration.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');
const shell = () => readFileSync(resolve(ROOT, 'src/views/owner/shell.ts'), 'utf8');
const base = () => readFileSync(resolve(ROOT, 'src/public/owner.css'), 'utf8');
const live = () => readFileSync(resolve(ROOT, 'src/public/owner-live.css'), 'utf8');

describe('the reconstructed owner cockpit', () => {
  it('loads after the canonical owner stylesheet, rather than replacing it', () => {
    const source = shell();
    const canonical = source.indexOf('/static/owner.css');
    const reconstruction = source.indexOf('/static/owner-live.css');
    expect(canonical).toBeGreaterThan(-1);
    expect(reconstruction).toBeGreaterThan(canonical);

    // The hard-won mobile primitive is still in the canonical sheet. This also
    // catches an import-only wrapper that the static overflow gate cannot read.
    expect(base()).toMatch(/\.btn\{[^}]*max-width:100%/);
  });

  it('uses desktop width as information space instead of stretching the phone', () => {
    const css = live();
    expect(css).toContain('--os-max:88rem');
    expect(css).toMatch(/@media \(min-width:900px\)[\s\S]*\.glance\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    expect(css).toMatch(/@media \(min-width:1280px\)[\s\S]*\.glance\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
    expect(css).toMatch(/nav\.places\{[^}]*width:17\.5rem/);
  });

  it('keeps explicit light mode and reduced motion first-class', () => {
    const css = live();
    expect(css).toContain(':root[data-theme="light"]');
    expect(css).toContain('@media (prefers-color-scheme:light)');
    expect(css).toContain('@media (prefers-reduced-motion:reduce)');
  });

  it('reserves warm consequence treatment for the owner decision surface', () => {
    const css = live();
    expect(css).toContain('--os-gold:');
    expect(css).toMatch(/\.one\{\s*border-color:var\(--os-gold\)/);
    expect(css).toMatch(/\.one:not\(\.alert\)\{background:/);
  });
});
