// =============================================================================
// Tests: Process role / scheduler gating (Phase 3.1)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { getProcessRole, schedulerEnabledForRole } from '../../src/lib/process-role.js';

describe('getProcessRole', () => {
  it('defaults to "all" when PROCESS_ROLE is unset or unknown', () => {
    expect(getProcessRole({})).toBe('all');
    expect(getProcessRole({ PROCESS_ROLE: 'nonsense' })).toBe('all');
  });

  it('reads web / worker (case-insensitive)', () => {
    expect(getProcessRole({ PROCESS_ROLE: 'web' })).toBe('web');
    expect(getProcessRole({ PROCESS_ROLE: 'WORKER' })).toBe('worker');
  });
});

describe('schedulerEnabledForRole', () => {
  it('runs the scheduler on worker and all, never on web', () => {
    expect(schedulerEnabledForRole('worker')).toBe(true);
    expect(schedulerEnabledForRole('all')).toBe(true);
    expect(schedulerEnabledForRole('web')).toBe(false);
  });
});
