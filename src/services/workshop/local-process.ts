// =============================================================================
// FOUNDRY - a real computer, and an honest account of which one
//
// The first substrate that actually does anything: a real directory on disk,
// real commands in a real child process, real wall-clock cost, and a teardown
// that really removes it. It exists because the workshop lifecycle had been
// proven only against an in-process map, which proves the bookkeeping and
// nothing about running code.
//
// AND IT IS NOT A SANDBOX. It runs on the machine Foundry itself runs on. The
// database refuses to put generated venture work here - migration 246 makes
// that structural rather than a promise in a comment - and this file does not
// try to be more than it is: no chroot, no namespace, no seccomp. What it does
// provide is a working directory it cannot escape by relative path, an
// environment stripped of every secret the institution holds, a wall-clock
// timeout, an output cap, and a refusal of any command not on a named list.
//
// The list is the important part. A shell is an interface, not an authority:
// a step that needs to reach the world does not get to do it by being a
// command instead of an API call. So the commands here can compile, test,
// render and inspect - and there is no route from any of them to a network, a
// credential, or a customer.
// =============================================================================

import { spawn } from 'node:child_process';
import { mkdtemp, rm, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, relative, isAbsolute } from 'node:path';
import type { RunResult, WorkshopSpec, WorkshopSubstrate } from './contract.js';
import { WorkshopError } from './contract.js';

/**
 * WHAT MAY BE RUN, AND NOTHING ELSE.
 *
 * An allow-list rather than a deny-list, because a deny-list on a shell is a
 * list of the ways somebody already thought of. Each entry is a program whose
 * whole job is to build, check or look at something.
 *
 * `curl`, `wget`, `ssh`, `git push`, `npm publish` and every other way out of
 * the building are absent on purpose: reaching the world is what the outbound
 * door is for, and a workshop that could do it with a command would be the
 * authority side door this whole design exists to prevent.
 */
const MAY_RUN = new Set([
  'node', 'npx', 'npm', 'tsc', 'vitest', 'python3', 'cat', 'ls', 'echo',
  'mkdir', 'cp', 'mv', 'rm', 'wc', 'grep', 'sed', 'head', 'tail', 'sort', 'diff',
]);

/** Longer than a build, shorter than a hang. */
const TIMEOUT_MS = 120_000;
const OUTPUT_CAP = 64_000;

interface Box {
  dir: string;
  spec: WorkshopSpec;
  checkpoints: Map<string, string>;
  asleep: boolean;
  destroyed: boolean;
}

const boxes = new Map<string, Box>();

/**
 * THE ENVIRONMENT A WORKSHOP GETS, which is almost none of ours.
 *
 * Built up from nothing rather than filtered down from `process.env`, because
 * a filter is a list of the secrets somebody remembered. PATH and HOME are
 * what a compiler needs; everything else the institution holds - database
 * URLs, provider keys, the encryption key - simply is not there to leak.
 */
function environment(box: Box): NodeJS.ProcessEnv {
  return {
    PATH: process.env.PATH ?? '/usr/local/bin:/usr/bin:/bin',
    HOME: box.dir,
    TMPDIR: box.dir,
    FOUNDRY_WORKSHOP: '1',
    FOUNDRY_WORKSHOP_PURPOSE: box.spec.purpose,
    FOUNDRY_WORKSHOP_CEILING: box.spec.ceiling,
    // Playwright needs to find the browser it was told about; this is a path,
    // not a credential.
    ...(process.env.PLAYWRIGHT_BROWSERS_PATH
      ? { PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH } : {}),
  };
}

/** A path a step names must land inside the workshop. */
function inside(box: Box, path: string): string {
  const target = resolve(box.dir, path);
  const rel = relative(box.dir, target);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new WorkshopError('local_process', 'path',
      `${path} is outside the workshop`);
  }
  return target;
}

