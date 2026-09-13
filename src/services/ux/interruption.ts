// =============================================================================
// FOUNDRY — Interruption Policy (Jarvis slice 1 / Attention + Human Laws)
//
// Detection and delivery are separate concerns: jobs DETECT; this module
// alone decides HOW LOUDLY to deliver. The ladder, quietest first:
//
//   log          — audit trail only; visible if the founder goes looking
//   letter       — a line in tomorrow's (fleet) Letter; zero interruption
//   notification — in-app bell; seen next visit
//   push         — reaches the phone; the only tier that interrupts life
//
// Two forces push DOWN the ladder, none push up:
//   - the founder's measured strain (wellbeing pulse): strained drops
//     non-critical events one tier; overloaded pins everything below
//     critical to the letter
//   - the founder's own ceiling (preferences.max_channel) always wins
// 'critical' is exempt from strain (a kill-switch-worthy event must reach
// the founder) but still respects the explicit ceiling.
// =============================================================================

import { createNotification } from './notifications.js';
import { getFounderPulse, type PulseSignal } from '../wellbeing/pulse.js';
import { log } from '../../lib/logger.js';
import type { FounderPreferences } from '../../types/index.js';
import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

export type Channel = 'log' | 'letter' | 'notification' | 'push';
export type Importance = 'info' | 'attention' | 'action_needed' | 'critical';

const LADDER: Channel[] = ['log', 'letter', 'notification', 'push'];
const BASE: Record<Importance, Channel> = {
  info: 'log',
  attention: 'letter',
  action_needed: 'notification',
  critical: 'push',
};

function down(ch: Channel, steps: number): Channel {
  return LADDER[Math.max(0, LADDER.indexOf(ch) - steps)];
}

/**
 * Set the founder's interruption ceiling — the loudest channel Foundry may ever
 * use to reach them.
 *
 * A CEILING NOTHING COULD SET. `decideChannel` has always honoured
 * `preferences.max_channel`, this module's header calls it the thing that
 * "always wins", and two other modules cite it as the reason they consult
 * before reaching a phone. Nothing in the repository ever wrote it. The only
 * key ever written into `founders.preferences` is `fluency`, so the ceiling
 * branch was dead for every founder and everybody sat permanently at the top of
 * the ladder.
 *
 * A control the product describes as the person's own, which the person has no
 * way to exercise, is a claim about a control rather than a control. This is
 * the writer, and the settings page is where it is used from.
 *
 * JSON-merges, so the fluency dial beside it survives.
 */
export async function setMaxChannel(founderId: string, channel: Channel): Promise<void> {
  if (!LADDER.includes(channel)) return;
  const r = await query('SELECT preferences FROM founders WHERE id = ?', [founderId]);
  const raw = (r.rows[0] as Record<string, string | null> | undefined)?.preferences;
  let prefs: Record<string, unknown> = {};
  try { prefs = raw ? JSON.parse(raw) as Record<string, unknown> : {}; } catch { /* replace corrupt prefs */ }
  prefs.max_channel = channel;
  await query('UPDATE founders SET preferences = ? WHERE id = ?', [JSON.stringify(prefs), founderId]);
}

export function decideChannel(
  importance: Importance,
  pulse: PulseSignal,
  prefs?: FounderPreferences | null,
): Channel {
  let ch = BASE[importance];
  if (importance !== 'critical') {
    if (pulse === 'strained') ch = down(ch, 1);
    if (pulse === 'overloaded') ch = down(ch, 2);
    // Floor: something that needs action never falls out of the letter —
    // overload quiets the DELIVERY, not the record.
    if (importance === 'action_needed' && LADDER.indexOf(ch) < LADDER.indexOf('letter')) ch = 'letter';
  }
  const ceiling = prefs?.max_channel;
  if (ceiling && LADDER.includes(ceiling as Channel)) {
    const cap = LADDER.indexOf(ceiling as Channel);
    if (LADDER.indexOf(ch) > cap) ch = LADDER[cap];
  }
  return ch;
}

/**
 * MAY FOUNDRY REACH THIS PERSON'S PHONE RIGHT NOW.
 *
 * `deliver()` is the front door, and a caller that already knows which push
 * TYPE the founder subscribed to should keep that knowledge rather than come
 * through a door that flattens it. What such a caller must not do is skip the
 * ceiling: `preferences.max_channel` is the founder saying how loudly Foundry
 * may ever interrupt them, and push is the rung this module describes as "the
 * only tier that interrupts life".
 *
 * This is that check on its own, so consulting it costs one call.
 */
