process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { decideChannel } from '../../src/services/ux/interruption.js';

// =============================================================================
// A CEILING THE FOUNDER SET, AND THE PATHS THAT WENT ROUND IT.
//
// `preferences.max_channel` is declared in `types/index.ts` as "Interruption
// ceiling: the loudest channel Foundry may ever use. The policy can only quiet
// below this, never exceed it." `ux/interruption.ts` opens by saying "this
// module alone decides HOW LOUDLY to deliver", and describes push as "the only
// tier that interrupts life".
//
// One path reached the founder's phone without consulting any of it.
// `intelligence/risk-state.ts` called `notifyFounder` directly, so a founder
// who set `letter` — meaning do not interrupt my life — got a push on every
// risk-state change.
//
// Its comment said the send was "governed like every other outward effect",
// and that was true and beside the point: THE GATEWAY GOVERNS WHETHER AN EFFECT
// MAY LEAVE; THE CEILING GOVERNS HOW LOUDLY FOUNDRY MAY INTERRUPT THIS PERSON.
// Passing the first says nothing about the second.
//
// Eleven more calls write in-app notifications directly, skipping both the
// ceiling and the strain quieting. Those are not fixed here: each needs an
// importance chosen for it, which is a judgment per site rather than a
// mechanical change, and dropping a notification silently would cost the
// founder a record they currently get. The last test pins the list so it can
// only shrink.
// =============================================================================

describe('the ceiling is a ceiling', () => {
  it('quiets a push to the level the founder allowed', () => {
    expect(decideChannel('critical', 'steady', { max_channel: 'letter' })).toBe('letter');
    expect(decideChannel('critical', 'steady', { max_channel: 'log' })).toBe('log');
  });

  it('binds even the most urgent event', () => {
    expect(decideChannel('critical', 'steady', null), 'no ceiling set').toBe('push');
    expect(decideChannel('critical', 'steady', { max_channel: 'notification' }),
      'a kill-switch-worthy event still respects an explicit ceiling').toBe('notification');
  });

  it('never raises above what the importance earned', () => {
    expect(decideChannel('info', 'steady', { max_channel: 'push' }),
      'a ceiling permits, it does not promote').toBe('log');
  });

  it('quiets for strain without exceeding the ceiling either way', () => {
    expect(decideChannel('action_needed', 'overloaded', { max_channel: 'push' })).toBe('letter');
    expect(decideChannel('attention', 'steady', { max_channel: 'push' })).toBe('letter');
  });
});

describe('the path that reached a phone directly', () => {
  it('asks the ceiling before pushing', () => {
    const src = stripComments(
      readFileSync('src/services/intelligence/risk-state.ts', 'utf8'), { lineComments: true });
    expect(src, 'it called notifyFounder with nothing between').toMatch(/mayPush\(/);
    // The guard must come BEFORE the send, not after it.
    const guardAt = src.indexOf('mayPush(');
    const sendAt = src.indexOf('notifyFounder({');
    expect(guardAt).toBeGreaterThan(-1);
    expect(guardAt, 'a check after the send is not a check').toBeLessThan(sendAt);
  });

  it('keeps the push type the founder actually subscribed to', () => {
    const src = readFileSync('src/services/intelligence/risk-state.ts', 'utf8');
    expect(src, "deliver()'s push rung flattens every type to daily_briefing")
      .toMatch(/notificationType: 'risk_state_change'/);
  });
});

describe('every other path to a phone', () => {
  function pushCallers(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts') && p !== 'src/services/notifications/push.ts'
          && /\bnotifyFounder\b/.test(
            stripComments(readFileSync(p, 'utf8'), { lineComments: true }))) out.push(p);
      }
    };
    walk('src');
    return out;
  }

  it('consults the interruption policy', () => {
    const offenders = pushCallers().filter((f) => {
      const src = stripComments(readFileSync(f, 'utf8'), { lineComments: true });
      // `interruption.ts` IS the policy; everyone else must ask it.
      return f !== 'src/services/ux/interruption.ts'
        && !/mayPush|decideChannel/.test(src);
    });
    expect(offenders, 'a new path to somebody’s phone must ask the ceiling first')
      .toEqual([]);
  });
});

