// =============================================================================
// ONE WORD FOR ONE PLACE
//
// The same door was "Discover" in the rail and the More sheet, "Searching" in
// the crumbs, the eyebrow and the Home line, and "Not searching" when nothing
// was open. The same reading was "Estate" on Home's glance and "Health" on
// Controls. Neither was a bug in any one file: the words were typed where they
// were rendered, three or four places each, so they drifted one template at a
// time and a reviewer on a phone could not tell that two labels were one
// place.
//
// This is the vocabulary. A place has ONE name, and the places' own routes,
// the rail, the More sheet and every `Where` read it from here. Where a word
// changes with state (nothing is being searched for; the estate is degraded)
// the STATE changes, never the name of the place.
// =============================================================================

import type { Place } from './shell.js';

/** The one name of each place, as the owner reads it. */
export const LABELS: Record<Place, string> = {
  // FOUR DOORS (long-horizon directive, 30 September 2026): Home, Portfolio,
  // Explore, Control. The keys are the places' old names so no screen changed
  // its identity; only the words the owner reads did. Needs you is a count in
  // every header, and the Missions list is "All work", under Explore.
  foundry: 'Home',
  explore: 'Explore',
  missions: 'All work',
  decisions: 'Needs you',
  companies: 'Portfolio',
  // SEARCHING, everywhere. "Discover" was a product word for a thing the owner
  // calls looking for something; the place is the same place whether or not a
  // search is open, and the empty state says so in its own sentence.
  discover: 'Searching',
  experiments: 'Experiments',
  inbox: 'Inbox',
  activity: 'Activity',
  money: 'Economics',
  controls: 'Control',
  advanced: 'Advanced',
};

/** The address each place answers at. */
export const ADDRESSES: Record<Place, string> = {
  foundry: '/foundry',
  explore: '/foundry/explore',
  missions: '/foundry/missions',
  // Decisions answered here until 30 September 2026; that address now
  // redirects, permanently, to this one.
  decisions: '/foundry/needs-you',
  companies: '/foundry/companies',
  discover: '/foundry/searching',
  experiments: '/foundry/experiments',
  inbox: '/foundry/inbox',
  activity: '/foundry/activity',
  money: '/foundry/money',
  controls: '/foundry/controls',
  advanced: '/letter',
};

/**
 * The readings that are not places and were nonetheless said two ways. Health
 * is the one word for whether Foundry itself is running: the tile on Home, the
 * card on Controls and the absence page all say Health.
 */
export const READINGS = {
  health: 'Health',
  autonomy: 'Autonomy',
  needsYou: 'Needs you',
  yours: 'Yours',
  watching: 'Watching',
} as const;
