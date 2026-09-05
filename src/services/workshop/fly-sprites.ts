// =============================================================================
// FOUNDRY - Fly Sprites as a workshop substrate
//
// The first substrate that could actually carry a real change to Foundry's own
// software. `local_process` runs on the machine the institution lives on and is
// refused for that; `fly_machines` is isolated and its `run` throws by design,
// because the exec semantics were never settled. Sprites publish an exec
// endpoint, which is the whole difference.
//
// WHAT IS VERIFIED (read from Fly's own pages 2026-09-05, recorded with sources
// in `substrate_evaluations`):
//   POST https://api.sprites.dev/v1/sprites            create, JSON body
//   POST https://api.sprites.dev/v1/sprites/{name}/exec?cmd=…&cmd=…
//        run a command; `cmd` repeats, one per argument
//   header authorization: Bearer <token>
//   the filesystem is durable between runs - a cloned repository is still
//   cloned and installed dependencies are still installed on return
//   an idle sprite freezes and then suspends on its own
//   a domain allowlist is enforced at packet level, and code running inside can
//   read the policy it is under but never change it
//
// WHAT IS NOT VERIFIED, and therefore not attempted. Checkpoint, restore and
// network-policy are described as primitives and their endpoints were not
// enumerated on the pages read. Guessing a URL for an operation whose job is to
// contain damage would be the exact failure this substrate exists to prevent,
// so those refuse with what is missing rather than inventing a path. When the
// contract is read, they become small.
//
// AND THE VENDOR GAP STAYS A GAP. Nothing on those pages describes how a
// credential is kept out of the sandbox. This adapter does not need it to: the
// workshop contract already answers it — `run` takes a capability grant, never
// a credential — and nothing here ever puts a reusable secret inside a sprite.
// Isolation reduces blast radius; it does not make leaking a credential
// acceptable.
// =============================================================================

import type { RunResult, WorkshopSpec, WorkshopSubstrate } from './contract.js';
import { WorkshopError } from './contract.js';
import { safeFetch } from '../outbound/ssrf.js';

const BASE = 'https://api.sprites.dev/v1';
const TIMEOUT_MS = 30_000;

function token(): string {
  const t = process.env.SPRITE_TOKEN;
  if (!t) {
    throw new WorkshopError('fly_sprites', 'credential',
      'no SPRITE_TOKEN is configured, so no sprite can be created. This substrate '
      + 'is declared, not available.');
  }
  return t;
}

async function call(
  path: string, init: { method: string; body?: string },
): Promise<{ status: number; text: string }> {
  const res = await safeFetch(`${BASE}${path}`, {
    method: init.method,
    headers: {
      authorization: `Bearer ${token()}`,
      'content-type': 'application/json',
      'user-agent': 'foundry-workshop',
    },
    body: init.body,
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  return { status: res.status, text: await res.text() };
}

/**
 * A NAME THE SPRITE API WILL ACCEPT AND A HUMAN CAN RECOGNISE.
 *
 * The purpose is in it deliberately: a stray workspace should be identifiable
 * as belonging to a piece of institutional work rather than being an opaque id
 * somebody has to look up before daring to delete it.
 */
function spriteName(purpose: string): string {
  const slug = purpose.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 24);
  const stamp = Math.floor(Date.now() / 1000).toString(36);
  return `foundry-${slug}-${stamp}`.replace(/-+/g, '-');
}

export const flySpritesWorkshop: WorkshopSubstrate = {
  name: 'fly_sprites',

  async create(spec: WorkshopSpec): Promise<{ externalRef: string; costCents: number }> {
    // REFUSED BEFORE ANYTHING EXISTS, not after.
    //
    // The allowlist is real and the endpoint that sets one was not on the pages
    // read. A workspace whose policy could not be applied must not quietly run
    // as though it had one — and refusing AFTER the create call would leave a
    // sprite nobody tears down, which is how an isolation failure becomes a
    // billing one as well.
    if (spec.network === 'allowlist') {
      throw new WorkshopError('fly_sprites', 'create',
        'a domain allowlist was asked for and the endpoint that sets one has not '
        + 'been read yet, so this sprite would run with a policy nobody applied');
    }
    const name = spriteName(spec.purpose);
    const res = await call('/sprites', {
      method: 'POST',
      body: JSON.stringify({ name }),
    });
    if (res.status >= 300) {
      throw new WorkshopError('fly_sprites', 'create',
        `sprite create -> HTTP ${String(res.status)}: ${res.text.slice(0, 200)}`);
    }
    return { externalRef: name, costCents: 0 };
  },

  async run(externalRef: string, step: string, granted: string[]): Promise<RunResult> {
    // THE GRANT IS CHECKED HERE, NOT INSIDE. A step that names a capability it
    // was not granted is refused before it reaches the computer at all — the
    // same rule `local_process` applies, because the check belongs to the
    // institution rather than to whichever substrate happens to be carrying it.
    const declared = /^use:([a-z_]+)\s+/.exec(step);
    if (declared?.[1] !== undefined && !granted.includes(declared[1])) {
      return { ok: false, costCents: 0,
        output: `refused: ${declared[1]} was not granted to this workshop` };
    }
    const body = declared ? step.slice(declared[0].length) : step;

    // `cmd` repeats, one per argument, which is how the API takes an argv
    // rather than a shell string — so nothing here builds a command line that
    // a filename with a space could break apart.
    const argv = body.match(/"[^"]*"|\S+/g) ?? [];
    if (argv.length === 0) {
      return { ok: false, costCents: 0, output: 'refused: nothing to run' };
    }
    const qs = argv
      .map((a) => `cmd=${encodeURIComponent(a.replace(/^"|"$/g, ''))}`)
      .join('&');

    const res = await call(
      `/sprites/${encodeURIComponent(externalRef)}/exec?${qs}`, { method: 'POST' });
    return {
      ok: res.status < 300,
      output: res.text.slice(0, 20_000),
      costCents: 0,
    };
  },

  async checkpoint(): Promise<{ checkpointRef: string; costCents: number }> {
    throw new WorkshopError('fly_sprites', 'checkpoint',
      'whole-filesystem checkpoints are documented and the endpoint that takes '
      + 'one has not been read; guessing a path for an operation whose job is to '
      + 'contain damage is not worth the convenience');
  },

  async restore(): Promise<{ costCents: number }> {
    throw new WorkshopError('fly_sprites', 'restore',
      'restore is documented and its endpoint has not been read');
  },

  async sleep(): Promise<{ costCents: number }> {
    // An idle sprite freezes and then suspends on its own, so there is nothing
    // to ask for. Reported as done rather than refused, because the state the
    // caller wanted is the state it will be in.
    return { costCents: 0 };
  },

  async wake(): Promise<{ costCents: number }> {
    // Waking happens by using it. The next `run` is the wake.
    return { costCents: 0 };
  },

  async destroy(externalRef: string): Promise<{ costCents: number }> {
    const res = await call(`/sprites/${encodeURIComponent(externalRef)}`,
      { method: 'DELETE' });
    if (res.status >= 300 && res.status !== 404) {
      throw new WorkshopError('fly_sprites', 'destroy',
        `sprite delete -> HTTP ${String(res.status)}: ${res.text.slice(0, 200)}`);
    }
    return { costCents: 0 };
  },
};