export async function mayPush(
  founderId: string,
  productId: string,
  importance: Importance,
  prefs?: FounderPreferences | null,
): Promise<boolean> {
  const pulse = await getFounderPulse(productId).then((p) => p.signal)
    .catch(() => 'steady' as PulseSignal);
  const decided = decideChannel(importance, pulse, prefs);
  if (decided !== 'push') {
    log.info('interruption ceiling withheld a push', {
      founderId, productId, importance, pulse, decided,
    });
  }
  return decided === 'push';
}

export interface DeliverableEvent {
  importance: Importance;
  title: string;
  body: string;
  actionUrl?: string;
  actionLabel?: string;
}

export interface DeliveryResult {
  channel: Channel;
  delivered: boolean;
}

/** Route one detected event through the policy. `productId` anchors the
 *  pulse read and the notification; pass the founder's primary product for
 *  fleet-level events. Every delivery decision is logged — "why didn't you
 *  tell me?" always has an answer. */
export async function deliver(
  founderId: string,
  productId: string,
  event: DeliverableEvent,
  prefs?: FounderPreferences | null,
): Promise<DeliveryResult> {
  const pulse = await getFounderPulse(productId).then((p) => p.signal).catch(() => 'steady' as PulseSignal);
  const channel = decideChannel(event.importance, pulse, prefs);

  log.info('interruption policy decision', {
    founderId, importance: event.importance, pulse, channel, title: event.title,
  });

  switch (channel) {
    case 'push': {
      // THE POLICY'S TOP RUNG USED TO DO WHAT THE ONE BELOW IT DOES.
      //
      // This wrote a notification row and returned `delivered: true`, with a
      // comment saying "the mobile poller/APNS layer picks it up". No such
      // poller exists: nothing anywhere turns a notification row into a push.
      // So `decideChannel` deciding that an event warranted interrupting the
      // founder produced exactly the same effect as deciding it did not, and
      // the Attention Law's most urgent channel was decoration.
      //
      // AND THEN THE PUSH CAPABILITY WENT THE SAME WAY.
      //
      // It was built properly — gateway, kill switch, entitlement pause, dedup,
      // audit — and it looked up the founder's devices in `push_subscriptions`.
      // The only thing that could ever have registered a device was the route
      // deleted with the commercial product, so that lookup returned nothing on
      // every call from the day it shipped. Wrapping a guaranteed-empty result
      // in a try/catch and reporting `pushed: false` is not a degraded push, it
      // is a decoration with a status field.
      //
      // The notification row was always the real delivery and still is: a
      // founder who missed a buzz that never existed still finds the record in
      // the app. So `delivered` keeps its meaning, and the field that reported
      // on a phone nothing could reach is gone rather than permanently false.
      await createNotification(founderId, productId, 'system', event.title, event.body, event.actionUrl, event.actionLabel);
      return { channel, delivered: true };
    }
    case 'notification':
      await createNotification(founderId, productId, 'system', event.title, event.body, event.actionUrl, event.actionLabel);
      return { channel, delivered: true };
    case 'letter':
    case 'log': {
      // THE QUIET RUNGS LEAVE A RECORD.
      //
      // These wrote nothing, excused by "the Letter composes from the ledgers,
      // so the event will appear there". The Letter composes from a specific
      // list — completed executions, gate-0 decisions decided in the last day,
      // the top pending decision, falsified premises, the memory digest,
      // peer-radar warnings, the trust ledger, dissent. An event whose fact is
      // in that list survived. An event outside it was DROPPED, silently, by a
      // founder setting a lower ceiling than they realised they were setting —
      // which is why six notification paths could not be routed through this
      // policy at all: obeying the ceiling would have cost the founder the fact.
      //
      // Migration 182 is what makes quieting safe. `log` is recorded too: it is
      // the audit trail behind "why didn't you tell me?", which this module's
      // own header promises always has an answer.
      await query(
        `INSERT INTO quieted_events
           (id, product_id, founder_id, channel, importance, title, body, action_url, action_label)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [nanoid(), productId, founderId, channel, event.importance,
          event.title, event.body, event.actionUrl ?? null, event.actionLabel ?? null]);
      // `delivered` still means "a record the founder will be shown exists".
      // The Letter shows the letter rung; `log` is findable but not surfaced,
      // which is what the founder asked for by setting that ceiling.
      return { channel, delivered: channel === 'letter' };
    }
  }
}
