// =============================================================================
// FOUNDRY — what the owner said, compiled into one proposal.
//
// LANGUAGE EXPRESSES INTENT; STRUCTURED STATE GOVERNS THE INSTITUTION. The
// owner's Mission-Control directive (30 September 2026) asks for one shape for
// what Foundry understood a sentence to mean, shown before anything binds.
// The readers already existed — `whichDoor` and the five it consults, each a
// phrase table, never a model — and each returned its own shape. This wraps
// them, and changes none of their judgments: a sentence goes to the same
// destination it always did. What is new is the proposal around it.
//
//   - WHAT KIND OF THING IT IS, in one small vocabulary the owner can learn:
//     a question, a Mission, steering, authority, housekeeping, a jump to a
//     place, or something to clarify.
//   - STEERING OR AUTHORITY. Steering changes what Foundry aims for and grants
//     nothing; authority changes what Foundry may do or what stops it. The
//     owner's directive keeps the two apart, and so does every screen that
//     shows this proposal. A sentence that would touch authority is never
//     presented as mere steering, whatever words it uses.
//   - A HASH of what was understood, so a confirmation can be checked against
//     the reading it confirms. The confirm path recompiles the sentence on the
//     server and binds only if the reading is the one that was shown; a form
//     field can never carry the meaning.
//
// A JUMP IS NOT AN INSTRUCTION. "Economics", "open the charter", or the name of
// one of his companies is somewhere he wants to go; it is recognised only as
// the whole sentence, so "grow Lamplight" is never read as a walk to its page.
// =============================================================================

import { createHash } from 'node:crypto';
import { whichDoor, type Destination, type Doorway } from '../institution/the-door.js';
import { interpret } from '../institution/standing-intent.js';
import { readMandate, type MandateReading } from '../mandate/statements.js';

export type IntentKind =
  | 'question' | 'mission' | 'steer' | 'authority' | 'housekeeping' | 'jump' | 'clarify' | 'unplaceable';

export const INTENT_WORDS: Record<IntentKind, string> = {
  question: 'A question', mission: 'Work to take on', steer: 'Steering', authority: 'What I may do',
  housekeeping: 'Tidying up', jump: 'Somewhere to go', clarify: 'Asking which you meant', unplaceable: 'Not understood',
};

export interface Scope { kind: 'company' | 'none'; id: string | null; name: string | null }

/** One change the sentence would make, classed as steering or authority. */
export interface IntentEffect {
  class: 'steer' | 'authority';
  what: string;
  /** Whether the owner can take it back with one act. */
  reversible: boolean;
}

export interface IntentProposal {
  said: string;
  scope: Scope;
  kind: IntentKind;
  /** The door's own destination, kept so the dispatch is exactly what it was. */
  destination: Destination | 'jump' | 'mandate';
  /** What the owner wants, typed, when the sentence was about the Mandate (INSTITUTION_MODEL §7, UpdateMandate). */
  mandate: MandateReading | null;
  understoodAs: string;
  effects: IntentEffect[];
  /** Nothing binds without the owner seeing it: false only for questions and jumps. */
  needsConfirm: boolean;
  /** Where a jump goes. */
  href: string | null;
  needs: string | null;
  /** Of what was understood — never of anything the owner could post back. */
  hash: string;
}

export interface Place { label: string; href: string }

const JUMP_VERB = /^(?:go to|open|show(?: me)?|take me to|jump to)\s+(?:the\s+|my\s+)?/i;
const norm = (s: string): string => s.toLowerCase().replace(/[.!]+$/, '').replace(/\s+/g, ' ').trim();

/** The whole sentence names a place or a company: a walk, not an instruction. */
export function jumpFor(said: string, places: Place[], companies: Array<{ id: string; name: string }>): Place | null {
  const bare = norm(said).replace(JUMP_VERB, '');
  if (!bare || bare.length > 60) return null;
  const place = places.find((p) => norm(p.label) === bare || norm(p.label).replace(/^(the|your)\s+/, '') === bare);
  if (place) return place;
  const company = companies.find((c) => norm(c.name) === bare);
  return company ? { label: company.name, href: `/foundry/companies/${company.id}` } : null;
}

const AUTHORITY_READINGS = new Set(['boundary', 'allowance', 'stop']);

