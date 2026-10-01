// =============================================================================
// Tests: Gate-3 decision → outbound webhook wiring (Phase 4.3)
// =============================================================================

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const read = (rel: string) => readFileSync(resolve(__dirname, '../../src', rel), 'utf-8');

describe('outbound webhook dispatch on founder-facing events', () => {
  it('createDecision dispatches decision_needed for Gate 3+ decisions', () => {
    const src = read('services/decisions/queue.ts');
    expect(src).toMatch(/input\.gate\s*>=\s*3/);
    expect(src).toMatch(/dispatchEvent\(/);
    expect(src).toMatch(/event_type:\s*'decision_needed'/);
  });

});
