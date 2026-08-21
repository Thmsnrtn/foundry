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
  /**
   * Whether a push actually left for the provider. `delivered` says a record
   * the founder can find exists; this says their phone was reached. They are
   * different facts and were the same field, which is how the policy's top rung
   * came to mean nothing.
   */
  pushed?: boolean;
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
      // The push capability itself was built — the owner asked for it
      // explicitly, through the gateway, with the kill switch, the entitlement
      // pause, dedup and audit. It had one caller. This is the second.
      //
      // The notification row is still written, because a push is a nudge and
      // the record is the record: a founder who missed the buzz must still find
      // it in the app. `delivered` therefore still means "a record exists",
      // and whether the phone was actually reached is its own field rather
      // than folded into that one.
      await createNotification(founderId, productId, 'system', event.title, event.body, event.actionUrl, event.actionLabel);
      let pushed = false;
      try {
        const { notifyFounder } = await import('../notifications/push.js');
        // `daily_briefing` rather than a new type: the type names a real
        // preference COLUMN on `push_subscriptions`, so inventing one here
        // would mean a migration and a preference the founder never chose.
        const result = await notifyFounder({
          productId, founderId, notificationType: 'daily_briefing',
          payload: {
            title: event.title, body: event.body,
            // The action lives in `data`, which is where the payload carries
            // anything that is not the two lines the phone shows.
            ...(event.actionUrl ? { data: { url: event.actionUrl } } : {}),
          },
        });
        pushed = result.sent > 0;
      } catch (error) {
        // A push that could not be sent must never cost the founder the record.
        log.warn('interruption push failed', {
          founderId, productId, error: error instanceof Error ? error.message : String(error),
        });
      }
      return { channel, delivered: true, pushed };
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
