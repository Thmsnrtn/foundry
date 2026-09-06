// =============================================================================
// FOUNDRY - Fly Sprites as a workshop substrate
//
// The first substrate that could actually carry a real change to Foundry's own
// software. `local_process` runs on the machine the institution lives on and is
// refused for that; `fly_machines` is isolated and its `run` throws by design,
// because the exec semantics were never settled. Sprites publish an exec
// endpoint, which is the whole difference.
//
// WHAT THE VENDOR PUBLISHES (their own quickstart, read 2026-09-05, recorded
// with sources in `substrate_evaluations`):
//   PUT  https://api.sprites.dev/v1/sprites/{name}          create, by name
//   POST https://api.sprites.dev/v1/sprites/{name}/exec     {"command": "…"}
//   header authorization: Bearer <SPRITES_TOKEN>
//   the filesystem is durable between runs - a cloned repository is still
//   cloned and installed dependencies are still installed on return
//   an idle sprite freezes and then suspends on its own
//   a domain allowlist is enforced at packet level, and code running inside can
//   read the policy it is under but never change it
//
// PUBLISHED IS NOT THE SAME AS EXERCISED, and this adapter learned the
// difference the embarrassing way. It first posted to the collection with the
// name in a body, and sent exec an argv as repeated `cmd` parameters. Both are
// the shapes most APIs use. Neither is this one's. Nothing caught it because a
// request with no credential never gets far enough to be told its body is
// wrong: the 401 arrives first, and a real 401 from a real host proves the
// service is there and the auth header is right and NOTHING WHATEVER about
// what is being sent.
//
// So this is written to what the vendor publishes, and the request shapes below
// remain unexercised until something has actually run. That is the difference
// between an adapter that is careful and an adapter that is proven, and only
// the second is worth calling reality-proven.
//
// WHAT IS NOT PUBLISHED ANYWHERE READ, and therefore not attempted. Checkpoint, restore and
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
  // THE VENDOR'S OWN NAME FOR IT. Their quickstart says SPRITES_TOKEN, and a
  // near-miss on a secret's name is the kind of thing that costs somebody an
  // afternoon for no reason. The older singular is still read so nothing
  // already set anywhere stops working.
  const t = process.env.SPRITES_TOKEN ?? process.env.SPRITE_TOKEN;
  if (!t) {
    throw new WorkshopError('fly_sprites', 'credential',
      'no SPRITES_TOKEN is configured, so no sprite can be created. This substrate '
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

/**
 * IS THERE ACTUALLY AN ACCOUNT BEHIND THIS YET?
 *
 * A read, and the cheapest one there is: listing costs nothing and creates
 * nothing. It exists so the institution can tell the owner the truth about
 * where his decision has got to without asking him to confirm anything — he
 * should not have to tell an app whether the thing he just did worked.
 *
 * The three answers are genuinely different and the owner-facing words differ
 * with them: no credential set yet, a credential that the provider rejects, and
 * a credential that works. Collapsing them into "not connected" is how somebody
 * spends an evening re-doing a step that was already right.
 */
export async function spritesReachable(): Promise<
{ ok: boolean; what: 'no_credential' | 'rejected' | 'reachable' | 'unreachable';
  detail: string }> {
  if ((process.env.SPRITES_TOKEN ?? process.env.SPRITE_TOKEN) === undefined) {
    return { ok: false, what: 'no_credential',
      detail: 'nothing has been set for this yet' };
  }
  try {
    const res = await call('/sprites', { method: 'GET' });
    if (res.status === 401 || res.status === 403) {
      return { ok: false, what: 'rejected',
        detail: `the provider refused it (HTTP ${String(res.status)})` };
    }
    if (res.status >= 400) {
      return { ok: false, what: 'unreachable',
        detail: `the provider answered HTTP ${String(res.status)}` };
    }
    return { ok: true, what: 'reachable',
      detail: `the provider answered HTTP ${String(res.status)} to an authenticated read` };
  } catch (err) {
    return { ok: false, what: 'unreachable',
      detail: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * WHAT THIS COST, ESTIMATED HONESTLY RATHER THAN REPORTED AS NOTHING.
 *
 * Every call here used to return zero. The consequence was not a rounding
 * error: workspaces.spent_cents never moved, so the per-workshop budget could
 * never trip and the owner's monthly ceiling could never be reached. A thousand
 * sprites in his paid account would have passed a ceiling that said twenty. A
 * boundary that cannot trip is not a boundary, and recording paid work as free
 * is the most flattering lie this adapter could tell.
 *
 * The provider bills per second while a sprite is active and this adapter
 * cannot read the invoice, so the figure is wall-clock at the rate the
 * institution recorded from the vendor's own pricing. It is an ESTIMATE and the
 * evaluation says so. The one-cent floor is what lets any bound bind at all:
 * work that takes a moment must still cost something, or a fast runaway is
 * free.
 */
const CENTS_PER_ACTIVE_SECOND = 0.1;
function estimate(startedAtMs: number): number {
  return Math.max(1, Math.round(((Date.now() - startedAtMs) / 1000) * CENTS_PER_ACTIVE_SECOND));
}

export const flySpritesWorkshop: WorkshopSubstrate = {
  name: 'fly_sprites',

  async create(spec: WorkshopSpec): Promise<{ externalRef: string; costCents: number }> {
    // REFUSED BEFORE ANYTHING EXISTS, not after. Refusing AFTER the create call
    // would leave a sprite nobody tears down, which is how an isolation failure
    // becomes a billing one as well.
    //
    // THE CREDENTIAL IS CHECKED FIRST, so the owner's stop stays "no credential"
    // and the card naming something he could change is still what gets raised.
    // Refusing for the network policy first would replace a decision he can make
    // with a sentence about an endpoint nobody has read.
    const started = Date.now();
    token();

    // AND THE RECORD MAY NOT CLAIM MORE ISOLATION THAN THE PROVIDER ENFORCES.
    //
    // 'none' was accepted silently and no policy was applied, so the ledger said
    // the workspace had no network while the sprite had whatever egress the
    // vendor gives it by default — and then ran generated code on it. That is
    // the one direction this adapter must never fail in: a claim of restriction
    // the world does not honour is worse than no claim, because everything
    // downstream trusts it.
    //
    // Neither 'none' nor an allowlist can be applied, because the endpoint that
    // narrows egress has not been read. So the only network this adapter can
    // honestly carry is the one the sprite actually gets.
    if (spec.network !== 'open') {
      throw new WorkshopError('fly_sprites', 'create',
        `network '${spec.network}' was asked for, and a sprite starts with the `
        + 'egress its vendor gives it. The endpoint that narrows that has not '
        + 'been read, so this workspace would be recorded as restricted and run '
        + 'unrestricted. Nothing is created.');
    }
    // CREATE IS PUT-BY-NAME, WHICH IS NOT WHAT THIS ADAPTER FIRST DID.
    //
    // It posted to the collection with the name in a body, which is the shape
    // most APIs use and not the one this one publishes. Nothing caught it,
    // because an adapter with no credential never gets far enough to be told it
    // is wrong — the 401 arrives before the request shape is ever judged. So a
    // real 401 proves the host is there and the auth works, and proves nothing
    // whatever about the body.
    const name = spriteName(spec.purpose);
    const res = await call(`/sprites/${encodeURIComponent(name)}`, { method: 'PUT' });
    if (res.status >= 300) {
      throw new WorkshopError('fly_sprites', 'create',
        `sprite create -> HTTP ${String(res.status)}: ${res.text.slice(0, 200)}`);
    }
    return { externalRef: name, costCents: estimate(started) };
  },

  async run(externalRef: string, step: string, granted: string[]): Promise<RunResult> {
    const started = Date.now();
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

    // EXEC TAKES A JSON BODY, WHICH IS ALSO NOT WHAT THIS ADAPTER FIRST DID.
    //
    // It sent one repeated `cmd` query parameter per argument, on the reasoning
    // that an argv cannot be broken apart by a filename with a space in it.
    // Good reasoning about an API this is not: the published shape is a single
    // `command` string in the body. Written to what the vendor publishes rather
    // than to what would be nicer, because the adapter's job is to be right
    // about somebody else's service.
    const command = body.trim();
    if (command.length === 0) {
      return { ok: false, costCents: 0, output: 'refused: nothing to run' };
    }

    const res = await call(
      `/sprites/${encodeURIComponent(externalRef)}/exec`,
      { method: 'POST', body: JSON.stringify({ command }) });
    return {
      ok: res.status < 300,
      output: res.text.slice(0, 20_000),
      costCents: estimate(started),
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
    const started = Date.now();
    const res = await call(`/sprites/${encodeURIComponent(externalRef)}`,
      { method: 'DELETE' });
    if (res.status >= 300 && res.status !== 404) {
      throw new WorkshopError('fly_sprites', 'destroy',
        `sprite delete -> HTTP ${String(res.status)}: ${res.text.slice(0, 200)}`);
    }
    return { costCents: estimate(started) };
  },
};
