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
 *
 * ON THE WORD 'connected', WHICH THIS FILE IS BASELINED FOR.
 * `check-integration-status-vocabulary` refuses that literal because it was
 * twice written into `integrations.status`, where every reader honours
 * 'active' — an integration stored that way is one no sync will ever pick up.
 * That gate is right and it should stay.
 *
 * These are a different thing entirely, and the gate's own message asks that
 * the difference be written down rather than assumed. Nothing here is a status
 * column: `ConnectionStage` is derived on every read from `app_credentials`,
 * `company_senses` and `capability_providers`, and is never stored anywhere.
 * The word is also the owner's and the directive's — "Shop connected" — and
 * renaming the institution's vocabulary to dodge a gate about another table
 * would make the product worse to read in order to make a linter quieter.
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

/**
 * EVERY CONNECTOR THE OWNER COULD HAVE, AND WHERE EACH ONE ACTUALLY IS.
 *
 * The directive's first four questions, in order: what is connected, what can
 * Foundry actually do with it, what is it using the connection for, does
 * anything need my attention. This answers the first and third; the second is
 * the four permission facts below, which are four separate rows and must not
 * collapse into one green tick.
 *
 * Composed, never reimplemented. `whatStandsBetween` is the only status reader
 * and stays the only one; `connectedSenses` is the only list of live
 * connections; the ladder is the only record of what has been proven. A second
 * answer to any of those is the defect this repository already chains a gate
 * against.
 */
export interface Connector {
  provider: string;
  name: string;
  /** What connecting it would let Foundry understand, from the offer rows. */
  wouldSee: string | null;
  stage: ConnectionStage;
  /** The account, when the provider has told us which one. */
  account: string | null;
  /**
   * FOUR FACTS THAT MUST NOT BECOME ONE.
   *
   * "Distinguish four separate facts: the provider supports an operation; the
   * connection grants the necessary technical permissions; Foundry has
   * qualified the capability to perform the operation reliably; my current
   * institutional authority permits the operation. Do not collapse these into
   * a single green Connected status."
   */
  supported: boolean;
  granted: boolean;
  qualified: boolean;
  authorised: boolean;
  /** What stands between him and asking, when anything does. */
  standsBetween: 'no_adapter' | 'no_app_key' | 'not_configured' | null;
  /** The one thing to do next, or null. */
  next: { say: string; href: string | null } | null;
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


/**
 * Every provider this institution has declared, with its real state.
 *
 * WHY THE DECLARED LIST RATHER THAN THE REGISTERED ONE. An adapter existing in
 * the import graph is a fact about the code; `sense_providers` is what the
 * institution has said it could learn from, which is the question the owner is
 * asking. A provider with rows and no adapter is a real state — "I know this
 * could tell me things and cannot ask it yet" — and hiding it would misreport
 * the institution as smaller than it is.
 */
export async function connectorsFor(productId: string): Promise<Connector[]> {
  const declared = (await query(
    `SELECT p.provider, MIN(s.would_learn) AS would_learn
       FROM sense_providers p JOIN senses s ON s.sense_key = p.sense_key
      GROUP BY p.provider ORDER BY p.provider`)).rows as unknown as Array<Record<string, unknown>>;

  const { whatStandsBetween } = await import('./credentials.js');
  const { providerName } = await import('./index.js');

  const live = (await query(
    `SELECT provider, connected_at, provider_account_ref, provider_account_label,
            identity_verified_at, last_observed_at
       FROM company_senses
      WHERE product_id = ? AND disconnected_at IS NULL`, [productId]))
    .rows as unknown as Array<Record<string, unknown>>;

  // The ladder, once, for every provider — rather than a query per row.
  const proven = new Set(((await query(
    `SELECT DISTINCT p.provider FROM capability_providers p
       JOIN capabilities c ON c.capability_key = p.capability_key
      WHERE c.rung = 'observe' AND p.maturity IN ('reality_proven','reliable')`))
    .rows as unknown as Array<Record<string, unknown>>).map((r) => String(r.provider)));

  const out: Connector[] = [];
  for (const d of declared) {
    const provider = String(d.provider);
    const sense = live.find((l) => String(l.provider) === provider);
    const standsBetween = await whatStandsBetween(provider);
    const account = sense ? named(
      sense.provider_account_label == null ? null : String(sense.provider_account_label),
      sense.provider_account_ref == null ? null : String(sense.provider_account_ref)) : null;

    const stage: ConnectionStage = proven.has(provider) && sense ? 'qualified'
      : sense?.identity_verified_at != null ? 'identity_verified'
        : sense != null ? 'connected'
          : standsBetween === null ? 'authorization_pending'
            : 'no_key';

    out.push({
      provider,
      name: providerName(provider),
      wouldSee: d.would_learn == null ? null : String(d.would_learn),
      stage,
      account,
      // The provider documents the operation: it has declared rows at all.
      supported: true,
      // The connection grants it: a live credential exists for this company.
      granted: sense != null,
      // Foundry has qualified it: the ladder says a real read was witnessed.
      qualified: proven.has(provider) && sense != null,
      // THE OWNER'S AUTHORITY. Reading is what an owner-connected basis
      // permits, and nothing here widens it. A write capability would answer
      // this from `capability_access` and `consequenceAllows`, and none of
      // the write providers can reach a door at all — their `tool` is NULL.
      authorised: sense != null,
      standsBetween,
      next: standsBetween === 'no_adapter'
        ? { say: `I know ${providerName(provider)} could tell me things, and I cannot ask it for permission yet. Nothing is missing on your side.`, href: null }
        : standsBetween === 'not_configured'
          ? { say: `${providerName(provider)} needs a setting this deployment does not have. Not yours to supply.`, href: null }
          : sense == null
            ? { say: `Connect ${providerName(provider)}.`, href: `/foundry/companies/${productId}` }
            : null,
    });
  }
  return out;
}
