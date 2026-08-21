process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { decideChannel, deliver } from '../../src/services/ux/interruption.js';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { nanoid } from 'nanoid';
import { beforeAll, beforeEach } from 'vitest';

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

describe('the quiet rungs leave a record — behaviourally', () => {
  beforeAll(async () => { await runMigrations(); });
  beforeEach(async () => {
    await query('DELETE FROM quieted_events');
    await query('DELETE FROM products');
    await query('DELETE FROM founders');
  });

  async function company(): Promise<{ founderId: string; productId: string }> {
    const founderId = `f_${nanoid(8)}`;
    await query('INSERT INTO founders (id, clerk_user_id, email) VALUES (?,?,?)',
      [founderId, `c_${founderId}`, `${founderId}@example.com`]);
    const productId = `p_${nanoid(8)}`;
    await query("INSERT INTO products (id, name, owner_id, status) VALUES (?,?,?,'active')",
      [productId, 'C', founderId]);
    return { founderId, productId };
  }

  it('records an event the founder quieted to the letter', async () => {
    const { founderId, productId } = await company();
    const res = await deliver(founderId, productId, {
      importance: 'action_needed', title: 'Something happened', body: 'Details here',
    }, { max_channel: 'letter' });

    expect(res.channel, 'the ceiling quieted it').toBe('letter');
    const rows = await query(
      'SELECT channel, importance, title FROM quieted_events WHERE product_id = ?', [productId]);
    expect(rows.rows.length, 'this used to write nothing at all').toBe(1);
    const row = rows.rows[0] as unknown as Record<string, unknown>;
    expect(row.channel).toBe('letter');
    expect(row.importance).toBe('action_needed');
  });

  it('records a log-rung event too, as the audit trail', async () => {
    const { founderId, productId } = await company();
    const res = await deliver(founderId, productId, {
      importance: 'critical', title: 'Something happened', body: 'Details',
    }, { max_channel: 'log' });

    expect(res.channel).toBe('log');
    expect(res.delivered, 'findable, but not surfaced — what that ceiling asks for')
      .toBe(false);
    const rows = await query("SELECT id FROM quieted_events WHERE channel = 'log'");
    expect(rows.rows.length).toBe(1);
  });

  it('writes nothing extra when the event was actually delivered', async () => {
    const { founderId, productId } = await company();
    await deliver(founderId, productId, {
      importance: 'action_needed', title: 'Loud', body: 'Details',
    }, { max_channel: 'push' });
    const rows = await query('SELECT id FROM quieted_events WHERE product_id = ?', [productId]);
    expect(rows.rows.length, 'nothing was quieted').toBe(0);
  });
});

describe('the quiet rungs leave a record', () => {
  it('writes the event rather than trusting the Letter to have it', () => {
    const src = stripComments(
      readFileSync('src/services/ux/interruption.ts', 'utf8'), { lineComments: true });
    // These wrote NOTHING, excused by "the Letter composes from the ledgers, so
    // the event will appear there". It composes from a specific list, and an
    // event outside it was dropped silently by a founder quieting their
    // ceiling — which is why six bells could not use the policy at all.
    expect(src).toMatch(/INSERT INTO quieted_events/);
    expect(src, "'log' is the audit trail behind \"why didn't you tell me?\"")
      .toMatch(/channel IS NOT NULL|case 'log'/);
  });

  it('is read back by the Letter', () => {
    const composer = stripComments(
      readFileSync('src/services/letter/composer.ts', 'utf8'), { lineComments: true });
    expect(composer).toMatch(/FROM quieted_events/);
    expect(composer, "and it counts toward whether the day was quiet")
      .toMatch(/noted\.length === 0/);
  });

  it('reaches the page a founder reads', () => {
    const src = readFileSync('src/routes/dashboard/letter.ts', 'utf8');
    expect(src).toMatch(/Noticed, and not worth interrupting you for/);
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

  // ONE FILE REMAINS, AND IT IS RIGHT THAT IT DOES.
  //
  // `billing/stripe.ts` tells a founder their card failed and their service is
  // about to lapse. `max_channel` is an ATTENTION preference — how loudly
  // Foundry may interrupt about the work — and the owner's §14 decision draws
  // the line this sits on: necessary service, billing, security and
  // configuration state stays ungated and disclosed; optional product
  // telemetry and celebration honour the preference. These notices are also
  // founder-scoped and carry no product id, which a company-scoped policy
  // cannot anchor.
  //
  // Anything ADDED to this list is a claim that some other message outranks a
  // founder's stated wishes. The test exists to make somebody write that claim
  // down.
  const KNOWN_BYPASSES = ['src/services/billing/stripe.ts'];

  it('has not grown', () => {
    expect(notificationCallers()).toEqual(KNOWN_BYPASSES);
  });

  it('is empty in jobs, which held eight of them', () => {
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    expect((src.match(/createNotification\(/g) ?? []).length,
      'every scheduled bell now asks the ceiling').toBe(0);
  });

  it('celebrates through the policy, because a milestone is optional', () => {
    const src = stripComments(
      readFileSync('src/services/ux/milestones.ts', 'utf8'), { lineComments: true });
    expect(src, 'the most optional thing Foundry ever says')
      .toMatch(/deliver\(founderId, productId/);
    expect(src).not.toMatch(/createNotification\(/);
  });

  it('says why billing is not subject to an attention preference', () => {
    const src = readFileSync('src/services/billing/stripe.ts', 'utf8');
    expect(src).toMatch(/NOT THROUGH THE INTERRUPTION POLICY, AND DELIBERATELY/);
    expect(src, 'grounded in the owner decision, not in convenience')
      .toMatch(/§14 decision/);
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

  it('can quiet the decision bells now, because the letter rung records', () => {
    // These could not be routed through the policy while the letter rung wrote
    // nothing: the Letter carries the TOP PENDING decision and gate-0 decisions
    // decided in the last day, and a decision decided weeks ago whose follow-up
    // has come due is neither. Migration 182 removed that constraint.
    const src = stripComments(readFileSync('src/jobs/index.ts', 'utf8'), { lineComments: true });
    expect(src).toMatch(/decision_follow_up/);
    expect((src.match(/await deliver\(/g) ?? []).length,
      'eight bells, all through the policy').toBeGreaterThanOrEqual(7);
  });
});
