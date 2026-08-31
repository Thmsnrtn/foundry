process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { registerToolHandler } from '../../src/services/outbound/gateway.js';
import { SEND_EMAIL_POLICY } from '../../src/services/integration/resend.js';
import {
  reportCompanyObligation, reportExternalObligation,
} from '../../src/services/founder/company-report.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import { earnResponsibilityUnderstanding } from '../../src/services/institution/responsibility-understanding.js';
import {
  beginExternalMetricShadowing, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import {
  recordCompanyObservations, registerObservationChannel,
} from '../../src/services/institution/company-observation.js';
import { grantAssistingAuthority } from '../../src/services/institution/assisting-admission.js';
import {
  registerSupportChannel, ingestCustomerMessage,
} from '../../src/services/institution/customer-message-intake.js';
import { proposeSupportReply, planProposedReply } from '../../src/services/institution/support-reply.js';
import {
  planResponsibilityNotice, proposeResponsibilityNotice,
} from '../../src/services/institution/responsibility-notice.js';
import {
  executeAssistedSupportEmail, reconcileAssistedSupportEmail,
} from '../../src/services/institution/responsibility-assisted-email.js';
import { getUnresolvedEffects, reportEffectOutcome } from '../../src/services/institution/effect-outcome.js';

// =============================================================================
// The second and third unfamiliar companies through a governed effect.
//
// A dance school already crossed the whole thing. Running two more identical
// verticals would prove nothing, so each of these takes a DIFFERENT branch of
// the same machinery, and between them they reach the two places the dance
// school did not:
//
//   Barrowfield Groundworks  recognised by the company's OWN SYSTEM, not a
//                            person → customer_support → support-reply effect
//                            kind → outcome reported ACHIEVED
//   Whitlow Heating          recognised by the owner → operations → notice
//                            effect kind → outcome reported FAILED
//
// The dance school's effect ended at `unresolved`, which was honest and is not
// a destination. Both of these leave it — one upward and one downward — because
// someone outside said what happened. A loop that can only be closed by good
// news is not a loop.
//
// The generalization claim is unchanged and is what is actually on trial: if
// carrying a groundworks contractor or a heating firm forces a kernel change,
// that is a defect in the generalization, not a feature request from the
// company. Nothing below adds a capability, an obligation kind, an effect kind,
// a metric column, or a branch that knows what a boiler is.
// =============================================================================

const OWNER = 'ucg_owner';
const GROUND = 'ucg_ground';
const HEAT = 'ucg_heat';

let dispatched = 0;

beforeAll(async () => {
  await runMigrations();
  await query(
    `INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','ucg_clerk','o@example.com')`, []);
  await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?),(?,?,?)',
    [GROUND, 'Barrowfield Groundworks', OWNER, HEAT, 'Whitlow Heating', OWNER]);
  // A provider that accepts what it is given. Acceptance is all this stands
  // for — every test below still treats the business outcome as unknown until
  // somebody outside says otherwise.
  registerToolHandler('send_email', async (req) => {
    dispatched += 1;
    return { message_id: `provider-${req.dedupKey}` };
  }, SEND_EMAIL_POLICY);
});

/** The signal that made a responsibility visible, for grounding its facts. */
async function discoveryEvidence(responsibilityId: string): Promise<string> {
  const row = (await query(
    'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?',
    [responsibilityId])).rows[0] as Record<string, unknown>;
  return String(row.d).replace('signal_event:', '');
}

/** The ordinary understanding path: the owner's own account of the business,
 * recorded as canonically grounded claims. */
async function establishFacts(
  productId: string, responsibilityId: string, facts: Record<string, string>,
): Promise<void> {
  const signalId = await discoveryEvidence(responsibilityId);
  for (const [predicate, value] of Object.entries(facts)) {
    await recordReconstructionClaim({
      productId, subject: `responsibility:${responsibilityId}`, predicate, value,
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
      derivationMethod: 'the owner described how the business works', observedAt: new Date(),
    });
  }
}

/** Watch a quantity the company itself counts, and resolve one expectation
 * against a later reading. Nothing here knows what the quantity means. */
