import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import { getResponsibility,type Responsibility } from './responsibility.js';

/**
 * Admit one responsibility to Assisting without executing anything.
 *
 * The database verifies that both references are current, canonical, and
 * bound to this responsibility.  In particular, this function deliberately
 * does not accept confidence, capability maturity, or a caller identity as a
 * substitute for authority.
 */
export async function enterResponsibilityAssisting(input:{
  productId:string;
  responsibilityId:string;
  shadowComparisonId:string;
  authorityConsentId:string;
}):Promise<Responsibility> {
  const responsibility=await getResponsibility(input.productId,input.responsibilityId);
  if (!responsibility || responsibility.state!=='shadowing') throw new Error('assisting entry refused');

  await query(`INSERT INTO responsibility_transitions
    (id,responsibility_id,from_state,to_state,evidence_ref,authority_ref,reason,actor_ref)
    VALUES (?,?,'shadowing','assisting',?,?,?,?)`,[
    nanoid(),input.responsibilityId,`shadow_comparison:${input.shadowComparisonId}`,
    `autonomy_consent:${input.authorityConsentId}`,
    'Bounded shadow evidence and explicit responsibility authority permit assistance',
    'institution:assisting_entry_verifier',
  ]);
  return getResponsibility(input.productId,input.responsibilityId) as Promise<Responsibility>;
}
