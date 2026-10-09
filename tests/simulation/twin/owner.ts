// =============================================================================
// THE OWNER IN THE TWIN — and what his attention costs, by a stated model.
//
// He does the least an owner who wants Foundry to need him 1% of the time
// would do, and only what the institution asks him for through Needs-you:
//
//   - when the charter is ending (its item appears) or has lapsed, he signs it
//     again for a quarter on the same terms;
//   - a printable the stranger panel was split on, he releases;
//   - mail only he can answer, he answers (settled 'resolved').
//
// Everything else waits, and costs him a glance a day while it waits.
//
// THE MINUTES MODEL (params.ts, all ASSUMPTIONS, drawn per seed):
//   a new needs-you item         → minutes.perNewItem
//   a new buyer email for him    → minutes.perBuyerMail (instead)
//   an item still waiting        → minutes.perWaitingItemPerDay, each day
//   reading the Brief            → minutes.weeklyRead / 7, each day
// Nothing is inferred from activity the owner did not have: a minute is
// charged only for an item the institution actually put in front of him.
//
// THE WEEK'S BATCH (F1, 9 October 2026): an item that waits for the week
// (`waitsForTheWeek`) leaves his list between batch days and comes back on the
// next one. Coming back is not new to him when he read it in the last seven
// days: it is charged as a waiting item (a glance), not a new one. Any other
// item that disappears and comes back is still charged as new.
// =============================================================================
import type { Drawn } from './params.js';

export interface OwnerDay {
  minutes: number;
  items: number;
  newItems: string[];
  acts: string[];
}

export interface Owner {
  day(founderId: string): Promise<OwnerDay>;
  /** Item kinds seen, by the key's prefix, with how many new ones of each. */
  seen: Record<string, number>;
  /** What each new item said when it first reached him, by its summary with ids blanked: what drives his minutes. */
  said: Record<string, number>;
}

export function anOwner(p: Drawn, terms: { testsTotalCents: number; probesInFlight: number; cognitionCentsPerDay: number; publicVoice: string; statement: string }): Owner {
  const open = new Set<string>();
  const seen: Record<string, number> = {};
  const said: Record<string, number> = {};
  const lastSeen = new Map<string, number>();
  let dayN = 0;
  return {
    seen, said,
    async day(founderId) {
      const { needsYou } = await import('../../../src/services/needs-you/queue.js');
      const { liveCharter, signCharter } = await import('../../../src/services/institution/charter.js');
      const { waitsForTheWeek } = await import('../../../src/services/needs-you/queue.js');
      dayN += 1;
      const out: OwnerDay = { minutes: p['minutes.weeklyRead'] / 7, items: 0, newItems: [], acts: [] };
      const { items } = await needsYou(founderId);
      out.items = items.length;
      const now = new Set(items.map((i) => i.key));
      for (const i of items) {
        const kind = i.key.split(':')[0]!;
        const readThisWeek = i.item !== null && waitsForTheWeek(i.item) && dayN - (lastSeen.get(i.key) ?? -99) <= 7;
        lastSeen.set(i.key, dayN);
        if (open.has(i.key) || readThisWeek) { out.minutes += p['minutes.perWaitingItemPerDay']; continue; }
        out.newItems.push(i.key);
        seen[kind] = (seen[kind] ?? 0) + 1;
        const words = `${kind}: ${i.summary.replace(/"[^"]*"/g, '"…"').slice(0, 90)}`;
        said[words] = (said[words] ?? 0) + 1;
        out.minutes += kind === 'mail' ? p['minutes.perBuyerMail'] : p['minutes.perNewItem'];
      }
      open.clear();
      for (const k of now) open.add(k);

      // HIS ACTS: only what an item asked of him.
      if (items.some((i) => i.key.startsWith('charter:')) || !(await liveCharter(founderId))) {
        await signCharter({ founderId, days: 90, ...terms });
        out.acts.push('signed the charter for another quarter');
      }
      const { printablesHeld, releaseHeldPrintable } = await import('../../../src/services/venture/products/printable.js');
      for (const h of await printablesHeld(founderId)) {
        const r = await releaseHeldPrintable({ founderId, experimentId: h.experimentId, by: `founder:${founderId}` });
        if (r.released) out.acts.push(`released a held file: ${h.title}`);
      }
      const { needsTheOwner, settleMail } = await import('../../../src/services/public-workshop/mail.js');
      for (const m of await needsTheOwner(founderId)) {
        await settleMail({ founderId, id: m.id, handling: 'resolved', because: 'answered by the owner' });
        out.acts.push('answered a buyer');
      }
      return out;
    },
  };
}
