// =============================================================================
// FOUNDRY — whether the institution's routines are actually running.
//
// Ninety-six routines carry everything Foundry does on its own, and nothing
// anywhere reported whether a single one of them was scheduled. The process
// could answer every request perfectly with its whole inner life stopped, and
// every probe would have said ok.
//
// It lives here rather than in the composition root because the health check is
// kernel and the composition root is not: a probe that had to import the whole
// application to ask this question would be the layer boundary telling us the
// question was in the wrong place.
// =============================================================================

let running = 0;
let startedAt: string | null = null;

/** Called by the scheduler as each routine is successfully scheduled. */
export function noteScheduled(at = new Date()): void {
  running += 1;
  startedAt ??= at.toISOString();
}

/** Called when the drain stops them, so the standing is honest afterwards too. */
export function noteAllStopped(): void {
  running = 0;
}

export function schedulerStanding(): { running: number; startedAt: string | null } {
  return { running, startedAt };
}