describe('the letter rung is only safe for what the Letter carries', () => {
  it('says which facts those are, rather than "the ledgers"', () => {
    const src = readFileSync('src/services/ux/interruption.ts', 'utf8');
    // It used to say "the Letter composes from the ledgers, so the event will
    // appear there". The Letter composes from a specific list, and an event
    // outside it is silently DROPPED by a founder quieting their ceiling.
    expect(src).toMatch(/composes from a specific list, not from the/);
    expect(src).toMatch(/route through `deliver\(\)` only when the Letter/);
  });

  it('matches what the Letter actually reads', () => {
    const composer = stripComments(
      readFileSync('src/services/letter/composer.ts', 'utf8'), { lineComments: true });
    // The two facts converted to `deliver()` so far must really be in there.
    expect(composer, 'peer radar').toMatch(/scanForWarnings\(/);
    expect(composer, 'falsified premises').toMatch(/getExpiredBeliefs\(/);
  });

  it('routes the peer-radar bell through the policy', () => {
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    const radar = src.slice(src.indexOf('network_radar starting'));
    const body = radar.slice(0, radar.indexOf('network_radar complete'));
    expect(body, 'the Letter carries this fact, so quieting it is safe')
      .toMatch(/deliver\(p\.owner_id, p\.id/);
    expect(body).not.toMatch(/createNotification\(/);
  });
});

describe('the in-app bypass, pinned so it can only shrink', () => {
  function notificationCallers(): string[] {
    const out: string[] = [];
    const walk = (d: string) => {
      for (const e of readdirSync(d, { withFileTypes: true })) {
        const p = join(d, e.name);
        if (e.isDirectory()) walk(p);
        else if (p.endsWith('.ts')
          && p !== 'src/services/ux/notifications.ts'
          && p !== 'src/services/ux/interruption.ts'
          && /\bcreateNotification\b/.test(
            stripComments(readFileSync(p, 'utf8'), { lineComments: true }))) out.push(p);
      }
    };
    walk('src');
    return out.sort();
  }

  // These write an in-app notification without going through `deliver()`, so
  // they skip the founder's ceiling and the strain quieting. Each needs an
  // importance chosen for it — a judgment per call site, not a rewrite — and
  // dropping the notification instead would cost the founder a record. The list
  // is here so the number cannot grow while that work is outstanding.
  const KNOWN_BYPASSES = [
    'src/jobs/index.ts',
    'src/services/billing/stripe.ts',
    'src/services/ux/milestones.ts',
  ];

  it('has not grown', () => {
    expect(notificationCallers()).toEqual(KNOWN_BYPASSES);
  });

  it('is shrinking, and only where the Letter carries the fact', () => {
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    const calls = (src.match(/await createNotification\(/g) ?? []).length;
    expect(calls, 'eight before peer radar and falsified premises moved')
      .toBeLessThanOrEqual(6);
  });

  it('converted the premise bell, whose fact the Letter really does carry', () => {
    const kernel = stripComments(
      readFileSync('src/services/memory/kernel.ts', 'utf8'), { lineComments: true });
    expect(kernel, "getExpiredBeliefs reads exactly what checkPremises writes")
      .toMatch(/status = 'falsified'/);

    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    const idx = src.indexOf('A past decision now rests on a false premise');
    expect(idx).toBeGreaterThan(-1);
    expect(src.slice(Math.max(0, idx - 900), idx), 'routed through the policy')
      .toMatch(/deliver\(p\.owner_id, p\.id/);
  });

  it('left the decision bells alone, because the Letter does not carry them', () => {
    // The Letter has the TOP PENDING decision and gate-0 decisions decided in
    // the last day. A decision decided weeks ago whose follow-up has come due
    // is neither, so quieting it to the letter would drop it.
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    for (const bell of ['decision_followup', 'decision_retrospective']) {
      // The type is the third argument, so the call opens BEFORE the literal;
      // the first occurrence of the name is in the dedup query above it.
      const idx = src.lastIndexOf(`'${bell}'`);
      expect(idx, `${bell} should still exist`).toBeGreaterThan(-1);
      expect(src.slice(Math.max(0, idx - 500), idx),
        `${bell} must not be quieted while the Letter cannot carry it`)
        .toMatch(/createNotification\(/);
    }
  });
});
