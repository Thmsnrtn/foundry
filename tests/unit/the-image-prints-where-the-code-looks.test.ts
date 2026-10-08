// =============================================================================
// THE IMAGE PRINTS WHERE THE CODE LOOKS (owner decision, 8 October 2026:
// "Chromium in the production image: yes").
//
// A renderer that finds no binary turns the printable kind off whatever the
// owner says (`mayMakePrintables`). So the contract between the production
// image and the code is load-bearing, and it has three parts, each read from
// the Dockerfile the image is actually built from, not from a description:
//
//   1. the FINAL stage (the one `fly deploy` runs) installs the package that
//      provides the binary — not the builder, whose files never ship;
//   2. the final stage sets the environment variable the code reads, to the
//      path that package installs;
//   3. the code, given exactly that environment, chooses exactly that path.
//
// And playwright-core, which drives it, reaches the image through the deps stage.
// =============================================================================
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { chromiumPath } from '../../src/services/venture/products/printable.js';

const ROOT = resolve(import.meta.dirname, '../..');
/**
 * WHAT THE DEBIAN PACKAGE PUTS WHERE. Read from the package's own file list
 * (bookworm-security, 154.0.8037.92-1~deb12u1) and confirmed by building the
 * image: /usr/bin/chromium-headless-shell is a 3-line sh wrapper, and the real
 * ELF is under /usr/lib/chromium. The code points at the ELF, so Playwright's
 * pipe and signals reach Chromium itself rather than a shell around it.
 */
const PROVIDES: Record<string, string> = { 'chromium-headless-shell': '/usr/lib/chromium/chromium-headless-shell' };

/** The Dockerfile's stages, comments and continuations folded, each with its instructions. */
function stagesOf(dockerfile: string): Array<{ from: string; lines: string[] }> {
  const logical = dockerfile.replace(/\\\r?\n/g, ' ').split(/\r?\n/).map((l) => l.trim()).filter((l) => l !== '' && !l.startsWith('#'));
  const stages: Array<{ from: string; lines: string[] }> = [];
  for (const l of logical) {
    if (/^FROM\s/i.test(l)) stages.push({ from: l, lines: [] });
    else stages.at(-1)?.lines.push(l);
  }
  return stages;
}

/** The ENV values a stage sets, both `ENV K=V` and `ENV K V` forms. */
function envOf(lines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const l of lines) {
    const m = /^ENV\s+(.*)$/i.exec(l);
    if (!m) continue;
    const body = m[1]!.trim();
    if (/^[A-Za-z_][A-Za-z0-9_]*\s+[^=\s]+$/.test(body) && !body.includes('=')) { const [k, v] = body.split(/\s+/); out[k!] = v!; continue; }
    for (const kv of body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)=("[^"]*"|\S+)/g)) out[kv[1]!] = kv[2]!.replace(/^"|"$/g, '');
  }
  return out;
}

/** The apt packages a stage installs. */
function aptOf(lines: string[]): string[] {
  return lines.filter((l) => /^RUN\s/i.test(l)).flatMap((l) => [...l.matchAll(/apt-get\s+install\s+([^&;|]+)/g)]
    .flatMap((m) => m[1]!.split(/\s+/).filter((w) => w !== '' && !w.startsWith('-'))));
}

const DOCKERFILE = readFileSync(join(ROOT, 'Dockerfile'), 'utf8');

describe('the production image provides what the renderer reads', () => {
  const stages = stagesOf(DOCKERFILE);
  const runner = stages.at(-1)!;

  it('reads a real Dockerfile with a final stage (vacuity)', () => {
    expect(stages.length).toBeGreaterThanOrEqual(2);
    expect(runner.from).toMatch(/\bAS\s+runner\b/i);
    expect(runner.lines.some((l) => /^CMD\s/.test(l))).toBe(true);
  });

  it('the final stage installs a package that provides a Chromium, and sets the path it provides', () => {
    const installed = aptOf(runner.lines).filter((p) => p in PROVIDES);
    expect(installed, 'the final stage installs no Chromium package this test knows').toHaveLength(1);
    const env = envOf(runner.lines);
    expect(env.FOUNDRY_CHROMIUM_PATH).toBe(PROVIDES[installed[0]!]);
  });

  it('given exactly the image\'s environment, the code chooses exactly that path', () => {
    const env = envOf(runner.lines);
    // The real path does not exist on this machine, so stand a file at a copy of
    // it; what is proven is that the NAME the image sets is the name the code reads.
    const dir = mkdtempSync(join(tmpdir(), 'chromium-'));
    const stand = join(dir, 'chromium-headless-shell');
    writeFileSync(stand, '');
    const asImage = Object.fromEntries(Object.entries(env).map(([k, v]) => [k, v === env.FOUNDRY_CHROMIUM_PATH ? stand : v]));
    expect(chromiumPath(asImage)).toBe(stand);
  });

  it('playwright-core, which drives it, is in the image: the runner copies the deps stage, which installs dev dependencies', () => {
    // It stays a DEV dependency on purpose (a-channel-message-goes-through-the-
    // door: no ungoverned browser in the product's declared dependencies); the
    // image carries it because the runner copies the whole deps-stage tree.
    const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as { devDependencies?: Record<string, string> };
    expect(pkg.devDependencies?.['playwright-core']).toBeTruthy();
    const deps = stages.find((s) => /\bAS\s+deps\b/i.test(s.from))!;
    expect(deps.lines.some((l) => /^RUN\s+npm ci\b/.test(l) && /--production=false|--include=dev/.test(l))).toBe(true);
    expect(runner.lines).toContain('COPY --from=deps /app/node_modules ./node_modules');
  });

  it('the parser is not decoration: a stage that drops the install or renames the variable is caught', () => {
    const moved = DOCKERFILE.replace(/FOUNDRY_CHROMIUM_PATH/g, 'CHROMIUM_PATH');
    expect(envOf(stagesOf(moved).at(-1)!.lines).FOUNDRY_CHROMIUM_PATH).toBeUndefined();
    const builderOnly = DOCKERFILE.replace(/chromium-headless-shell/g, 'chromium-nothing');
    expect(aptOf(stagesOf(builderOnly).at(-1)!.lines).filter((p) => p in PROVIDES)).toHaveLength(0);
  });
});
