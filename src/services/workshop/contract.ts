// =============================================================================
// FOUNDRY - a workshop is a computer the institution can hand work to
//
// The contract every substrate implements. It is deliberately small: a
// workshop is created for a purpose under a ceiling, work is run in it, its
// state can be checkpointed and restored, it sleeps when idle and is destroyed
// when done, and it accounts for what it cost. Nothing in the contract reaches
// the world: a step that needs to - send, spend, publish - goes back through
// the outbound door, where the rung is checked, because CONSEQUENCE DETERMINES
// GOVERNANCE and a shell is only an interface.
//
// THE WORKSHOP NEVER HOLDS THE SECRET. `run` takes a capability grant, not a
// credential; a substrate that needs to reach a provider on the workshop's
// behalf does so through the institution's own mediated call.
// =============================================================================

export type Substrate = 'reference_world' | 'local_process' | 'fly_machines' | 'fly_sprites';

export interface WorkshopSpec {
  purpose: string;
  /** The most consequential rung anything in here may be granted. */
  ceiling: 'observe' | 'prepare' | 'reversible' | 'public' | 'financial';
  network: 'none' | 'allowlist' | 'open';
  budgetCents: number;
  /** Tools the substrate should have installed, by name. */
  tooling: string[];
}

export interface RunResult {
  ok: boolean;
  output: string;
  costCents: number;
}

export interface WorkshopSubstrate {
  readonly name: Substrate;
  /** Bring a workshop into being; returns the substrate's own handle. */
  create(spec: WorkshopSpec): Promise<{ externalRef: string; costCents: number }>;
  /** Run one step. The step may only use capabilities that were granted. */
  run(externalRef: string, step: string, granted: string[]): Promise<RunResult>;
  checkpoint(externalRef: string, label: string): Promise<{ checkpointRef: string; costCents: number }>;
  restore(externalRef: string, checkpointRef: string): Promise<{ costCents: number }>;
  sleep(externalRef: string): Promise<{ costCents: number }>;
  wake(externalRef: string): Promise<{ costCents: number }>;
  destroy(externalRef: string): Promise<{ costCents: number }>;
}

export class WorkshopError extends Error {
  constructor(readonly substrate: Substrate, readonly what: string, message: string) {
    super(message);
  }
}
