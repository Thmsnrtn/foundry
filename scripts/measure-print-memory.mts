// =============================================================================
// DOES PRINTING FIT THE 1 GB MACHINE? A measurement, not a test.
//
// Production (fly.private.toml) is one shared-cpu-1x machine with 1024 MB, one
// process serving HTTP and running the scheduler (PROCESS_ROLE=all), and no
// swap. This puts the same shape under a 1 GB memory cgroup on this machine:
//
//   1. the built server (`node dist/index.js`, NODE_ENV=production,
//      PROCESS_ROLE=all, a file database, migrations applied at boot), left
//      resident for the whole run with its scheduler on;
//   2. a printing process that renders through the real path
//      (`renderPrintable` → `printOne` → `chromiumRenderer`) the bench product
//      (the 9-page home maintenance log) and the largest file the kind allows
//      (40 pages), several times each, then four asked for at once;
//
// sampling every process's RSS and the cgroup's own usage every 50 ms. The
// cgroup peak is the number that decides: it is what the kernel's OOM killer
// would compare with 1 GB.
//
// NO PAID CALL CAN HAPPEN: the model key is a placeholder and the model door's
// base URL points at a closed local port.
//
// Run (needs root for the cgroup; the server must be built first):
//   npm run build
//   npx tsx scripts/measure-print-memory.mts [--chromium PATH] [--out FILE]
// =============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const arg = (name: string): string | undefined => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };
const LIMIT = 1024 * 1024 * 1024;

// ─── The print child ─────────────────────────────────────────────────────────
if (process.argv.includes('--print-child')) {
  process.env.ENCRYPTION_KEY ??= '7'.repeat(64);
  const { PRINTABLE_CONTENT_HONEST } = await import('../tests/fixtures/printable-home-maintenance.js');
  const P = await import('../src/services/venture/products/printable.js');
  const chromium = arg('--chromium')!;
  const bench = { kind: 'printable_pdf' as const, title: 'The Home Maintenance Log', ...PRINTABLE_CONTENT_HONEST };
  // THE LARGEST THE KIND ALLOWS: cover + contents + 37 pages + colophon = 40.
  const pages = Array.from({ length: 37 }, (_, i) => ({ ...PRINTABLE_CONTENT_HONEST.pages[i % PRINTABLE_CONTENT_HONEST.pages.length]!, heading: `Section ${String(i + 1)}` }));
  const largest = { ...bench, pages };
  const meta = { workshop: 'Apex Micro', version: 1, madeOn: '2026-10-09' };
  const r = P.chromiumRenderer(chromium);
  const say = (s: string): void => { process.stdout.write(`${JSON.stringify({ t: Date.now(), ...JSON.parse(s) })}\n`); };
  for (let i = 0; i < 3; i++) { const x = await P.renderPrintable(bench, meta, r); say(JSON.stringify({ phase: 'bench', pages: x.sections, bytes: x.pdf.length })); }
  for (let i = 0; i < 3; i++) { const x = await P.renderPrintable(largest, meta, r); say(JSON.stringify({ phase: 'largest', pages: x.sections, bytes: x.pdf.length })); }
  // FOUR ASKED FOR AT ONCE: the queue must hold this to one browser.
  const all = await Promise.all([bench, largest, bench, largest].map((s) => P.renderPrintable(s, meta, r)));
  say(JSON.stringify({ phase: 'four-at-once', pages: all.map((x) => x.sections) }));
  process.exit(0);
}

// ─── The orchestrator ────────────────────────────────────────────────────────
const chromium = arg('--chromium') ?? [process.env.FOUNDRY_CHROMIUM_PATH, '/usr/lib/chromium/chromium-headless-shell',
  '/opt/pw-browsers/chromium_headless_shell-1194/chrome-linux/headless_shell'].find((p): p is string => !!p && existsSync(p));
if (!chromium) throw new Error('no headless Chromium found; pass --chromium PATH');
if (!existsSync(join(ROOT, 'dist/index.js'))) throw new Error('build the server first: npm run build');