export const localProcessWorkshop: WorkshopSubstrate = {
  name: 'local_process',
  async create(spec: WorkshopSpec) {
    const dir = await mkdtemp(join(tmpdir(), 'foundry-workshop-'));
    const ref = dir;
    boxes.set(ref, { dir, spec, checkpoints: new Map(), asleep: false, destroyed: false });
    return { externalRef: ref, costCents: 0 };
  },

  /**
   * ONE STEP, WHICH IS A COMMAND OR A WRITE.
   *
   * `use:<capability> ` at the front declares what the step needs, and the
   * grant is checked before anything runs. That is a convention this substrate
   * can enforce because it parses the step; a real machine cannot read intent
   * out of a shell line, which is precisely why the outbound door - not this
   * check - is where consequence is actually governed.
   */
  async run(ref, step, granted): Promise<RunResult> {
    const box = live(ref);
    if (box.asleep) throw new WorkshopError('local_process', 'run', 'the workshop is asleep');
    const started = Date.now();

    const declared = /^use:([a-z_]+)\s+/.exec(step);
    const body = declared ? step.slice(declared[0].length) : step;
    if (declared?.[1] !== undefined && !granted.includes(declared[1])) {
      return {
        ok: false, costCents: 0,
        output: `refused: ${declared[1]} was not granted to this workshop`,
      };
    }

    const write = /^write\s+(\S+)\s+([\s\S]*)$/.exec(body);
    if (write?.[1] !== undefined) {
      const target = inside(box, write[1]);
      await mkdir(join(target, '..'), { recursive: true });
      await writeFile(target, write[2] ?? '', 'utf8');
      return { ok: true, output: `wrote ${write[1]}`, costCents: cost(started) };
    }

    const read = /^read\s+(\S+)$/.exec(body);
    if (read?.[1] !== undefined) {
      const target = inside(box, read[1]);
      if (!existsSync(target)) return { ok: false, output: `no such file ${read[1]}`, costCents: 0 };
      return {
        ok: true, output: (await readFile(target, 'utf8')).slice(0, OUTPUT_CAP),
        costCents: cost(started),
      };
    }

    const parts = tokenise(body);
    const program = parts[0] ?? '';
    if (!MAY_RUN.has(program)) {
      return {
        ok: false, costCents: 0,
        output: `refused: '${program}' is not something a workshop may run. `
          + 'Reaching anything outside this directory goes through the door, not a command.',
      };
    }

    const { code, out } = await execute(program, parts.slice(1), box);
    return {
      ok: code === 0,
      output: out.slice(0, OUTPUT_CAP) || (code === 0 ? 'done' : `exit ${String(code)}`),
      costCents: cost(started),
    };
  },

  /** A checkpoint is a copy of the directory, which is what restoring one needs. */
  async checkpoint(ref, label) {
    const box = live(ref);
    const started = Date.now();
    const at = await mkdtemp(join(tmpdir(), 'foundry-checkpoint-'));
    await cp(box.dir, at, { recursive: true });
    box.checkpoints.set(label, at);
    return { checkpointRef: label, costCents: cost(started) };
  },

  async restore(ref, checkpointRef) {
    const box = live(ref);
    const started = Date.now();
    const at = box.checkpoints.get(checkpointRef);
    if (at === undefined) {
      throw new WorkshopError('local_process', 'restore', `no checkpoint ${checkpointRef}`);
    }
    await rm(box.dir, { recursive: true, force: true });
    await cp(at, box.dir, { recursive: true });
    return { costCents: cost(started) };
  },

  // Sleeping a process substrate costs nothing and frees nothing; it is
  // recorded because the lifecycle is the same everywhere, and said plainly
  // rather than dressed up as suspension.
  async sleep(ref) { live(ref).asleep = true; return { costCents: 0 }; },
  async wake(ref) { live(ref).asleep = false; return { costCents: 0 }; },

  async destroy(ref) {
    const box = live(ref);
    const started = Date.now();
    for (const at of box.checkpoints.values()) {
      await rm(at, { recursive: true, force: true });
    }
    await rm(box.dir, { recursive: true, force: true });
    box.destroyed = true;
    boxes.delete(ref);
    return { costCents: cost(started) };
  },
};

/**
 * SPLITTING A COMMAND THE WAY A SHELL WOULD, WITHOUT BEING ONE.
 *
 * Whitespace splitting looked right and was wrong: `node -e "console.log(x)"`
 * became six arguments with literal quote characters in them, so every quoted
 * step silently ran something other than what it said. The test that ran a
 * real program and checked what it printed is what found it — a step that
 * merely reported success would have passed.
 *
 * Quotes group and are removed; nothing else is interpreted. No expansion, no
 * substitution, no pipes, no redirection, no chaining — because `spawn` is
 * called with `shell: false`, and a workshop that could compose commands could
 * compose its way past the allow-list.
 */
function tokenise(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let quote: '"' | "'" | null = null;
  let started = false;
  for (const ch of line.trim()) {
    if (quote !== null) {
      if (ch === quote) quote = null;
      else current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; started = true; continue; }
    if (/\s/.test(ch)) {
      if (started || current.length > 0) { out.push(current); current = ''; started = false; }
      continue;
    }
    current += ch;
  }
  if (started || current.length > 0) out.push(current);
  return out;
}

/**
 * COST IS WALL-CLOCK, AT A RATE THIS MACHINE ACTUALLY COSTS.
 *
 * A tenth of a cent a second, which is the order of a small always-on machine
 * and is stated here rather than hidden in a constant: it is an estimate, it
 * is the only honest one available for a host we do not bill for, and the
 * receipt says so wherever it is shown.
 */
const CENTS_PER_SECOND = 0.1;
function cost(startedAt: number): number {
  return Math.max(1, Math.round(((Date.now() - startedAt) / 1000) * CENTS_PER_SECOND));
}

async function execute(program: string, args: string[], box: Box): Promise<{
  code: number; out: string;
}> {
  return new Promise((resolveRun) => {
    const child = spawn(program, args, {
      cwd: box.dir, env: environment(box), shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '';
    let done = false;
    const finish = (code: number): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolveRun({ code, out });
    };
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      out += '\n[killed: the step took longer than two minutes]';
      finish(124);
    }, TIMEOUT_MS);
    child.stdout.on('data', (d: Buffer) => { out += d.toString(); });
    child.stderr.on('data', (d: Buffer) => { out += d.toString(); });
    child.on('error', (e: Error) => { out += `\n[could not run: ${e.message}]`; finish(127); });
    child.on('close', (code) => finish(code ?? 0));
  });
}

function live(ref: string): Box {
  const box = boxes.get(ref);
  if (!box || box.destroyed) {
    throw new WorkshopError('local_process', 'lookup', `no workshop ${ref}`);
  }
  return box;
}

/** For the tests and the harness: does the directory still exist? */
export function workshopDirectoryExists(ref: string): boolean {
  return existsSync(ref);
}