async function watchAndResolve(input: {
  productId: string; responsibilityId: string; channelKey: string; label: string; unit: string;
  readings: number[]; direction: 'rose' | 'fell'; later: number;
}): Promise<string> {
  await registerObservationChannel({
    productId: input.productId, founderId: OWNER, channelKey: input.channelKey,
    label: input.label, unit: input.unit,
  });
  for (const observedValue of input.readings) {
    await recordCompanyObservations({
      productId: input.productId, origin: 'company_system',
      readings: [{ channelKey: input.channelKey, observedValue }],
    });
  }
  const shadowing = await beginExternalMetricShadowing({
    productId: input.productId, responsibilityId: input.responsibilityId, founderId: OWNER,
    field: input.channelKey, direction: input.direction,
  });
  expect(shadowing, 'shadowing must be entered through the ordinary path').not.toBeNull();
  expect(shadowing).toMatchObject({ state: 'shadowing', authorityRef: null });

  const expectationId = String(((await query(
    'SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=? ORDER BY rowid DESC LIMIT 1',
    [input.responsibilityId])).rows[0] as Record<string, unknown>).id);
  await query(
    "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
    [expectationId]);
  await recordCompanyObservations({
    productId: input.productId, origin: 'company_system',
    readings: [{ channelKey: input.channelKey, observedValue: input.later }],
  });
  const resolved = await resolveExternalMetricShadowing(input.productId, expectationId);
  expect(resolved.classification).toBe('matched');
  return expectationId;
}

async function actionRow(actionId: string): Promise<Record<string, unknown>> {
  return (await query(
    `SELECT status,effect_certainty,outcome_status,authority_scope,effect_id,parameters_json
       FROM outbound_actions WHERE id=?`, [actionId])).rows[0] as Record<string, unknown>;
}

// =============================================================================