/** A 1 GB cgroup, v1 or v2, under this process's own. */
function makeCgroup(): { dir: string; kind: 'v1' | 'v2'; usage: () => number; peak: () => number; events: () => string; remove: () => void } {
  const self = readFileSync('/proc/self/cgroup', 'utf8').split('\n');
  const v1 = self.find((l) => /^\d+:memory:/.test(l));
  if (v1 && existsSync('/sys/fs/cgroup/memory')) {
    const dir = join('/sys/fs/cgroup/memory', v1.split(':')[2]!, `print-measure-${String(process.pid)}`);
    mkdirSync(dir);
    writeFileSync(join(dir, 'memory.limit_in_bytes'), String(LIMIT));
    // No swap on the Fly machine, so none here: memory+swap capped at the same 1 GB.
    try { writeFileSync(join(dir, 'memory.memsw.limit_in_bytes'), String(LIMIT)); } catch { /* no swap accounting */ }
    const rd = (f: string): string => readFileSync(join(dir, f), 'utf8').trim();
    return { dir, kind: 'v1', usage: () => Number(rd('memory.usage_in_bytes')), peak: () => Number(rd('memory.max_usage_in_bytes')),
      events: () => `failcnt=${rd('memory.failcnt')} ${rd('memory.oom_control').replace(/\n/g, ' ')}`, remove: () => rmdirSync(dir) };
  }
  const v2 = self.find((l) => l.startsWith('0::'));
  const dir = join('/sys/fs/cgroup', v2!.slice(3), `print-measure-${String(process.pid)}`);
  mkdirSync(dir);
  writeFileSync(join(dir, 'memory.max'), String(LIMIT));
  try { writeFileSync(join(dir, 'memory.swap.max'), '0'); } catch { /* none */ }
  const rd = (f: string): string => readFileSync(join(dir, f), 'utf8').trim();
  return { dir, kind: 'v2', usage: () => Number(rd('memory.current')), peak: () => Number(existsSync(join(dir, 'memory.peak')) ? rd('memory.peak') : rd('memory.current')),
    events: () => rd('memory.events').replace(/\n/g, ' '), remove: () => rmdirSync(dir) };
}

const cg = makeCgroup();
/** Start a command inside the cgroup: a shell joins it, then execs the command. */
function inCgroup(cmd: string, args: string[], env: NodeJS.ProcessEnv): ChildProcess {
  const procs = join(cg.dir, 'cgroup.procs');
  const quoted = [cmd, ...args].map((a) => `'${a.replace(/'/g, `'\\''`)}'`).join(' ');
  return spawn('sh', ['-c', `echo $$ > ${procs} && exec ${quoted}`], { env, stdio: ['ignore', 'pipe', 'pipe'] });
}

function rssOf(pid: number): number {
  try { const m = /VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${String(pid)}/status`, 'utf8')); return m ? Number(m[1]) * 1024 : 0; } catch { return 0; }
}
function descendants(pid: number): number[] {
  const kids = new Map<number, number[]>();
  for (const d of readdirSync('/proc').filter((x) => /^\d+$/.test(x))) {
    try {
      const stat = readFileSync(`/proc/${d}/stat`, 'utf8');
      const ppid = Number(stat.slice(stat.lastIndexOf(')') + 2).split(' ')[1]);
      kids.set(ppid, [...(kids.get(ppid) ?? []), Number(d)]);
    } catch { /* gone */ }
  }
  const out: number[] = []; const stack = [pid];
  while (stack.length) { const p = stack.pop()!; for (const k of kids.get(p) ?? []) { out.push(k); stack.push(k); } }
  return out;
}

const scratch = mkdtempSync(join(tmpdir(), 'print-measure-'));
const env: NodeJS.ProcessEnv = {
  PATH: process.env.PATH, HOME: process.env.HOME, NODE_ENV: 'production', PORT: '18089', PROCESS_ROLE: 'all',
  FOUNDRY_INSTANCE_POSTURE: 'private_owner', FOUNDRY_OWNER_EMAIL: 'owner@example.invalid',
  TURSO_DATABASE_URL: `file:${join(scratch, 'foundry.db')}`, ENCRYPTION_KEY: '7'.repeat(64),
  CLERK_SECRET_KEY: 'sk_test_placeholder', CLERK_PUBLISHABLE_KEY: 'pk_test_placeholder',
  // A placeholder key and a closed port: nothing here can reach a paid model.
  OPENROUTER_API_KEY: 'placeholder-never-sent', OPENROUTER_BASE_URL: 'http://127.0.0.1:9',
  FOUNDRY_CHROMIUM_PATH: chromium,
};

