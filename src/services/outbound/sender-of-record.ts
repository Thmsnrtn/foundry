// =============================================================================
// FOUNDRY — Sender-of-Record guard (LIABILITY-AUDIT.md, clean-hands)
//
// Foundry must never be the From on a message to a THIRD PARTY (a founder's
// customer). Those sends go out under the FOUNDER's own connected sender —
// their domain, their opt-out footer, their CAN-SPAM/CASL responsibility.
// Foundry's own domain is only ever the From on mail to the FOUNDER themselves
// (transactional: welcome, digests, alerts). This keeps Foundry's domain
// reputation and anti-spam liability off a founder's list quality.
//
// The rule is structural: assertSenderOfRecord throws for any third-party send
// that would use a Foundry-owned From. Department third-party paths must call
// it before dispatch. (Departments currently draft-only; this lights the rule
// up BEFORE the live path exists, so it can never regress open.)
// =============================================================================

const FOUNDRY_SENDER_DOMAINS = ['foundry.app', 'foundry.dev'];

export class SenderOfRecordError extends Error {
  readonly code = 'SENDER_OF_RECORD';
  /** Decided before the provider was contacted. The gateway reads this to
   * report `refused` rather than `execution`, so a caller does not schedule
   * reconciliation for a message that never left the building. */
  readonly notAttempted = true;
  constructor(message: string) {
    super(message);
    this.name = 'SenderOfRecordError';
  }
}

function domainOf(addr: string): string {
  const m = /@([^>\s]+)/.exec(addr);
  return (m?.[1] ?? '').toLowerCase().trim();
}

export function isFoundryDomain(fromAddress: string): boolean {
  const d = domainOf(fromAddress);
  return FOUNDRY_SENDER_DOMAINS.some((fd) => d === fd || d.endsWith(`.${fd}`));
}

/** Throw unless `from` is an acceptable sender for a message to `toRecipient`.
 *  recipientIsFounder=true  → Foundry-domain From is fine (transactional).
 *  recipientIsFounder=false → the From must be the founder's OWN connected
 *  sender; a Foundry-domain From is refused. */
export function assertSenderOfRecord(opts: {
  from: string;
  recipientIsFounder: boolean;
}): void {
  if (opts.recipientIsFounder) return; // Foundry emailing its own customer — fine
  if (isFoundryDomain(opts.from)) {
    throw new SenderOfRecordError(
      'Refusing to send to a third party under a Foundry domain. Third-party mail must go out under your own connected sender — see docs/design/LIABILITY-AUDIT.md.',
    );
  }
}
