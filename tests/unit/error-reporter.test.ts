// =============================================================================
// Tests: Error Reporter (vendor hook)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { reportError, setReporter } from '../../src/lib/error-reporter.js';
import { withTrace } from '../../src/lib/trace.js';

describe('error-reporter', () => {
  afterEach(() => {
    setReporter(null); // restore default
  });

  it('uses the registered reporter', () => {
    const calls: Array<{ err: unknown; ctx: unknown }> = [];
    setReporter((err, ctx) => calls.push({ err, ctx }));

    const e = new Error('boom');
    reportError(e, { source: 'test', productId: 'p1' });

    expect(calls.length).toBe(1);
    expect((calls[0].err as Error).message).toBe('boom');
    expect(calls[0].ctx).toMatchObject({ source: 'test', productId: 'p1' });
  });

  it('a thrown reporter does not propagate to the caller', () => {
    setReporter(() => {
      throw new Error('reporter exploded');
    });
    expect(() => reportError(new Error('boom'))).not.toThrow();
  });

  it('default reporter writes structured JSON to stderr', () => {
    const writes: string[] = [];
    const stub = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });

    setReporter(null); // ensure default
    reportError(new Error('default-path'), { source: 'unit-test' });
    stub.mockRestore();

    expect(writes.length).toBe(1);
    const parsed = JSON.parse(writes[0]);
    expect(parsed.type).toBe('error_report');
    expect(parsed.error_message).toBe('default-path');
    expect(parsed.source).toBe('unit-test');
  });

  it('picks up trace context (trace_id, founder, product) when inside withTrace', () => {
    const calls: Array<{ ctx: unknown }> = [];
    setReporter((_err, ctx) => calls.push({ ctx }));

    withTrace(
      { traceId: 'tr_trace_attach', founderId: 'f1', productId: 'p1', agentName: 'oracle' },
      () => {
        reportError(new Error('inside trace'));
      }
    );

    // Custom reporter receives the static ctx (empty here); the default
    // reporter resolves trace context. We reset to default and call again
    // to verify the trace integration path.
    setReporter(null);
    const writes: string[] = [];
    const stub = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      writes.push(typeof chunk === 'string' ? chunk : String(chunk));
      return true;
    });
    withTrace(
      { traceId: 'tr_trace_attach', founderId: 'f1', productId: 'p1', agentName: 'oracle' },
      () => {
        reportError(new Error('with default reporter'));
      }
    );
    stub.mockRestore();

    const payload = JSON.parse(writes[0]);
    expect(payload.trace_id).toBe('tr_trace_attach');
    expect(payload.founder_id).toBe('f1');
    expect(payload.product_id).toBe('p1');
    expect(payload.agent).toBe('oracle');
  });
});