const samples: Array<{ t: number; cgroup: number; server: number; printer: number; chromium: number }> = [];
const marks: Array<{ t: number; what: string }> = [];
let server: ChildProcess | null = null; let printer: ChildProcess | null = null;
const tick = setInterval(() => {
  const s = server?.pid ? [server.pid, ...descendants(server.pid)] : [];
  const pr = printer?.pid ? [printer.pid, ...descendants(printer.pid)] : [];
  const chromeP = pr.filter((p) => { try { return readFileSync(`/proc/${String(p)}/cmdline`, 'utf8').includes(chromium); } catch { return false; } });
  const sum = (ps: number[]): number => ps.reduce((a, p) => a + rssOf(p), 0);
  samples.push({ t: Date.now(), cgroup: cg.usage(), server: sum(s), printer: sum(pr.filter((p) => !chromeP.includes(p))), chromium: sum(chromeP) });
}, 50);

const wait = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const MB = (b: number): number => Math.round(b / 1048576);
try {
  server = inCgroup(process.execPath, [join(ROOT, 'dist/index.js')], env);
  let serverOut = '';
  server.stdout!.on('data', (d) => { serverOut += String(d); });
  server.stderr!.on('data', (d) => { serverOut += String(d); });
  // Up when /internal/health answers (migrations run before the port binds).
  const up = Date.now();
  for (;;) {
    if (server.exitCode !== null) throw new Error(`the server exited ${String(server.exitCode)}:\n${serverOut.slice(-3000)}`);
    try { if ((await fetch('http://127.0.0.1:18089/internal/health')).status < 600) break; } catch { /* not yet */ }
    if (Date.now() - up > 180_000) throw new Error(`the server did not come up:\n${serverOut.slice(-3000)}`);
    await wait(250);
  }
  marks.push({ t: Date.now(), what: 'server up' });
  await wait(20_000); // let the scheduler's first ticks run
  marks.push({ t: Date.now(), what: 'server settled' });
  const settled = samples.filter((s) => s.t >= marks[0]!.t);
  const serverIdle = Math.max(...settled.map((s) => s.server));

  printer = inCgroup(process.execPath, ['--import', 'tsx', join(ROOT, 'scripts/measure-print-memory.mts'), '--print-child', '--chromium', chromium],
    { ...env, NODE_ENV: 'test', TURSO_DATABASE_URL: 'file::memory:' });
  let out = ''; let err = '';
  printer.stdout!.on('data', (d) => { out += String(d); });
  printer.stderr!.on('data', (d) => { err += String(d); });
  const code: number = await new Promise((r) => printer!.on('exit', (c) => r(c ?? -1)));
  marks.push({ t: Date.now(), what: `printer exited ${String(code)}` });
  await wait(1000);
  const phases = out.split('\n').filter(Boolean).map((l) => JSON.parse(l) as { t: number; phase: string });

  const during = samples.filter((s) => s.t >= marks[1]!.t);
  const result = {
    measuredAt: new Date().toISOString(),
    cgroup: { kind: cg.kind, limitMB: MB(LIMIT), swap: 'none (memory+swap capped at the same limit)' },
    chromium,
    printerExit: code, printerErr: code === 0 ? undefined : err.slice(-2000),
    phases,
    serverIdlePeakMB: MB(serverIdle),
    serverPeakMB: MB(Math.max(...samples.map((s) => s.server))),
    printerNodePeakMB: MB(Math.max(...during.map((s) => s.printer))),
    chromiumPeakMB: MB(Math.max(...during.map((s) => s.chromium))),
    /** The highest simultaneous total of every process's RSS. */
    allProcessesPeakMB: MB(Math.max(...samples.map((s) => s.server + s.printer + s.chromium))),
    /** The cgroup's own high-water mark (RSS + page cache charged to it). What the OOM killer reads. */
    cgroupPeakMB: MB(cg.peak()),
    cgroupEvents: cg.events(),
    serverStillUp: server.exitCode === null,
    samples: samples.length,
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  const outFile = arg('--out');
  if (outFile) writeFileSync(outFile, JSON.stringify({ ...result, series: samples.filter((_, i) => i % 10 === 0) }, null, 1));
} finally {
  clearInterval(tick);
  for (const c of [printer, server]) if (c?.pid && c.exitCode === null) { for (const p of descendants(c.pid)) { try { process.kill(p, 'SIGKILL'); } catch { /* gone */ } } c.kill('SIGKILL'); }
  await wait(500);
  try { cg.remove(); } catch { /* still draining */ }
}
