import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '../..');
const shell = () => readFileSync(resolve(ROOT, 'src/views/owner/shell.ts'), 'utf8');
const script = () => readFileSync(resolve(ROOT, 'src/lib/owner-surface-script.ts'), 'utf8');
const css = () => readFileSync(resolve(ROOT, 'src/public/owner.css'), 'utf8');

describe('V3 mobile owner navigation follows page context', () => {
  it('keeps the handoff core five addressable, including Ask', () => {
    const source = script();
    expect(source).toContain("'/foundry':1");
    expect(source).toContain("'/foundry/companies':1");
    expect(source).toContain("'/foundry/experiments':1");
    expect(source).toContain("'/foundry/inbox':1");
    expect(source).toContain("'/foundry#ask-foundry':1");
    expect(shell()).toContain('class="ask-door" href="/foundry#ask-foundry"');
  });

  it('uses the handoff five, six and nine door compositions', () => {
    const source = script();
    expect(source).toContain("var columns=full?9:(contextual?6:5)");
    expect(source).toContain("var full=!ask&&place==='foundry'");
    expect(source).toContain("activeHref==='/foundry/decisions'?3:4");
    expect(source).toContain("activeHref==='/foundry/decisions'?4:3");
  });

  it('does not encode mobile door meaning as DOM position', () => {
    expect(css()).not.toMatch(/nav\.places a:nth-of-type/);
    expect(script()).toContain('must not be encoded as nth-child guesses');
  });
});
