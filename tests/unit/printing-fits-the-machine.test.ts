process.env.ENCRYPTION_KEY = process.env.ENCRYPTION_KEY ?? '7'.repeat(64);

// =============================================================================
// PRINTING FITS THE MACHINE (F1, 9 October 2026).
//
// Production is one Fly machine with 1 GB of memory, running the web server and
// the scheduler in one process. A headless Chromium is the largest thing that
// process ever starts. So printing is held to four rules, each tested against
// the behaviour it exists for rather than a name:
//   * ONE AT A TIME: two prints asked for together never overlap — a second
//     browser beside the first is how a 1 GB machine is pushed over;
//   * A PRINT THAT RUNS OVER IS KILLED: the browser process is gone, not merely
//     abandoned, and the queue moves on;
//   * THE BROWSER IS CLOSED after every print: no Chromium process outlives it;
//   * IT IS LAUNCHED SMALL: the low-memory flags are on the launch line.
// The measured peak is recorded in IMPLEMENTATION_STATE (scripts/measure-print-memory.mjs).
// =============================================================================

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { PRINTABLE_CONTENT_HONEST } from '../fixtures/printable-home-maintenance.js';

const P = await import('../../src/services/venture/products/printable.js');

const spec = { kind: 'printable_pdf' as const, title: 'The Home Maintenance Log', ...PRINTABLE_CONTENT_HONEST };
const meta = { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-09' };

afterEach(() => { P.useRenderer(null); P.setPrintTimeoutMs(null); });

describe('one print at a time', () => {
  it('two prints asked for together never overlap, and both finish', async () => {
    let inside = 0; let most = 0;
    const slow: import('../../src/services/venture/products/printable.js').Renderer = async () => {
      inside += 1; most = Math.max(most, inside);
      await new Promise((r) => setTimeout(r, 40));
      inside -= 1;
      return { pdf: Buffer.from('%PDF-1.4'), sections: 9, overflow: [] };
    };
    P.useRenderer(slow);
    const all = await Promise.all([P.renderPrintable(spec, meta), P.renderPrintable(spec, meta), P.renderPrintable(spec, meta)]);
    expect(all).toHaveLength(3);
    expect(most).toBe(1);
  });

  it('a print that never finishes is stopped at the timeout, its stop is signalled, and the next print still runs', async () => {
    let stopped = false;
    const hung: import('../../src/services/venture/products/printable.js').Renderer = (_html, signal) => new Promise(() => {
      signal?.addEventListener('abort', () => { stopped = true; });
    });
    P.setPrintTimeoutMs(50);
    P.useRenderer(hung);
    await expect(P.renderPrintable(spec, meta)).rejects.toThrow(/did not finish printing within/);
    expect(stopped).toBe(true);
    P.useRenderer(async () => ({ pdf: Buffer.from('%PDF-1.4'), sections: 9, overflow: [] }));
    expect((await P.renderPrintable(spec, meta)).sections).toBe(9);
  });

  it('a failed print does not jam the queue', async () => {
    P.useRenderer(async () => { throw new Error('the printer fell over'); });
    await expect(P.renderPrintable(spec, meta)).rejects.toThrow(/fell over/);
    P.useRenderer(async () => ({ pdf: Buffer.from('%PDF-1.4'), sections: 9, overflow: [] }));
    expect((await P.renderPrintable(spec, meta)).sections).toBe(9);
  });
});

describe('the browser is launched small', () => {
  it('the launch line carries the low-memory flags', () => {
    for (const f of ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu', '--renderer-process-limit=1', '--disable-extensions']) {
      expect(P.CHROMIUM_LAUNCH_ARGS).toContain(f);
    }
  });
});

const HEADLESS = [
  process.env.FOUNDRY_CHROMIUM_PATH,
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell',
  '/usr/lib/chromium/chromium-headless-shell',
  // And the full browsers, so the release runner (which has '/usr/bin/google-chrome') runs these too.
  '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', '/usr/bin/chromium', '/usr/bin/google-chrome',
].find((p): p is string => !!p && existsSync(p));
const withBrowser = HEADLESS ? describe : describe.skip;

/** Chromium processes this test process started, by executable path. */
function chromiumChildren(path: string): number[] {
  const rows = execFileSync('ps', ['-eo', 'pid=,ppid=,args='], { encoding: 'utf8' }).split('\n').filter(Boolean)
    .map((l) => { const m = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(l)!; return { pid: Number(m[1]), ppid: Number(m[2]), args: m[3]! }; });
  // Descendants of THIS test process only, so a sibling test file's browser is not counted.
  const mine = new Set([process.pid]);
  for (let grew = true; grew;) {
    grew = false;
    for (const r of rows) if (mine.has(r.ppid) && !mine.has(r.pid)) { mine.add(r.pid); grew = true; }
  }
  return rows.filter((r) => mine.has(r.pid) && r.args.includes(path)).map((r) => r.pid);
}

withBrowser('the real browser', () => {
  it('is gone after a print', async () => {
    const r = await P.renderPrintable(spec, meta, P.chromiumRenderer(HEADLESS!));
    expect(r.sections).toBe(9);
    expect(chromiumChildren(HEADLESS!)).toEqual([]);
  }, 120_000);

  it('is killed, not abandoned, when a page never finishes loading', async () => {
    P.setPrintTimeoutMs(3_000);
    // A page whose script never yields: Chromium would print it never.
    const forever = '<!doctype html><html><body><section class="page">x</section><script>for(;;){}</script></body></html>';
    const started = Date.now();
    await expect(P.printOne(forever, P.chromiumRenderer(HEADLESS!))).rejects.toThrow(/did not finish printing within/);
    expect(Date.now() - started).toBeLessThan(20_000);
    // Give the kernel a moment to reap what was killed.
    for (let i = 0; i < 20 && chromiumChildren(HEADLESS!).length > 0; i++) await new Promise((r) => setTimeout(r, 100));
    expect(chromiumChildren(HEADLESS!)).toEqual([]);
  }, 60_000);
});
