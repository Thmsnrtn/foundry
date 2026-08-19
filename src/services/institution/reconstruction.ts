import { nanoid } from 'nanoid';
import { liveActGrant, query } from '../../db/client.js';

export type EpistemicStatus = 'known' | 'inferred' | 'unknown' | 'conflicting' | 'stale';
export type ReconstructionEvidenceKind =
  'product' | 'signal_event' | 'wiki_entry' | 'integration' | 'responsibility' | 'authority_consent' | 'action_execution';
export interface ReconstructionEvidenceRef { kind: ReconstructionEvidenceKind; id: string }
export interface ReconstructionClaim {
  id: string; productId: string; subject: string; predicate: string; value: unknown | null;
  epistemicStatus: EpistemicStatus; confidence: number | null; evidenceRefs: ReconstructionEvidenceRef[];
  derivationMethod: string; observedAt: string; validUntil: string | null;
}

export async function recordReconstructionClaim(input: {
  productId: string; subject: string; predicate: string; value?: unknown;
  epistemicStatus: Exclude<EpistemicStatus, 'stale'> | 'stale'; confidence?: number;
  evidenceRefs?: ReconstructionEvidenceRef[]; derivationMethod: string;
  observedAt: Date; validUntil?: Date;
}): Promise<string> {
  const id = nanoid();
  await query(`INSERT INTO reconstruction_claims
    (id,product_id,subject,predicate,value_json,epistemic_status,confidence,evidence_refs_json,derivation_method,observed_at,valid_until)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)`, [
    id,input.productId,input.subject.trim(),input.predicate.trim(),
    input.value === undefined ? null : JSON.stringify(input.value),input.epistemicStatus,input.confidence ?? null,
    JSON.stringify(input.evidenceRefs ?? []),input.derivationMethod.trim(),input.observedAt.toISOString(),
    input.validUntil?.toISOString() ?? null,
  ]);
  return id;
}

/** Read-time expiry prevents an old positive claim from silently remaining current. */
export async function getReconstructionClaims(productId: string, now: Date = new Date()): Promise<ReconstructionClaim[]> {
  // Ties are broken by insertion order, not by id. Claim id is a nanoid, so
  // ordering by it made "which claim is current" random whenever two claims
  // about the same subject were recorded in the same second — a later
  // correction could silently lose to the value it was correcting.
  const result = await query(`SELECT * FROM reconstruction_claims WHERE product_id=? ORDER BY created_at,rowid`, [productId]);
  return (result.rows as unknown as Array<Record<string, unknown>>).map((row) => ({
    id:String(row.id), productId:String(row.product_id), subject:String(row.subject), predicate:String(row.predicate),
    value:row.value_json == null ? null : JSON.parse(String(row.value_json)),
    epistemicStatus: (row.valid_until != null && new Date(String(row.valid_until)) < now
      ? 'stale' : row.epistemic_status) as EpistemicStatus,
    confidence:row.confidence == null ? null : Number(row.confidence),
    evidenceRefs:JSON.parse(String(row.evidence_refs_json)) as ReconstructionEvidenceRef[],
    derivationMethod:String(row.derivation_method), observedAt:String(row.observed_at),
    validUntil:row.valid_until == null ? null : String(row.valid_until),
  }));
}

export interface CompanyReconstruction {
  identity: { productId: string; name: string; ownerId: string; evidenceRef: ReconstructionEvidenceRef } | null;
  systems: Array<{ id: string; name: string; status: string; observedAt: string | null; epistemicStatus: 'known' | 'stale' | 'unknown' }>;
  responsibilities: Array<{ id: string; title: string; state: string; capability: string; owner: 'unknown'; activeAuthority: boolean }>;
  claims: ReconstructionClaim[];
  unknowns: string[];
}

/** Sparse projection: canonical facts are read, never copied into claims. */
export async function reconstructCompany(productId: string, now: Date = new Date()): Promise<CompanyReconstruction> {
  const product = (await query('SELECT id,name,owner_id FROM products WHERE id=?',[productId])).rows[0] as Record<string,unknown> | undefined;
  if (!product) return { identity:null,systems:[],responsibilities:[],claims:[],unknowns:['company_identity'] };
  const integrations = await query('SELECT id,COALESCE(name,provider,type) AS name,status,COALESCE(last_synced_at,last_sync_at) AS observed_at FROM integrations WHERE product_id=?',[productId]);
  // AUTHORITY REPORTED THE WAY EXECUTION READS IT. This asked only for an
  // unrevoked act-grant for the same CAPABILITY, so an expired grant reported
  // as active, and a grant bound to one responsibility made every other
  // responsibility of that capability report authority it did not have.
  // Execution requires a grant bound to the responsibility and still in date
  // (`activeResponsibilityAuthority`); the reconstruction now says the same.
  const responsibilityRows = await query(`SELECT r.id,r.title,r.state,r.capability,
    EXISTS(SELECT 1 FROM autonomy_consents a
            WHERE a.product_id=r.product_id AND a.capability=r.capability
              AND a.responsibility_id=r.id AND ${liveActGrant('a')}) AS active_authority
    FROM institutional_responsibilities r WHERE r.product_id=? ORDER BY r.created_at,r.id`,[productId]);
  const claims = await getReconstructionClaims(productId,now);
  const purposeKnown = claims.some((claim) => claim.subject==='company' && claim.predicate==='purpose' && !['unknown','stale'].includes(claim.epistemicStatus));
  return {
    identity:{ productId:String(product.id),name:String(product.name),ownerId:String(product.owner_id),evidenceRef:{kind:'product',id:String(product.id)} },
    systems:(integrations.rows as unknown as Array<Record<string,unknown>>).map((row) => {
      const observedAt=row.observed_at == null ? null : String(row.observed_at);
      const age=observedAt == null ? Number.POSITIVE_INFINITY : now.getTime()-new Date(observedAt).getTime();
      return { id:String(row.id),name:String(row.name),status:String(row.status),observedAt,
        epistemicStatus:observedAt==null?'unknown':age>7*86_400_000?'stale':'known' };
    }),
    responsibilities:(responsibilityRows.rows as unknown as Array<Record<string,unknown>>).map((row) => ({
      id:String(row.id),title:String(row.title),state:String(row.state),capability:String(row.capability),owner:'unknown',activeAuthority:Boolean(row.active_authority),
    })),
    claims,
    unknowns:purposeKnown?[]:['company_purpose'],
  };
}
