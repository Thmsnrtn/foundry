// =============================================================================
// FOUNDRY - Fly Machines as a workshop substrate, declared and unproven
//
// Shaped to the documented Machines API and refusing without a token, in the
// same posture as the Stripe sense adapter: the code that would talk to the
// real thing exists, is typed, and cannot be mistaken for having done so.
//
// WHAT IS VERIFIED (from fly.io/docs/machines, read 2026-09-03):
//   POST   /v1/apps/{app}/machines            create, with config.image,
//          config.guest {cpu_kind,cpus,memory_mb}, config.auto_destroy,
//          config.restart.policy, config.env, config.mounts, metadata
//   POST   /v1/apps/{app}/machines/{id}/start | /stop | /suspend
//   DELETE /v1/apps/{app}/machines/{id}
//   GET    /v1/apps/{app}/machines/{id}/wait
//   base https://api.machines.dev, header Authorization: Bearer <token>
//   rootfs is ephemeral; persistence is a mounted volume; a stopped machine
//   restarts on request; suspend preserves memory.
//
// WHAT IS NOT VERIFIED, and therefore not claimed: egress allow-listing is
// not a documented Machines config field, so `network: 'allowlist'` has to be
// enforced inside the image (a proxy the workshop cannot bypass) rather than
// by the platform - which is the credential-mediation pattern anyway; exec
// and checkpoint/restore semantics beyond stop/suspend; per-second billing
// details; Sprites, whose public documentation could not be reached from this
// environment beyond the CLI installer, so they remain 'declared' with no
// adapter until their API is read.
// =============================================================================

import type { RunResult, WorkshopSpec, WorkshopSubstrate } from './contract.js';
import { WorkshopError } from './contract.js';
import { safeFetch } from '../outbound/ssrf.js';

const BASE = 'https://api.machines.dev/v1';

function token(): string {
  const t = process.env.FLY_API_TOKEN;
  if (!t) {
    throw new WorkshopError('fly_machines', 'credential',
      'no FLY_API_TOKEN is configured, so no machine can be created. This substrate is '
      + 'declared, not available.');
  }
  return t;
}

function app(): string {
  const a = process.env.FLY_WORKSHOP_APP;
  if (!a) {
    throw new WorkshopError('fly_machines', 'configuration',
      'no FLY_WORKSHOP_APP names the Fly app workshops are created in');
  }
  return a;
}

/**
 * EVERY CALL OUT OF HERE IS SCREENED, INCLUDING THIS ONE.
 *
 * The URL is assembled from a constant base and a path we wrote, which is the
 * argument for skipping the check and exactly the argument that has failed
 * before elsewhere in this codebase: `BASE` is an environment-shaped constant,
 * a machine id arrives from a provider response, and a redirect is chosen by
 * whatever answers. `safeFetch` screens the target and re-screens every hop,
 * which is the only form that survives a host that re-resolves.
 */
async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await safeFetch(`${BASE}${path}`, {
    method,
    headers: { authorization: `Bearer ${token()}`, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    throw new WorkshopError('fly_machines', method, `${method} ${path} -> HTTP ${String(res.status)}`);
  }
  return (await res.json()) as T;
}

export const flyMachinesWorkshop: WorkshopSubstrate = {
  name: 'fly_machines',
  async create(spec: WorkshopSpec) {
    // The credential first: without one this substrate is declared, not
    // available, and that is the sentence the owner should read.
    token();
    const made = await call<{ id: string }>('POST', `/apps/${app()}/machines`, {
      config: {
        image: process.env.FLY_WORKSHOP_IMAGE ?? 'registry.fly.io/foundry-workshop:latest',
        guest: { cpu_kind: 'shared', cpus: 1, memory_mb: 1024 },
        auto_destroy: true,
        restart: { policy: 'no' },
        // NO SECRETS. The workshop learns its purpose and ceiling and nothing
        // that could reach a provider; every consequential call is mediated.
        env: { FOUNDRY_WORKSHOP_PURPOSE: spec.purpose, FOUNDRY_WORKSHOP_CEILING: spec.ceiling },
      },
      metadata: { foundry_purpose: spec.purpose, foundry_ceiling: spec.ceiling },
    });
    return { externalRef: made.id, costCents: 0 };
  },
  async run(): Promise<RunResult> {
    throw new WorkshopError('fly_machines', 'run',
      'running a step in a real machine is not implemented: the exec path is not yet read '
      + 'from the documentation and will not be guessed');
  },
  async checkpoint(externalRef) {
    // Suspend preserves memory; that is the nearest documented thing to a
    // checkpoint, and it is called that here rather than pretending to be more.
    await call('POST', `/apps/${app()}/machines/${externalRef}/suspend`);
    return { checkpointRef: `suspended:${externalRef}`, costCents: 0 };
  },
  async restore(externalRef) {
    await call('POST', `/apps/${app()}/machines/${externalRef}/start`);
    return { costCents: 0 };
  },
  async sleep(externalRef) {
    await call('POST', `/apps/${app()}/machines/${externalRef}/stop`);
    return { costCents: 0 };
  },
  async wake(externalRef) {
    await call('POST', `/apps/${app()}/machines/${externalRef}/start`);
    return { costCents: 0 };
  },
  async destroy(externalRef) {
    await call('DELETE', `/apps/${app()}/machines/${externalRef}`);
    return { costCents: 0 };
  },
};
