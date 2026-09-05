process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import {
  isThisDeployed, readHealthReport, standingFrom,
} from '../../src/services/institution/deployed.js';

// =============================================================================
// BRANCH TRUTH IS NOT PRODUCTION TRUTH.
//
// The institution reported a decision as live on the owner's first screen. The
// branch had it, the chain was green, the commit was pushed — and production
// was running the previous evening's build, because deploys fire on a marker
// none of those commits carried. The owner opened the product and found a
// version with no such decision in it.
//
// Nothing in that report was false about the repository. It was a claim about
// one kind of truth stated as a claim about another, and no mechanism existed
// that could tell them apart. These are that mechanism's tests, and every one
// of them is about REFUSING to answer rather than answering well.
// =============================================================================


describe('what a health report actually establishes', () => {
  it('reports the commit it actually named', () => {
    const running = readHealthReport(200, { status: 'ok', commit: 'abc1234def', storage: 'volume' });
    expect(running.commit).toBe('abc1234def');
    expect(running.couldNotTell).toBeNull();
    expect(running.storage).toBe('volume');
  });

  it('treats a build that cannot identify itself as a failure to establish', () => {
    // NOT AS A COMMIT. An image built outside the deploy path answers 'unknown',
    // and 'unknown' is precisely the state in which branch truth and deployed
    // truth become indistinguishable — so it must never read as an answer.
    for (const commit of ['unknown', '', undefined]) {
      const running = readHealthReport(200, { status: 'ok', commit });
      expect(running.commit).toBeNull();
      expect(running.couldNotTell).toContain('cannot say which commit');
    }
  });

  it('does not read a login page as a health report', () => {
    const running = readHealthReport(401, { error: 'unauthorized' });
    expect(running.commit).toBeNull();
    expect(running.couldNotTell).toContain('HTTP 401');
  });

  it('still reads the commit from a degraded deployment', () => {
    // DEGRADED IS RUNNING. Refusing to read the commit because a check failed
    // would lose the one fact that says whether the owner is looking at this
    // code at all.
    const running = readHealthReport(503, { status: 'degraded', commit: 'cafe1234' });
    expect(running.commit).toBe('cafe1234');
    expect(running.status).toBe('degraded');
  });

  it('does not invent a report out of a page that is not one', () => {
    expect(readHealthReport(200, '<html>hello</html>').commit).toBeNull();
    expect(readHealthReport(200, null).couldNotTell).toContain('not a health report');
  });
});

describe('is what I have here what is running there', () => {
  it('says so plainly when it is, and stops there', () => {
    const s = standingFrom('deadbeefcafe',
      { commit: 'deadbeefcafe', couldNotTell: null, status: 'ok', storage: 'volume' });
    expect(s.isRunningThis).toBe(true);
    expect(s.says).toContain('production is running deadbee');
    // Running the commit is not the same as the owner being able to use what
    // is in it, and the sentence must not quietly promise the second thing.
    expect(s.says).toContain('needs his session');
  });

  it('names the gap when production is behind, rather than rounding to yes', () => {
    const s = standingFrom('2222222bbbb',
      { commit: '1111111aaaa', couldNotTell: null, status: 'ok', storage: null });
    expect(s.isRunningThis).toBe(false);
    expect(s.runningCommit).toBe('1111111aaaa');
    expect(s.says).toContain('is not something the owner can see');
  });

  it('refuses rather than assumes when it could not tell', () => {
    // THE FAILURE MODE THAT CAUSED THIS. Not knowing what production is running
    // is the exact moment it is most tempting to fall back on what the
    // repository says.
    const s = standingFrom('2222222bbbb',
      { commit: null, couldNotTell: 'production did not answer', status: null, storage: null });
    expect(s.isRunningThis).toBe(false);
    expect(s.runningCommit).toBeNull();
    expect(s.says).toContain('I cannot tell what production is running');
  });

  it('reaches the real production URL by the guarded door, and tells the truth either way',
    async () => {
      // ONE REAL CALL. It may or may not reach production from wherever this
      // runs; what must hold in both cases is that it never returns a commit it
      // did not read.
      const s = await isThisDeployed('0'.repeat(40));
      expect(s.isRunningThis).toBe(false);
      expect(s.says.length).toBeGreaterThan(20);
    }, 30_000);
});

describe('the institution observes whether it is running what it wrote', () => {
  it('refuses to describe itself as deployed when it cannot name its own build',
    async () => {
      // THE WEAKEST LINK, OBSERVED. A process that cannot say which commit it
      // is cannot be contradicted by anything, which is exactly the state that
      // let a branch be described as a product.
      const before = process.env.FOUNDRY_COMMIT;
      delete process.env.FOUNDRY_COMMIT;
      try {
        const { observeDeployedIdentity } = await import(
          '../../src/services/foundry/self-observation.js');
        const seen = await observeDeployedIdentity('http://127.0.0.1:9');
        expect(seen.thisBuild).toBeNull();
        expect(seen.sameThing).toBe(false);
        expect(seen.says).toContain('cannot say which commit it was built from');
      } finally {
        if (before === undefined) delete process.env.FOUNDRY_COMMIT;
        else process.env.FOUNDRY_COMMIT = before;
      }
    }, 30_000);

  it('does not call itself deployed because it knows its own commit', async () => {
    // KNOWING WHAT YOU ARE IS NOT THE SAME AS BEING WHAT IS RUNNING. With
    // production unreachable, a stamped build must still come back not-deployed.
    const before = process.env.FOUNDRY_COMMIT;
    process.env.FOUNDRY_COMMIT = 'f'.repeat(40);
    try {
      const { observeDeployedIdentity } = await import(
        '../../src/services/foundry/self-observation.js');
      const seen = await observeDeployedIdentity('http://127.0.0.1:9');
      expect(seen.thisBuild).toBe('f'.repeat(40));
      expect(seen.sameThing).toBe(false);
      expect(seen.says).toContain('I cannot tell what production is running');
    } finally {
      if (before === undefined) delete process.env.FOUNDRY_COMMIT;
      else process.env.FOUNDRY_COMMIT = before;
    }
  }, 30_000);
});
