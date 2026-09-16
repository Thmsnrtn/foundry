import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// The reconstruction has crossed the visual cutover: there is one canonical
// stylesheet again. These boundaries hold the cockpit qualities that justified
// the migration without permitting a second visual system to grow beside it.
const ROOT = resolve(import.meta.dirname, '../..');
const shell = () => readFileSync(resolve(ROOT, 'src/views/owner/shell.ts'), 'utf8');
const css = () => readFileSync(resolve(ROOT, 'src/public/owner.css'), 'utf8');

describe('the reconstructed owner cockpit', () => {
  it('has one canonical stylesheet and no migration layer', () => {
    const source = shell();
    expect(source).toContain('/static/owner.css');
    expect(source).not.toContain('owner-live.css');
    expect(css()).toContain('OWNER OS VISUAL RECONSTRUCTION — CANONICAL CUTOVER');
    expect(css()).toMatch(/\.btn\{[^}]*max-width:100%/);
  });

  it('uses desktop width as information space instead of stretching the phone', () => {
    const source = css();
    expect(source).toContain('--os-max:88rem');
    expect(source).toMatch(/@media \(min-width:900px\)[\s\S]*\.glance\{grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/);
    expect(source).toMatch(/@media \(min-width:1280px\)[\s\S]*\.glance\{grid-template-columns:repeat\(6,minmax\(0,1fr\)\)/);
    expect(source).toMatch(/nav\.places\{[^}]*width:17\.5rem/);
  });

  it('keeps explicit light mode and reduced motion first-class', () => {
    const source = css();
    expect(source).toContain(':root[data-theme="light"]');
    expect(source).toContain('@media (prefers-color-scheme:light)');
    expect(source).toContain('@media (prefers-reduced-motion:reduce)');
  });

  it('reserves warm consequence treatment for the owner decision surface', () => {
    const source = css();
    expect(source).toContain('--os-gold:');
    expect(source).toMatch(/\.one\{\s*border-color:var\(--os-gold\)/);
    expect(source).toMatch(/\.one:not\(\.alert\)\{background:/);
  });
});
