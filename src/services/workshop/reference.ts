// =============================================================================
// FOUNDRY - the reference workshop
//
// An in-process substrate that behaves like a computer: it has a filesystem
// (a map), remembers checkpoints, sleeps and wakes, refuses a step that uses a
// capability it was not granted, and charges a cent a step so the accounting
// path is exercised. It exists so the whole workshop lifecycle is
// controlled-proven before a real computer is ever paid for - and so the one
// rule that matters, that a workshop cannot reach past its grants, is proven
// against something that actually tries.
// =============================================================================

import type { RunResult, WorkshopSpec, WorkshopSubstrate } from './contract.js';
import { WorkshopError } from './contract.js';

interface Box {
  spec: WorkshopSpec;
  files: Map<string, string>;
  checkpoints: Map<string, Map<string, string>>;
  asleep: boolean;
  destroyed: boolean;
}

const boxes = new Map<string, Box>();
let seq = 0;

/**
 * A STEP DECLARES WHAT IT USES. "use:send_email" at the front of a step is the
 * capability it is about to need; the workshop refuses it unless granted. A
 * real substrate cannot read intent from a shell command, which is exactly why
 * the real door is the outbound gateway and not this parse - but the reference
 * one can, and that is enough to prove the grant machinery from the inside.
 */
function uses(step: string): string | null {
  const m = /^use:([a-z_]+)\s/.exec(step);
  return m?.[1] ?? null;
}

export const referenceWorkshop: WorkshopSubstrate = {
  name: 'reference_world',
  async create(spec) {
    seq += 1;
    const ref = `ref-ws-${String(seq)}`;
    boxes.set(ref, { spec, files: new Map(), checkpoints: new Map(), asleep: false, destroyed: false });
    return { externalRef: ref, costCents: 0 };
  },
  async run(ref, step, granted): Promise<RunResult> {
    const box = live(ref);
    if (box.asleep) throw new WorkshopError('reference_world', 'run', 'the workshop is asleep');
    const needs = uses(step);
    if (needs && !granted.includes(needs)) {
      return { ok: false, output: `refused: ${needs} was not granted to this workshop`, costCents: 1 };
    }
    // The only thing a reference step can do is write a file, which is what a
    // build step is from the outside: something that leaves an artefact.
    const write = /^(?:use:[a-z_]+\s)?write\s+(\S+)\s+(.*)$/.exec(step);
    if (write?.[1] !== undefined) {
      box.files.set(write[1], write[2] ?? '');
      return { ok: true, output: `wrote ${write[1]}`, costCents: 1 };
    }
    return { ok: true, output: `ran: ${step}`, costCents: 1 };
  },
  async checkpoint(ref, label) {
    const box = live(ref);
    box.checkpoints.set(label, new Map(box.files));
    return { checkpointRef: label, costCents: 0 };
  },
  async restore(ref, checkpointRef) {
    const box = live(ref);
    const saved = box.checkpoints.get(checkpointRef);
    if (!saved) throw new WorkshopError('reference_world', 'restore', `no checkpoint ${checkpointRef}`);
    box.files = new Map(saved);
    return { costCents: 0 };
  },
  async sleep(ref) { live(ref).asleep = true; return { costCents: 0 }; },
  async wake(ref) { live(ref).asleep = false; return { costCents: 0 }; },
  async destroy(ref) { live(ref).destroyed = true; return { costCents: 0 }; },
};

function live(ref: string): Box {
  const box = boxes.get(ref);
  if (!box || box.destroyed) throw new WorkshopError('reference_world', 'lookup', `no workshop ${ref}`);
  return box;
}

/** For the tests: what a workshop holds right now. */
export function referenceFiles(ref: string): Map<string, string> {
  return new Map(live(ref).files);
}
