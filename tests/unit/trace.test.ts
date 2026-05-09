// =============================================================================
// Tests: Trace Context (AsyncLocalStorage propagation)
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  withTrace,
  currentTrace,
  currentTraceId,
  newTraceId,
  attachToTrace,
} from '../../src/lib/trace.js';

describe('newTraceId', () => {
  it('produces a tr_-prefixed hex string', () => {
    const id = newTraceId();
    expect(id).toMatch(/^tr_[0-9a-f]{16}$/);
  });

  it('is unique per call', () => {
    const ids = new Set(Array.from({ length: 100 }, () => newTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('withTrace / currentTrace', () => {
  it('returns null outside any trace scope', () => {
    expect(currentTrace()).toBeNull();
  });

  it('exposes the active context inside the scope', () => {
    const captured: unknown[] = [];
    withTrace({ traceId: 'tr_abc' }, () => {
      captured.push(currentTrace());
    });
    expect(captured[0]).toMatchObject({ traceId: 'tr_abc' });
  });

  it('propagates through awaits inside the scope', async () => {
    const inner = async () => {
      await Promise.resolve();
      return currentTraceId();
    };
    const id = await withTrace({ traceId: 'tr_async' }, () => inner());
    expect(id).toBe('tr_async');
  });

  it('does not leak between sibling scopes', async () => {
    const a = await withTrace({ traceId: 'tr_a' }, async () => currentTraceId());
    const b = await withTrace({ traceId: 'tr_b' }, async () => currentTraceId());
    expect(a).toBe('tr_a');
    expect(b).toBe('tr_b');
  });

  it('currentTraceId synthesizes a fresh id outside any scope', () => {
    const a = currentTraceId();
    const b = currentTraceId();
    expect(a).toMatch(/^tr_[0-9a-f]{16}$/);
    expect(b).toMatch(/^tr_[0-9a-f]{16}$/);
    expect(a).not.toBe(b); // both freshly generated
  });
});

describe('attachToTrace', () => {
  it('mutates the active context with founder/product/agent fields', () => {
    let observed: ReturnType<typeof currentTrace> = null;
    withTrace({ traceId: 'tr_attach' }, () => {
      attachToTrace({ founderId: 'f1', productId: 'p1', agentName: 'beacon' });
      observed = currentTrace();
    });
    expect(observed).toMatchObject({
      traceId: 'tr_attach',
      founderId: 'f1',
      productId: 'p1',
      agentName: 'beacon',
    });
  });

  it('is a no-op outside any scope', () => {
    expect(() => attachToTrace({ founderId: 'x' })).not.toThrow();
    expect(currentTrace()).toBeNull();
  });
});
