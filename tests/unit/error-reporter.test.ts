// =============================================================================
// Tests: Error Reporter (vendor hook)
// =============================================================================

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { tmpdir } from 'node:os';
import { mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { reportError, setReporter, initReporter } from '../../src/lib/error-reporter.js';
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

  describe('initReporter', () => {
    afterEach(() => {
      vi.unstubAllEnvs();
      setReporter(null);
    });

    it('falls back to default when neither SENTRY_DSN nor ERROR_LOG_PATH set', async () => {
      vi.stubEnv('SENTRY_DSN', '');
      vi.stubEnv('ERROR_LOG_PATH', '');
      delete process.env.SENTRY_DSN;
      delete process.env.ERROR_LOG_PATH;
      await initReporter();
      // Default reporter writes to stderr — verify by spying.
      const writes: string[] = [];
      const stub = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        writes.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      });
      reportError(new Error('default-after-init'));
      stub.mockRestore();
      expect(writes.some((w) => w.includes('default-after-init'))).toBe(true);
    });

    it('writes to ERROR_LOG_PATH when set (and SENTRY_DSN absent)', async () => {
      const dir = mkdtempSync(join(tmpdir(), 'foundry-err-'));
      const logPath = join(dir, 'errors.log');
      delete process.env.SENTRY_DSN;
      vi.stubEnv('ERROR_LOG_PATH', logPath);

      await initReporter();
      reportError(new Error('to-file'), { source: 'test' });

      // appendFile is async; wait one tick so it lands.
      await new Promise((r) => setTimeout(r, 50));
      expect(existsSync(logPath)).toBe(true);
      const contents = readFileSync(logPath, 'utf-8');
      expect(contents).toContain('to-file');
      const parsed = JSON.parse(contents.trim().split('\n')[0]);
      expect(parsed.error_message).toBe('to-file');
      expect(parsed.source).toBe('test');
    });

    it('registers the Sentry reporter when SENTRY_DSN is set and @sentry/node is installed', async () => {
      // @sentry/node is now a real dependency (Phase 0.3), so the DSN path
      // resolves to the Sentry reporter rather than falling through.
      vi.stubEnv('SENTRY_DSN', 'https://example@example.ingest.sentry.io/1');
      delete process.env.ERROR_LOG_PATH;

      const writes: string[] = [];
      const stub = vi.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
        writes.push(typeof chunk === 'string' ? chunk : String(chunk));
        return true;
      });
      await initReporter();
      reportError(new Error('sentry-path'), { source: 'test' });
      stub.mockRestore();

      // Module loaded successfully → no fallback warning emitted.
      expect(writes.find((w) => w.includes('reporter_init_warning'))).toBeUndefined();
      // Sentry.captureException handled the error, so the default stderr
      // error_report payload was NOT written.
      expect(writes.find((w) => w.includes('"error_message":"sentry-path"'))).toBeUndefined();
    });
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
