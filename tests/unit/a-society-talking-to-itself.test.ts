import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { JOB_REGISTRY, RETIRED_LOOPS } from '../../src/jobs/index.js';

// =============================================================================
// A SOCIETY TALKING TO ITSELF, ON A TIMER, AT THE OWNER'S EXPENSE.
//
// Twelve agents across three companies ran for a fortnight under twenty-seven
// scheduled loops. They completed ninety sessions, wrote thirty-six briefings,
// twenty-seven scratchpad notes and eighteen messages to each other, and put
// ELEVEN proposals in front of the owner. None was ever approved; ten had
// already expired unread. The one thing that reached the world in that
// fortnight was done by the hand.
//
// And nothing the owner can open reads any of it.
//
// The schedules are retired and the code is preserved — it is reached at boot
// and by two live routes, and deleting thirty-nine modules to stop a cron would
// be a larger change than the noise it removes. These tests hold that line in
// both directions: nothing reinstated by accident, nothing deleted by stealth.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');

describe('the schedules are retired', () => {
  it('runs no agent-society loop on a timer', () => {
    const scheduled = Object.keys(JOB_REGISTRY).filter((k) => k.startsWith('scp_'));
    // Two remain, and neither is cognition: one expires overdue rows in
    // `decisions`, which the owner's Decisions door reads, and one deletes
    // webhook delivery records over thirty days old.
    expect(scheduled.sort()).toEqual(['scp_expire_overdue_decisions', 'scp_webhook_delivery_cleanup']);
  });

  it('retired twenty-seven of them, each with what it used to do', () => {
    expect(Object.keys(RETIRED_LOOPS)).toHaveLength(27);
    for (const [name, loop] of Object.entries(RETIRED_LOOPS)) {
      expect(name).toMatch(/^scp_/);
      expect(typeof loop.fn).toBe('function');
      // A retirement that does not say what it stopped is a deletion nobody
      // can review later.
      expect(loop.was.length).toBeGreaterThan(10);
    }
  });

  it('never lists the same loop as both retired and scheduled', () => {
    for (const name of Object.keys(RETIRED_LOOPS)) {
      expect(JOB_REGISTRY).not.toHaveProperty(name);
    }
  });

  it('keeps the two hygiene loops out of the retired list', () => {
    expect(RETIRED_LOOPS).not.toHaveProperty('scp_expire_overdue_decisions');
    expect(RETIRED_LOOPS).not.toHaveProperty('scp_webhook_delivery_cleanup');
  });
});

describe('the code is preserved, not deleted', () => {
  it('keeps every retired loop callable', () => {
    // Preserved exactly as the commercial surface is preserved: dormant
    // optionality. Anything here may come back by being put in JOB_REGISTRY
    // deliberately, with a reason, by somebody who has read what a fortnight of
    // it produced.
    for (const loop of Object.values(RETIRED_LOOPS)) {
      expect(loop.fn).toBeInstanceOf(Function);
    }
  });

  it('leaves the modules reachable, so the reachability gate stays honest', () => {
    // The functions stay referenced from the composition root, so the thirty-
    // nine modules under services/scp remain reached. Unscheduling something
    // must not quietly turn a third of the repository into dead code that the
    // next gate run demands be deleted in a hurry.
    const jobs = readFileSync(join(ROOT, 'src/jobs/index.ts'), 'utf8');
    for (const name of Object.keys(RETIRED_LOOPS)) {
      expect(jobs).toContain(`${name}: { fn:`);
    }
  });
});

describe('the reason is written down beside the names', () => {
  it('says what the fortnight actually produced', () => {
    const jobs = readFileSync(join(ROOT, 'src/jobs/index.ts'), 'utf8');
    const note = jobs.slice(jobs.indexOf('THE SOCIETY IS NO LONGER ON A TIMER'),
      jobs.indexOf('export const RETIRED_LOOPS'));
    // The numbers that justify it, so a future reader can check them rather
    // than take the retirement on trust.
    expect(note).toMatch(/ninety sessions/i);
    expect(note.replace(/\n\s*\/\/\s*/g, ' ')).toMatch(/eleven proposals/i);
    expect(note).toMatch(/approved_at. is null/i);
    expect(note).toMatch(/nothing the owner can see depends/i);
  });

  it('says what stays and why', () => {
    const jobs = readFileSync(join(ROOT, 'src/jobs/index.ts'), 'utf8');
    const note = jobs.slice(jobs.indexOf('THE SOCIETY IS NO LONGER ON A TIMER'),
      jobs.indexOf('export const RETIRED_LOOPS'));
    expect(note).toContain('scp_expire_overdue_decisions');
    expect(note).toContain('scp_webhook_delivery_cleanup');
    expect(note).toMatch(/may come back/i);
  });
});
