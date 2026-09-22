// =============================================================================
// FOUNDRY — where a connection actually is, in the owner's terms
//
// THE FAILURE THIS ANSWERS. 22 September 2026, the owner: "I entered my Etsy
// application keystring and shared secret into Foundry's owner interface and
// submitted the form. The form appeared to reset without a clear indication
// that anything had been saved."
//
// He was looking at the SUCCESS path. `POST /settings/app-credential/etsy`
// verifies the pair with Etsy, stores it, and redirects with
// `?etsy=placed&app=…` — and nothing read that parameter. The only thing that
// changed on screen was a 0.82rem line in `--text-dim` and a button label. Four
// paragraphs of explanation sat around it.
//
// So the defect is not that the state was wrong. The state was right and
// invisible, which from the owner's chair is worse than wrong: a wrong state
// can be argued with, and an invisible one leaves him to guess whether to
// submit his secrets again.
//
// WHY A READER RATHER THAN A FIX TO ONE CARD. The directive names six states
// and insists they stay apart:
//
//   Application credentials saved.
//   Credentials verified with Etsy — if and only if that validation succeeded.
//   Shop authorization pending.
//   Shop connected — once actual OAuth authorization has completed.
//   Shop identity verified — once the real account has been read back.
//   External operating capability qualified — only when the capability has
//     actually been exercised and satisfies its qualification requirements.
//
// "A successful form submission must not be mistaken for a qualified external
// connection." Every one of those six is already a row somewhere. What did not
// exist is one place that reads them all and says which is true, so each
// surface invented its own partial answer — the settings card knew about the
// key, the company page knew about the sense, and neither knew about the other.
//
// NOTHING HERE IS STORED. Every field is derived on read from the canonical
// rows: `app_credentials`, `company_senses`, `capability_providers`. A
// `connection_status` column is exactly the defect this repository already has
// a chained gate for — `check-integration-status-vocabulary.mjs` exists because
// the literal 'connected' was written into `integrations.status` twice, where
// readers only honour 'active'.
//
// AND NO SECRET IS REACHABLE FROM HERE. The application key's two halves are
// never read; only the fact that a row exists, the application id Etsy returned,
// and the date it answered.
// =============================================================================

import { query } from '../../db/client.js';

/**
 * The six states, in the order they are reached. A connection is at exactly
 * one, and everything before it is also true.
 */
export type ConnectionStage =
  | 'no_key'
  | 'key_verified'
  | 'authorization_pending'
  | 'connected'
  | 'identity_verified'
  | 'qualified';

export interface ConnectionStep {
  stage: ConnectionStage;
  /** What the owner is told this step means, in his words rather than the schema's. */
  title: string;
  /** True when this step has actually been reached. */
  done: boolean;
  /** The evidence, when there is any — a date, an id, the provider's own answer. */
  evidence: string | null;
}

export interface ConnectionJourney {
  provider: string;
  stage: ConnectionStage;
  steps: ConnectionStep[];
  /**
   * The one thing to do next, or null when the journey is complete. Never a
   * technical instruction: the owner's directive is that the next legitimate
   * action be immediately discoverable, which means a sentence and a link.
   */
  next: { say: string; href: string | null } | null;
  /**
   * WHAT THIS STILL DOES NOT PERMIT, carried at every stage including the last.
   * Reaching `qualified` proves a reading works. It grants nothing, and a panel
   * that stopped saying so at the point everything went green would be teaching
   * exactly the collapse the institution refuses everywhere else.
   */
  grantsNothing: string;
}

/** A shop name is the provider's answer; an id alone is still an answer. */
const named = (label: string | null, ref: string | null): string | null =>
  label ?? ref ?? null;

/**
 * Where the Etsy connection for one company actually is.
 *
 * Read in stage order so each answer is built only from rows, and so a later
 * stage can never be reported without the earlier ones being true — which is
 * the property the directive's "these are separate states" sentence needs in
 * order to be checkable rather than aspirational.
 */
