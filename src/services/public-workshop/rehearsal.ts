// =============================================================================
// FOUNDRY — Experiment 002: the Workshop's publishing machinery, rehearsed.
//
// Before the Workshop carries a real experiment it carries a synthetic one,
// end to end, in the reference world where the institution proves itself:
// a public identity assigned, the page published under the Workshop's own
// address and read back over HTTPS, the page changed and read back again, the
// test concluded, its record marked Closed, and the address still answering.
// Nobody is written to, nothing is sold, and the page says it is a rehearsal.
//
// It is unlisted: the machinery is what is rehearsed, not the market, so the
// public registry does not present it beside real tests. Its address stays,
// as every address does.
// =============================================================================
import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { designExperiment, decideExperiment, recordResult } from '../venture/validation.js';
import { givePublicIdentity, publicIdentityOf, recordPublicOutcome, updatePublicCopy } from './identity.js';
import { experimentPublication, pageUrlFor, publishSite, verifyPublication } from './publication.js';
import { projectExperiment } from './projection.js';
import { publicWorkshopOf, WorkshopRefused } from './settings.js';

const KEEPER = 'institution:workshop_keeper';
export const REHEARSAL_SLUG = 'workshop-rehearsal';

type Row = Record<string, unknown>;
const rows = async (sql: string, params: unknown[]): Promise<Row[]> => (await query(sql, params)).rows as unknown as Row[];

export interface RehearsalReport {
  experimentId: string; number: number; url: string;
  steps: Array<{ step: string; ok: boolean; evidence: string }>;
  ok: boolean;
}

/** A reference opportunity to hang the rehearsal under: from any reference
 * search of this owner, open or closed; a closed search's candidates are still
 * rows. The owner's real search is never touched. */
async function referenceOpportunity(founderId: string): Promise<{ opportunityId: string; unknownId: string } | null> {
  const o = (await rows(
    `SELECT o.id FROM venture_opportunities o WHERE o.founder_id = ? AND o.evidence_mode = 'reference' ORDER BY o.rowid LIMIT 1`, [founderId]))[0];
  if (!o) return null;
  const unknownId = nanoid();
  await query(`INSERT INTO market_unknowns (id, founder_id, opportunity_id, question, blocking, cheapest_test) VALUES (?,?,?,?,0,?)`,
    [unknownId, founderId, String(o.id), 'Can the Workshop publish, verify, change and close a public experiment record without the owner touching the infrastructure?', 'publish a synthetic experiment page and read it back']);
  return { opportunityId: String(o.id), unknownId };
}

export async function findRehearsal(founderId: string): Promise<string | null> {
  const r = (await rows('SELECT experiment_id FROM public_experiments WHERE founder_id = ? AND slug = ?', [founderId, REHEARSAL_SLUG]))[0];
  return r ? String(r.experiment_id) : null;
}

