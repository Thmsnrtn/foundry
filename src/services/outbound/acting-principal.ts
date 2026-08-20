// =============================================================================
// FOUNDRY — who authorised this, written one way
//
// TWO LEDGERS, FOUR SPELLINGS. `approved_by` is the field that makes an
// authorisation attributable, and the two action ledgers disagreed about what
// goes in it:
//
//   outbound_actions      `founder:<id>`, `institution:assisting`, `auto`
//   action_executions     `voice:<id>`, `system:playbook`,
//                         `autopilot:<category>` — and, from the dashboard
//                         approval, a BARE founder id
//
// Nothing misread a founder as an autopilot, because both readers that
// interpret the field happen to key on the `autopilot:` prefix. That is a
// property of which two readers exist today, not of the data. One vocabulary
// written four ways is the shape that ends with a reader agreeing with only
// some of them — the same shape as the live-grant predicate copied seven times,
// and the two retention jobs deleting from one table on different horizons.
//
// FAILS CLOSED. A value this file does not recognise is not "some other kind of
// approver", it is "I do not know who authorised this", and the safe answer to
// that at an approval door is no. That is why `parsePrincipal` returns null
// rather than guessing, and why both doors refuse rather than writing it.
//
// A ROLE IS NOT A PRINCIPAL. This field once held the literal 'ceo' for every
// founder of every company — legible and false. `founder` is a KIND; the id
// beside it is who.
// =============================================================================

/**
 * The kinds of principal that may authorise a consequential action.
 *
 * A closed set, because adding one is a statement that a new sort of thing may
 * approve an outward effect. That is a constitutional question of the same
 * family as the effect vocabulary (`OWNER_DECISIONS_PENDING` RESOLVED 4), not a
 * convenience.
 */
export const PRINCIPAL_KINDS = {
  /** A person, identified. The id is the founder row. */
  founder: 'identified',
  /** A person acting through the voice surface; the id is still the founder. */
  voice: 'identified',
  /** A department's autopilot; the id is the capability category, so a failed
   *  verification can demote the right one. */
  autopilot: 'identified',
  /** Foundry acting under a permission the founder gave; the id names which
   *  institutional path. */
  institution: 'identified',
  /** An internal mechanism with no person behind it; the id names which. */
  system: 'identified',
} as const;

export type PrincipalKind = keyof typeof PRINCIPAL_KINDS;

/**
 * The one principal that carries no id: an action that reached its notice
 * window without anybody objecting.
 *
 * It is not a person and must never be written where one is meant — "nobody
 * stopped it" and "somebody chose it" are different facts, and the surface
 * below says so in those words.
 */
export const AUTO_PRINCIPAL = 'auto';

/** Build a principal reference. The only way one should be constructed. */
export function principalRef(kind: PrincipalKind, id: string): string {
  const trimmed = id.trim();
  if (!trimmed) throw new Error(`principalRef: ${kind} requires an id`);
  if (trimmed.includes(':')) throw new Error(`principalRef: id may not contain ':'`);
  return `${kind}:${trimmed}`;
}

/**
 * Read a principal reference, or null if this is not one.
 *
 * Null is the answer for a bare id, an unknown kind, and an empty string. A
 * caller that cannot tell those apart does not need to: all three mean the
 * record would not say who authorised the action.
 */
export function parsePrincipal(
  value: string | null | undefined,
): { kind: PrincipalKind | 'auto'; id: string | null } | null {
  if (!value) return null;
  if (value === AUTO_PRINCIPAL) return { kind: 'auto', id: null };
  const separator = value.indexOf(':');
  if (separator <= 0) return null;
  const kind = value.slice(0, separator);
  const id = value.slice(separator + 1);
  if (!(kind in PRINCIPAL_KINDS) || !id) return null;
  return { kind: kind as PrincipalKind, id };
}

/** Whether this value may be written into an `approved_by` column. */
export function isPrincipalRef(value: string | null | undefined): boolean {
  return parsePrincipal(value) !== null;
}

/**
 * Who authorised this, as a person reads it.
 *
 * The column stores a principal reference and one surface rendered it raw. Both
 * halves matter: the record is attributable AND the sentence is in English.
 * An unrecognised value is shown as-is rather than guessed at — a principal
 * this does not know about is exactly the thing somebody should be able to see.
 */
export function describePrincipal(
  approvedBy: string | null | undefined,
  viewerId: string,
): string {
  if (!approvedBy) return '-';
  const principal = parsePrincipal(approvedBy);
  if (!principal) return approvedBy;

  switch (principal.kind) {
    case 'auto':
      return 'automatically, after the notice window';
    case 'founder':
    case 'voice':
      return principal.id === viewerId
        ? (principal.kind === 'voice' ? 'you, by voice' : 'you')
        : 'another owner';
    case 'autopilot':
      return `autopilot for ${(principal.id ?? '').replace(/_/g, ' ')}, under a permission you gave`;
    case 'institution':
      return 'Foundry, under a permission you gave';
    case 'system':
      return `an internal mechanism (${(principal.id ?? '').replace(/_/g, ' ')})`;
  }
}