export async function etsyJourney(productId: string): Promise<ConnectionJourney> {
  const grantsNothing = 'Reading is all of it. Publishing a listing, changing a price, '
    + 'messaging a customer and moving money each need their own permission, and none '
    + 'of them is granted by any step here.';

  const { appCredentialFor } = await import('./app-credential.js');
  const key = await appCredentialFor('etsy');

  const sense = (await query(
    `SELECT id, connected_at, provider_account_ref, provider_account_label,
            identity_verified_at, last_observed_at, last_error
       FROM company_senses
      WHERE product_id = ? AND provider = 'etsy' AND disconnected_at IS NULL
      LIMIT 1`, [productId])).rows[0] as Record<string, unknown> | undefined;

  const capability = (await query(
    `SELECT p.maturity FROM capability_providers p
       JOIN capabilities c ON c.capability_key = p.capability_key
      WHERE p.provider = 'etsy' AND c.rung = 'observe'
      ORDER BY p.rowid LIMIT 1`)).rows[0] as Record<string, unknown> | undefined;

  const shop = sense ? named(
    sense.provider_account_label == null ? null : String(sense.provider_account_label),
    sense.provider_account_ref == null ? null : String(sense.provider_account_ref)) : null;

  // QUALIFIED MEANS EXERCISED, and the ladder is the only thing that can say so.
  // `reality_proven` is written by `witnessAReading` on an actual read of the
  // real account, and its trigger refuses that rung for any evidence that is
  // not real. Nothing else in this function could establish it.
  const proven = capability != null
    && ['reality_proven', 'reliable'].includes(String(capability.maturity));

  const steps: ConnectionStep[] = [
    {
      stage: 'key_verified',
      title: 'Application key saved, and checked with Etsy',
      done: key != null,
      // The application id Etsy itself returned. Not either half of the pair,
      // which is never read here and never rendered anywhere.
      evidence: key
        ? `Etsy confirmed it as application ${key.providerAccountRef} on ${key.verifiedAt.slice(0, 10)}`
        : null,
    },
    {
      stage: 'connected',
      title: 'Shop connected',
      done: sense != null,
      evidence: sense ? `You authorised it on ${String(sense.connected_at).slice(0, 10)}` : null,
    },
    {
      stage: 'identity_verified',
      title: 'Shop identity read back',
      done: sense?.identity_verified_at != null,
      evidence: sense?.identity_verified_at != null
        ? `Etsy says this opens ${shop ?? 'an account with no shop'}`
        : null,
    },
    {
      stage: 'qualified',
      title: 'Reading your shop has actually been done',
      done: proven,
      evidence: proven
        ? 'A real read of the real account succeeded, and the capability moved on that evidence'
        : sense?.last_observed_at != null
          ? 'Something has been read, and the capability has not moved on it yet'
          : null,
    },
  ];

  // The furthest step actually reached, never the furthest attempted.
  const stage: ConnectionStage = proven ? 'qualified'
    : sense?.identity_verified_at != null ? 'identity_verified'
      : sense != null ? 'connected'
        : key != null ? 'authorization_pending'
          : 'no_key';

  const next = ((): ConnectionJourney['next'] => {
    if (stage === 'no_key') {
      return {
        say: 'Put in the application key Etsy gave you. I check it with Etsy before keeping it.',
        href: `/foundry/companies/${productId}/see/revenue`,
      };
    }
    if (stage === 'authorization_pending') {
      return {
        say: 'Connect the shop. Etsy will ask you to consent, and the permissions it asks for are read-only.',
        href: `/foundry/companies/${productId}/see/revenue`,
      };
    }
    if (stage === 'connected') {
      // Authorised and never exercised — the state the directive says must not
      // be presented as operational. There is nothing for him to do about it,
      // and saying that plainly is better than inventing a button.
      return {
        say: sense?.last_error != null
          ? `The last thing I tried did not work: ${String(sense.last_error)}. Nothing here needs you yet.`
          : 'Nothing needs you. I will read the shop on the next pass and tell you what I found.',
        href: null,
      };
    }
    if (stage === 'identity_verified') {
      return {
        say: `I know this opens ${shop ?? 'the account'}, and I have not read anything through it yet.`,
        href: null,
      };
    }
    return null;
  })();

  return { provider: 'etsy', stage, steps, next, grantsNothing };
}
