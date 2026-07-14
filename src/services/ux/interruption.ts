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
    case 'push':
      // Push rides the notification row; the mobile poller/APNS layer picks
      // it up. The distinction that matters here is intent + audit.
      await createNotification(founderId, productId, 'system', event.title, event.body, event.actionUrl, event.actionLabel);
      return { channel, delivered: true };
    case 'notification':
      await createNotification(founderId, productId, 'system', event.title, event.body, event.actionUrl, event.actionLabel);
      return { channel, delivered: true };
    case 'letter':
      // No side effect: the Letter composes from the ledgers, so the event
      // will appear there. The decision itself is the record.
      return { channel, delivered: false };
    case 'log':
      return { channel, delivered: false };
  }
}