function effectsOf(door: Doorway): { kind: IntentKind; effects: IntentEffect[] } {
  switch (door.destination) {
    case 'question': return { kind: 'question', effects: [] };
    case 'clarify': return { kind: 'clarify', effects: [] };
    case 'unplaceable': return { kind: 'unplaceable', effects: [] };
    case 'housekeeping':
      return { kind: 'housekeeping', effects: [{ class: 'steer', what: door.understoodAs, reversible: true }] };
    case 'authority':
      return { kind: 'authority', effects: [{ class: 'authority', what: door.understoodAs, reversible: true }] };
    case 'venture': {
      // Opening, steering or stopping the search. A search grants nothing:
      // every test it produces still waits for the owner or the charter.
      const stopping = /stop looking/.test(door.understoodAs);
      return { kind: stopping ? 'steer' : 'mission',
        effects: [{ class: 'steer', what: door.understoodAs, reversible: true }] };
    }
    case 'undertaking':
      return { kind: 'mission', effects: [{ class: 'steer', what: door.understoodAs, reversible: true }] };
    case 'posture':
      return { kind: 'steer', effects: [{ class: 'steer', what: door.understoodAs, reversible: true }] };
    case 'company': {
      // THE ONE PLACE A SENTENCE CAN MOVE AUTHORITY. A boundary, an allowance
      // or a stop changes what Foundry may do; an objective or a preference
      // changes what it aims for. Read by the same parser the company page
      // binds with, so the class shown is the class that would bind.
      const reading = interpret(door.said);
      const authority = AUTHORITY_READINGS.has(reading.kind);
      return { kind: authority ? 'authority' : 'steer',
        effects: [{ class: authority ? 'authority' : 'steer', what: door.understoodAs, reversible: true }] };
    }
    default: return { kind: 'unplaceable', effects: [] };
  }
}

function hashOf(p: Omit<IntentProposal, 'hash'>): string {
  return createHash('sha256')
    .update(JSON.stringify([p.said, p.scope.kind, p.scope.id, p.kind, p.destination, p.understoodAs, p.effects, p.mandate]))
    .digest('hex').slice(0, 24);
}

/**
 * COMPILE ONE SENTENCE. Pure: it reads nothing and writes nothing, so the same
 * sentence in the same world always compiles to the same proposal and hash —
 * which is what lets a confirmation be checked by compiling again.
 */
export function compileIntent(raw: string, world: {
  searching: boolean; scope?: Scope; places?: Place[]; companies?: Array<{ id: string; name: string }>;
  /** The day it is read on, for "for now" and "this month". Defaults to today. */
  now?: Date;
}): IntentProposal {
  const said = raw.trim().slice(0, 800);
  const scope: Scope = world.scope ?? { kind: 'none', id: null, name: null };
  const jump = jumpFor(said, world.places ?? [], world.companies ?? []);
  if (jump) {
    const base = { said, scope, kind: 'jump' as const, destination: 'jump' as const,
      understoodAs: `you want to go to ${jump.label}`, effects: [], needsConfirm: false, href: jump.href, needs: null, mandate: null };
    return { ...base, hash: hashOf(base) };
  }
  const door = whichDoor(said, { searching: world.searching });
  // WHAT THE OWNER WANTS, ACROSS EVERYTHING (the Mandate). Asked only of a
  // sentence no other reader placed, or one that would otherwise ask "which
  // company?" when it was said about none — "Spend less this month", "I
  // prefer low-maintenance businesses". Every reader that binds authority ran
  // first, and this one refuses anything that sounds like an act or a rule.
  const unplaced = door.destination === 'unplaceable'
    || (door.needs === 'which company you mean' && scope.kind !== 'company');
  const wanted = unplaced ? readMandate(said, world.now ?? new Date()) : null;
  if (wanted) {
    const base = { said, scope, kind: 'steer' as const, destination: 'mandate' as const, understoodAs: wanted.understoodAs,
      effects: [{ class: 'steer' as const, what: wanted.understoodAs, reversible: true }],
      needsConfirm: true, href: null, needs: null, mandate: wanted };
    return { ...base, hash: hashOf(base) };
  }
  const { kind, effects } = effectsOf(door);
  // A SENTENCE SAID ON A COMPANY'S PAGE IS ABOUT THAT COMPANY. The door asks
  // "which company?" for steering, posture and work; the page already said.
  const needs = scope.kind === 'company' && scope.id && ['company', 'posture', 'undertaking'].includes(door.destination)
    ? null : door.needs;
  const base = {
    said, scope, kind, destination: door.destination, understoodAs: door.understoodAs, effects,
    needsConfirm: kind !== 'question' && kind !== 'clarify' && kind !== 'unplaceable',
    href: null, needs, mandate: null,
  };
  return { ...base, hash: hashOf(base) };
}

/** Whether the proposal would move what Foundry may do. */
export const touchesAuthority = (p: IntentProposal): boolean => p.effects.some((e) => e.class === 'authority');