export async function rehearseWorkshop(founderId: string, fetchImpl?: typeof fetch): Promise<RehearsalReport> {
  const w = await publicWorkshopOf(founderId);
  if (!w) throw new WorkshopRefused('no_workshop');
  const steps: RehearsalReport['steps'] = [];
  const note = (step: string, ok: boolean, evidence: string) => { steps.push({ step, ok, evidence }); };

  // 1. A synthetic experiment in the reference world, decided by the institution.
  let experimentId = await findRehearsal(founderId);
  if (!experimentId) {
    const ref = await referenceOpportunity(founderId);
    if (!ref) throw new WorkshopRefused('no_reference_world', 'no reference candidate exists to rehearse under; open a rehearsal search first');
    experimentId = await designExperiment({
      founderId, opportunityId: ref.opportunityId, unknownId: ref.unknownId, evidenceMode: 'reference', costCents: 0,
      whatWeDo: 'Publish a synthetic experiment page under the Workshop, verify it over HTTPS, change it, conclude it and mark it closed, contacting nobody and selling nothing',
      whatWeExpect: 'Every step succeeds without the owner touching Cloudflare, DNS, a Worker, a Pages project or hosting configuration',
      wouldDisprove: 'Any step needs a manual act at the provider, or the public address does not carry what was published',
    });
    await query('UPDATE venture_experiments SET needs_workshop = 0 WHERE id = ?', [experimentId]);
    await decideExperiment({ experimentId, decision: 'approved', by: KEEPER, via: 'its own authorisation' });
  }
  const identity = await givePublicIdentity({
    experimentId, founderId, slug: REHEARSAL_SLUG, listed: false,
    copy: {
      title: 'Workshop rehearsal',
      summary: 'A rehearsal of this workshop\'s publishing machinery. Nothing was offered or sold, and nobody was contacted.',
      who: 'Nobody. This page exists to prove that an experiment record can be published, verified, updated and closed without anyone administering the infrastructure by hand.',
      what: 'Nothing is for sale here.',
      limits: 'This is not an experiment in the market sense. It makes no claim about any product or service.',
      sources: 'None. The page is generated from the workshop\'s own records.',
      selection: 'No one received an email about this page.',
      note: 'I keep this page because the record of how the workshop works is part of the workshop. If you landed here from somewhere else, the real experiments are listed on the experiments page.',
    },
  });
  note('identity', true, `Experiment ${String(identity.number).padStart(3, '0')} · /experiments/${identity.slug}${identity.created ? ' (assigned)' : ' (already assigned)'}`);
  const url = (await pageUrlFor(experimentId))!;
  const already = (await rows('SELECT ran_at FROM venture_experiments WHERE id = ?', [experimentId]))[0];
  if (already?.ran_at != null) {
    // Rehearsed before: what stands is verified, nothing is redone.
    await publishSite(founderId, KEEPER, fetchImpl);
    const pub = await experimentPublication(experimentId);
    const shown = await projectExperiment(experimentId);
    note('publish', pub?.verifiedStatus === 'verified', pub ? `${url} v${pub.version} ${pub.verifiedStatus}` : 'no publication');
    note('closed', shown?.status === 'closed', shown?.statusLine ?? 'no projection');
    const kept = await verifyPublication(founderId, `/experiments/${REHEARSAL_SLUG}`, fetchImpl);
    note('preserved', kept?.verifiedStatus === 'verified', kept?.verifiedDetail ?? 'no publication');
    return { experimentId, number: identity.number, url, steps, ok: steps.every((s) => s.ok) };
  }

  // 2. Published, and read back.
  const first = await publishSite(founderId, KEEPER, fetchImpl);
  let pub = await experimentPublication(experimentId);
  note('publish', !!pub && pub.verifiedStatus === 'verified' && first.failed.length === 0, pub ? `${url} v${pub.version} ${pub.verifiedStatus}: ${pub.verifiedDetail ?? ''}` : `not published: ${first.failed.map((f) => f.reason).join('; ')}`);

  // 3. Changed, and read back as changed.
  const before = pub?.digest ?? '';
  await updatePublicCopy(experimentId, { summary: `A rehearsal of this workshop's publishing machinery, updated ${new Date().toISOString().slice(0, 10)}. Nothing was offered or sold, and nobody was contacted.` });
  await publishSite(founderId, KEEPER, fetchImpl);
  pub = await experimentPublication(experimentId);
  note('update', !!pub && pub.verifiedStatus === 'verified' && pub.digest !== before, pub ? `v${pub.version} digest ${pub.digest.slice(0, 12)} (was ${before.slice(0, 12)}) ${pub.verifiedStatus}` : 'no publication');

  // 4. Shown inside the institution as the owner would see it.
  const projected = await projectExperiment(experimentId);
  note('displayed', !!projected && projected.status === 'testing', projected ? `status ${projected.statusLabel}, listed ${projected.listed}` : 'no projection');

  // 5. Concluded, closed, preserved.
  const e = (await rows('SELECT ran_at FROM venture_experiments WHERE id = ?', [experimentId]))[0];
  if (e?.ran_at == null) {
    await recordResult({ experimentId, whatHappened: `Published at ${url}, verified over HTTPS, updated and verified again, without any manual act at the provider.`, asPredicted: true });
  }
  const ident = await publicIdentityOf(experimentId);
  if (!ident?.outcome) await recordPublicOutcome(experimentId, 'Closed — a rehearsal of the workshop\'s publishing machinery. Nothing was offered or sold.');
  await publishSite(founderId, KEEPER, fetchImpl);
  pub = await experimentPublication(experimentId);
  const after = await projectExperiment(experimentId);
  note('closed', !!after && after.status === 'closed' && pub?.verifiedStatus === 'verified', after ? `${after.statusLine} · page v${pub?.version ?? '?'} ${pub?.verifiedStatus ?? 'unverified'}` : 'no projection');
  const preserved = await verifyPublication(founderId, `/experiments/${REHEARSAL_SLUG}`, fetchImpl);
  note('preserved', preserved?.verifiedStatus === 'verified', preserved ? `${url} still answers: ${preserved.verifiedDetail ?? ''}` : 'no publication');
  return { experimentId, number: identity.number, url, steps, ok: steps.every((s) => s.ok) };
}