describe('Barrowfield Groundworks — raised by the company\'s own system, answered as support', () => {
  let responsibilityId: string;
  let actionId: string;
  let effectId: string;
  let contactEmail: string;

  it('is recognised because a system noticed, with nobody claiming a person said it', async () => {
    // The first rung fed by the company rather than by the founder. The dance
    // school was told about by its owner; this one was noticed by the tool that
    // tracks outstanding quotes, which is how most work in most companies
    // actually surfaces.
    const reported = await reportExternalObligation({
      productId: GROUND, reportedBy: 'quote_tracker', obligationKind: 'customer_commitment',
      what: 'Every client waiting on a quote hears back within five working days',
    });
    responsibilityId = reported!.responsibility!.id;
    expect(reported!.responsibility).toMatchObject({ state: 'visible', capability: 'customer_support' });
    expect(reported!.responsibility!.authorityRef).toBeNull();

    // Provenance is preserved rather than flattened. A quote tracker noticing
    // something is not the owner saying it, and the record says which — the
    // payload carries the reporter and cannot carry a founder.
    const signal = (await query(
      'SELECT source,payload_json FROM signal_events WHERE id=?',
      [reported!.signalId])).rows[0] as Record<string, unknown>;
    expect(signal.source).toBe('external_company_report');
    const payload = JSON.parse(String(signal.payload_json)) as Record<string, unknown>;
    expect(payload.reported_by).toBe('quote_tracker');
    expect(payload).not.toHaveProperty('founder_id');
  });

  it('is understood, and then watched against what the office counts', async () => {
    await establishFacts(GROUND, responsibilityId, {
      purpose: 'A client who has not heard back has already started ringing someone else',
      desired_outcome: 'No quote request sits past the week it came in',
      success_conditions: 'Every request logged had a priced answer sent back',
      operating_constraints: 'One estimator, and site visits only on dry days',
      dependencies: 'The estimator getting on site, and the supplier price list',
      risks: 'A late quote is usually a lost job and a lost repeat client',
    });
    expect(await earnResponsibilityUnderstanding(GROUND, responsibilityId))
      .toMatchObject({ state: 'understood', authorityRef: null });

    await watchAndResolve({
      productId: GROUND, responsibilityId,
      channelKey: 'quotes_returned_in_five_days', label: 'Quotes returned within five working days',
      unit: 'quotes', readings: [12, 15], direction: 'rose', later: 20,
    });
  });

  it('is helped only after an exact grant, and only on its own channel', async () => {
    const granted = await grantAssistingAuthority({
      productId: GROUND, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    expect(granted!.admitted).toBe(true);
    const consent = (await query(
      'SELECT capability,allowed_scope_json,consequence_boundary FROM autonomy_consents WHERE id=?',
      [granted!.consentId])).rows[0] as Record<string, unknown>;
    expect(consent).toMatchObject({ capability: 'customer_support', consequence_boundary: 'low' });
    expect(JSON.parse(String(consent.allowed_scope_json))).toEqual(['send_email:support_reply']);

    // Attribution is structural: the message belongs to this responsibility
    // because it arrived on this responsibility's channel, not because anything
    // read what it says.
    const channel = await registerSupportChannel({
      productId: GROUND, responsibilityId, founderId: OWNER, label: 'quotes@ inbox',
    });
    const arrived = await ingestCustomerMessage({
      intakeKey: channel!.intakeKey, externalMessageId: 'mail-8841',
      contactEmail: 'jo@fieldstone.example', subject: 'Drive and drainage quote',
      body: 'We sent the drawings over a week ago — where are we with the price?',
    });
    expect('message' in arrived).toBe(true);
    const message = (arrived as { message: { id: string; contactEmail: string } }).message;
    contactEmail = message.contactEmail;
    expect(message.contactEmail).toBe('jo@fieldstone.example');

    // The owner writes the reply. There is no model on this path and none
    // implied by one, and the recipient is not a parameter anyone can choose —
    // it is the person who wrote in.
    const proposed = await proposeSupportReply({
      productId: GROUND, founderId: OWNER, messageId: message.id,
      body: 'Sorry for the wait — Dave is on site Thursday and the price will follow that afternoon.',
    });
    const planned = await planProposedReply({
      productId: GROUND, founderId: OWNER,
      proposalId: (proposed as { proposal: { id: string } }).proposal.id,
    });
    expect('actionId' in planned).toBe(true);
    actionId = (planned as { actionId: string }).actionId;
  });

  it('crosses the governed boundary and stops at a receipt', async () => {
    const before = dispatched;
    expect(await executeAssistedSupportEmail(actionId))
      .toEqual({ dispatched: true, certainty: 'provider_acknowledged' });
    expect(dispatched).toBe(before + 1);

    const row = await actionRow(actionId);
    expect(row).toMatchObject({
      status: 'executed', effect_certainty: 'provider_acknowledged',
      authority_scope: 'send_email:support_reply', outcome_status: 'unresolved',
    });
    effectId = String(row.effect_id);

    // It went to the person who wrote in, carrying the owner's words unaltered.
    const parameters = JSON.parse(String(row.parameters_json)) as { to: string[]; html: string };
    expect(parameters.to).toEqual([contactEmail]);
    expect(parameters.html).toContain('Dave is on site Thursday');

    // A provider accepting an email is not a priced quote landing in Jo's inbox.
    expect((await getUnresolvedEffects(GROUND)).map((e) => e.effectId)).toEqual([effectId]);
  });

  it('leaves unresolved because the client said what happened', async () => {
    const reported = await reportEffectOutcome({
      productId: GROUND, effectId, verdict: 'achieved',
      reporter: `customer:${contactEmail}`, detail: 'Price came through Thursday and we have accepted it',
    });
    expect(reported).toMatchObject({ verdict: 'achieved' });

    expect(await reconcileAssistedSupportEmail(GROUND, actionId)).toBe('verified_success');
    expect(await actionRow(actionId)).toMatchObject({ outcome_status: 'verified_success' });
    expect(await getUnresolvedEffects(GROUND)).toEqual([]);

    // Learning that it worked grants nothing and promotes nothing. This is the
    // rung where a system that rewarded itself for success would show it.
    expect((await query(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [GROUND])).rows[0])
      .toMatchObject({ n: 1 });
    expect((await query(
      'SELECT state FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'assisting' });
  });
});

// =============================================================================

describe('Whitlow Heating — the owner\'s own notice, and the answer nobody wants', () => {
  let responsibilityId: string;
  let actionId: string;
  let effectId: string;
  const BODY = 'Mrs Ardley at 14 Selby Road is out of certificate on the 3rd — can you fit her in Tuesday?';

  it('is recognised, understood, and watched on a count the owner wants to fall', async () => {
    const reported = await reportCompanyObligation({
      productId: HEAT, founderId: OWNER, obligationKind: 'maintenance',
      what: 'Every service contract gets its safety check before the certificate runs out',
    });
    responsibilityId = reported!.responsibility!.id;
    expect(reported!.responsibility).toMatchObject({ state: 'visible', capability: 'operations' });

    await establishFacts(HEAT, responsibilityId, {
      purpose: 'A lapsed certificate is a landlord in breach and a tenant at risk',
      desired_outcome: 'Nobody on a contract goes past their expiry date',
      success_conditions: 'Every certificate due that month was renewed before it lapsed',
      operating_constraints: 'Two engineers, and nothing gets done in the week before Christmas',
      dependencies: 'Getting access to the property, and the parts van being stocked',
      risks: 'A lapse is a safety matter first and a fine second',
      systems: 'The service diary and the certificate folder',
      current_carrier: 'The office manager works down the expiry list each Monday',
      failure_modes: 'Nobody answers the door and the job quietly falls off the list',
    });
    expect(await earnResponsibilityUnderstanding(HEAT, responsibilityId))
      .toMatchObject({ state: 'understood', authorityRef: null });

    // A quantity whose good direction is DOWN. The dance school's rose; nothing
    // in the kernel prefers one, and this is where that stops being an
    // assertion about the code and becomes an exercise of it.
    await watchAndResolve({
      productId: HEAT, responsibilityId,
      channelKey: 'certificates_expired_unchecked', label: 'Certificates that lapsed before a check',
      unit: 'properties', readings: [9, 6], direction: 'fell', later: 3,
    });
  });

  it('sends the owner\'s words to the person the owner named', async () => {
    const granted = await grantAssistingAuthority({
      productId: HEAT, responsibilityId, founderId: OWNER, durationDays: 30,
    });
    expect(granted!.admitted).toBe(true);
    expect(JSON.parse(String(((await query(
      'SELECT allowed_scope_json s FROM autonomy_consents WHERE id=?', [granted!.consentId],
    )).rows[0] as Record<string, unknown>).s))).toEqual(['send_email:responsibility_notice']);

    const written = await proposeResponsibilityNotice({
      productId: HEAT, founderId: OWNER, responsibilityId,
      recipient: 'ryan@whitlow.example', subject: '14 Selby Road — certificate due the 3rd',
      body: BODY,
    });
    const planned = await planResponsibilityNotice({
      productId: HEAT, founderId: OWNER,
      noticeId: (written as { notice: { id: string } }).notice.id,
    });
    actionId = (planned as { actionId: string }).actionId;

    expect(await executeAssistedSupportEmail(actionId))
      .toEqual({ dispatched: true, certainty: 'provider_acknowledged' });

    const row = await actionRow(actionId);
    expect(row).toMatchObject({
      status: 'executed', authority_scope: 'send_email:responsibility_notice',
      outcome_status: 'unresolved',
    });
    effectId = String(row.effect_id);

    // Verbatim. Foundry composed none of this and is not permitted to — a
    // notice it wrote would be a claim about the company, made in the
    // company's name, to somebody who would believe it.
    const parameters = JSON.parse(String(row.parameters_json)) as { to: string[]; html: string };
    expect(parameters).toMatchObject({ to: ['ryan@whitlow.example'], html: BODY });
  });

  it('records that it did not work, because the householder said so', async () => {
    // The direction that matters. A loop that can only be closed by good news
    // is a reporting feature, not an outcome layer.
    expect(await reportEffectOutcome({
      productId: HEAT, effectId, verdict: 'failed', reporter: 'customer:ardley@selby.example',
      detail: 'Nobody came on the Tuesday and the certificate lapsed',
    })).toMatchObject({ verdict: 'failed' });

    expect(await reconcileAssistedSupportEmail(HEAT, actionId)).toBe('verified_failure');
    expect(await actionRow(actionId)).toMatchObject({ outcome_status: 'verified_failure' });

    // Failure is learned, not punished. Nothing is demoted, nothing is revoked,
    // and the owner remains the only person who can withdraw permission.
    expect((await query(
      'SELECT state,disposition FROM institutional_responsibilities WHERE id=?', [responsibilityId])).rows[0])
      .toMatchObject({ state: 'assisting', disposition: 'active' });
    expect((await query(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=? AND revoked_at IS NULL', [HEAT])).rows[0])
      .toMatchObject({ n: 1 });

    // And it is learned as a grounded claim rather than a status flag, so the
    // reason survives longer than the row.
    const learned = (await query(
      `SELECT value_json,epistemic_status FROM reconstruction_claims
        WHERE product_id=? AND predicate=?`, [HEAT, `assisted_outcome:${effectId}`],
    )).rows[0] as Record<string, unknown>;
    expect(String(learned.value_json)).toContain('verified_failure');
    expect(learned.epistemic_status).toBe('known');
  });

  it('will not let Foundry answer for itself, in either direction', async () => {
    for (const verdict of ['achieved', 'failed']) {
      expect(await reportEffectOutcome({
        productId: HEAT, effectId, verdict, reporter: 'institution:assisting',
      })).toEqual({ refused: 'reporter_invalid' });
    }
    // Nothing was recorded, so the verdict the householder gave still stands.
    expect(await reconcileAssistedSupportEmail(HEAT, actionId)).toBe('verified_failure');
  });
});

// =============================================================================

describe('what the two of them cost the kernel', () => {
  it('neither company reached Operating, and neither asked to', async () => {
    expect((await query(
      `SELECT COUNT(*) n FROM institutional_responsibilities
        WHERE product_id IN (?,?) AND state='operating'`, [GROUND, HEAT])).rows[0])
      .toMatchObject({ n: 0 });
  });

  it('used only effect kinds that already existed, one each', async () => {
    // The constitutional line, exercised rather than asserted: two more
    // companies crossed the outside world and the declared set of ways to
    // reach it did not move.
    const kinds = (await query(
      'SELECT scope_key FROM governed_effect_kinds ORDER BY scope_key', [])).rows
      .map((r) => String((r as Record<string, unknown>).scope_key));
    expect(kinds).toEqual(['send_email:responsibility_notice', 'send_email:support_reply']);

    // And between them they used both, so this vertical exercises the branch
    // the dance school did not rather than repeating the one it did.
    const used = (await query(
      `SELECT DISTINCT authority_scope FROM outbound_actions
        WHERE product_id IN (?,?) AND status='executed' ORDER BY authority_scope`,
      [GROUND, HEAT])).rows.map((r) => String((r as Record<string, unknown>).authority_scope));
    expect(used).toEqual(['send_email:responsibility_notice', 'send_email:support_reply']);
  });

  it('required no kernel line that knows what either business is', () => {
    // Comments are stripped first. The kernel explains itself in prose using
    // real businesses, and explanation is not a branch. What is on trial is
    // whether any EXECUTABLE line knows what a groundworks contractor or a
    // heating firm is.
    const kernel = [
      'institution/discovery.ts', 'institution/responsibility-notice.ts',
      'institution/support-reply.ts', 'institution/responsibility-assisted-email.ts',
      'institution/effect-outcome.ts', 'institution/customer-message-intake.ts',
      'institution/assisting-admission.ts', 'institution/company-observation.ts',
      'institution/external-shadowing.ts', 'founder/company-report.ts',
    ]
      .map((f) => readFileSync(resolve(__dirname, '../../src/services', f), 'utf8'))
      .join('\n')
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
      .split('\n').map((line) => line.replace(/^\s*\/\/.*$/, '')).join('\n')
      // camelCase is split BEFORE the case fold. Folding first turns
      // `heatingHint` into `heatinghint`, where no boundary rule can see the
      // word — which a mutation demonstrated, twice.
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase();

    // A plain `\b…\b` was not enough, and a mutation found it: `heatingHint`
    // and `heating_hint` both slip past it, because `H` and `_` are word
    // characters. The boundary that matters is a lowercase-letter-or-digit
    // one, so an identifier carrying the word is caught while `preheating` and
    // an unrelated substring are not. A trailing plural is caught too.
    // `tenant` is deliberately NOT on this list: it is multi-tenancy
    // vocabulary, and failing on it would fail for architecture rather than
    // for domain knowledge.
    for (const domainWord of [
      'groundworks', 'excavation', 'digger', 'estimator', 'drainage',
      'boiler', 'heating', 'plumber', 'certificate', 'landlord', 'householder',
    ]) {
      expect(kernel, `the kernel must not know what a ${domainWord} is`)
        .not.toMatch(new RegExp(`(^|[^a-z0-9])${domainWord}s?([^a-z0-9]|$)`));
    }

    // Nor what either of them counts, nor what either of them said it owes.
    for (const owned of [
      'quotes_returned_in_five_days', 'certificates_expired_unchecked',
      'every client waiting on a quote hears back within five working days',
      'every service contract gets its safety check before the certificate runs out',
    ]) {
      expect(kernel).not.toContain(owned);
    }
  });
});
