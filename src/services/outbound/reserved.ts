// =============================================================================
// FOUNDRY — Reserved Powers (Hands Law / Constitution Law 10)
//
// Some acts NEVER delegate, at any trust level, under any grant or envelope:
// they carry the founder's accountability in a way software must not assume.
// The registry is deliberately conservative — a false refusal costs a founder
// one manual action; a false allowance could cost them the company. The
// check runs INSIDE the governed call path (after grants, before the
// gateway), so there is no route around it.
// =============================================================================

export interface ReservedCheck {
  reserved: boolean;
  why?: string;
}

const RESERVED: Array<{ re: RegExp; why: string }> = [
  {
    re: /refund|chargeback/i,
    why: 'refunds move customer money — only you can authorize them',
  },
  {
    re: /\b(set|update|change)?\s*pric(e|ing)\b/i,
    why: 'price changes are brand- and revenue-defining — only you can make them',
  },
  {
    re: /\b(delete|destroy|drop|purge|erase)\b/i,
    why: 'deleting data is irreversible — only you can do it',
  },
  {
    re: /\b(legal|contract|terms\s?of\s?service|tos)\b/i,
    why: 'anything with legal weight carries your signature, not the system\'s',
  },
];

/** Check a tool/action name (and optional human-readable action string)
 *  against the reserved-powers registry. Matching is by name — conservative
 *  by design; founders can always act manually. */
export function checkReserved(tool: string, action?: string): ReservedCheck {
  // Tool names are snake/kebab-case; '_' and '-' are \w so they defeat \b.
  const haystack = `${tool} ${action ?? ''}`.replace(/[_-]/g, ' ');
  const hit = RESERVED.find((r) => r.re.test(haystack));
  return hit ? { reserved: true, why: hit.why } : { reserved: false };
}
