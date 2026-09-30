// =============================================================================
// WHO IS LOOKING, FOR THE ONE COUNT EVERY PAGE CARRIES.
//
// The long-horizon directive (30 September 2026) makes Needs you a count in
// the header of every page rather than a door in the bar: the owner should
// never have to go somewhere to learn whether anything waits on them. `page()`
// is called from several hundred sites and knows nothing of the request, for
// the reason `appearance.ts` gives — so the one fact it needs, whose count to
// read, travels the same way the appearance does: a request-scoped store set
// where the owner's row is loaded, and invisible to everything that does not
// ask.
//
// IDENTITY, NOT AUTHORITY. The store holds an id the session already proved.
// Nothing reads it to decide what may happen; it chooses which count to show.
// =============================================================================

import { AsyncLocalStorage } from 'node:async_hooks';

interface Viewer { founderId: string; needsYou?: Promise<number | null> }

const store = new AsyncLocalStorage<Viewer>();

/** Run one request with the signed-in owner in scope. */
export const withViewer = <T>(founderId: string, fn: () => T): T => store.run({ founderId }, fn);

/**
 * HOW MANY THINGS NEED HIM, ONCE PER REQUEST. Null when nobody is in scope, or
 * when the queue could not be read — a page must never fail because its header
 * could not count, and a failed count is shown as no count, never as zero.
 */
export function needsYouNow(): Promise<number | null> {
  const v = store.getStore();
  if (!v) return Promise.resolve(null);
  v.needsYou ??= import('../../services/needs-you/queue.js')
    .then((m) => m.needsYouCount(v.founderId))
    .catch(() => null);
  return v.needsYou;
}
