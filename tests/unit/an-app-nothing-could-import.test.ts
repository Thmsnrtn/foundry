process.env.TURSO_DATABASE_URL = 'file::memory:';

import { describe, expect, it } from 'vitest';

// =============================================================================
// AN APP NOTHING COULD IMPORT.
//
// `src/index.ts` ran its startup at module scope: importing it migrated the
// database, provisioned SCP instances, started the scheduler and BOUND A PORT.
// So no test ever imported it, and a large part of the route surface was
// untestable rather than merely untested.
//
// That is not an abstract cost. The static-asset route served every PNG through
// a UTF-8 decode for its entire life — the PWA manifest icons were undecodable
// and the app could not be installed — and nothing caught it because nothing
// could reach the route.
//
// The guard keys on the test runner rather than on an entry-point check,
// because the failure DIRECTION matters: `tsx watch` and `node dist/index.js`
// set no such variable, and if the detection ever stopped working the behaviour
// reverts to starting the server rather than to a production process that
// serves nothing.
// =============================================================================

describe('the app can be imported', () => {
  it('does not take the startup branch, and hands back something that answers requests', async () => {
    const { default: app, isProcessStarted } = await import('../../src/index.js');
    // THE ASSERTION THAT ACTUALLY CATCHES IT. Importability and routing are true
    // whether or not a port is bound — the listen sits inside a promise chain
    // after migrations, so a test finishes long before it happens. Removing the
    // guard passed every check in this file until the branch became observable.
    expect(isProcessStarted()).toBe(false);
    expect(typeof (app as { request?: unknown }).request).toBe('function');
  });

  it('answers a real request through the real router', async () => {
    // The payoff: a route exercised through the app as mounted, not through a
    // handler lifted out of it. `/static/:file` is the one that was wrong.
    const { default: app } = await import('../../src/index.js');
    const res = await (app as { request: (p: string) => Promise<Response> }).request('/static/icon-192.png');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/png');
    const bytes = Buffer.from(await res.arrayBuffer());
    expect(bytes.subarray(0, 8).toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('still refuses an unknown asset through the mounted route', async () => {
    const { default: app } = await import('../../src/index.js');
    const res = await (app as { request: (p: string) => Promise<Response> }).request('/static/nope.png');
    expect(res.status).toBe(404);
  });
});
