import { nanoid } from 'nanoid';
import { batch,query } from '../../db/client.js';
import { getResponsibility,type Responsibility } from './responsibility.js';

/**
 * `observationSourceKind` is the `signal_events.source` that may resolve this
 * expectation. It is required because the rule it states — an observation must
 * come from the channel that made the shadowing legitimate — was previously
 * enforced only by two triggers keyed on the expectation's TYPE PREFIX and by
 * each caller filtering its own query. A third kind of shadowing would have had
 * no guard at all. Migration 191 refuses an expectation that does not name one.
 *
 * It is NOT derivable from `observationSourceEvidenceRef`, which is the
 * evidence that the channel exists and is current, and which means different
 * things in the two callers: a signal FROM the ingest channel in external
 * shadowing, and a `repository` signal recording the need in development
 * shadowing, where the verification has not happened yet.
 */
export async function beginResponsibilityShadowing(input:{productId:string;responsibilityId:string;
  expectedEventType:string;expectationClaimId:string;observationSourceSignalId:string;
  observationSourceKind:string;validUntil?:Date}):Promise<Responsibility> {
  const expectationId=nanoid();
  await batch([
    {sql:`INSERT INTO responsibility_shadow_expectations
      (id,responsibility_id,product_id,expected_event_type,expectation_evidence_ref,observation_source_evidence_ref,
       observation_source_kind,valid_until)
      VALUES (?,?,?,?,?,?,?,?)`,args:[expectationId,input.responsibilityId,input.productId,input.expectedEventType.trim(),
      `reconstruction_claim:${input.expectationClaimId}`,`signal_event:${input.observationSourceSignalId}`,
      input.observationSourceKind.trim(),input.validUntil?.toISOString()??null]},
    {sql:`INSERT INTO responsibility_transitions
      (id,responsibility_id,from_state,to_state,evidence_ref,reason,actor_ref)
      VALUES (?,?,'understood','shadowing',?,?,?)`,args:[nanoid(),input.responsibilityId,
      `signal_event:${input.observationSourceSignalId}`,'A current independent observation channel can test a bounded expectation',
      'institution:shadow_observer']},
  ]);
  return getResponsibility(input.productId,input.responsibilityId) as Promise<Responsibility>;
}

export async function compareShadowObservation(input:{productId:string;expectationId:string;observationSignalId:string;
  learnedClaimId?:string}):Promise<'matched'|'deviated'|'unresolved'> {
  const expectation=await query(`SELECT expected_event_type,valid_until FROM responsibility_shadow_expectations
    WHERE id=? AND product_id=?`,[input.expectationId,input.productId]);
  if (!expectation.rows.length) throw new Error('shadow comparison refused');
  const observed=await query('SELECT event_type FROM signal_events WHERE id=? AND product_id=?',
    [input.observationSignalId,input.productId]);
  if (!observed.rows.length) throw new Error('shadow comparison refused');
  const row=expectation.rows[0] as Record<string,unknown>;
  const expired=row.valid_until!=null && new Date(String(row.valid_until))<=new Date();
  const classification=expired?'unresolved':String((observed.rows[0] as Record<string,unknown>).event_type)===String(row.expected_event_type)
    ?'matched':'deviated';
  try {
    await query(`INSERT INTO responsibility_shadow_comparisons
      (id,expectation_id,product_id,observation_ref,classification,learned_claim_id) VALUES (?,?,?,?,?,?)`,
    [nanoid(),input.expectationId,input.productId,`signal_event:${input.observationSignalId}`,classification,input.learnedClaimId??null]);
  } catch (error) {
    const replay=await query(`SELECT classification FROM responsibility_shadow_comparisons
      WHERE expectation_id=? AND observation_ref=?`,[input.expectationId,`signal_event:${input.observationSignalId}`]);
    if (!replay.rows.length) throw error;
    return String((replay.rows[0] as Record<string,unknown>).classification) as typeof classification;
  }
  return classification;
}

const DIRECTION_WORD: Record<string, string> = { rose: 'risen', fell: 'fallen', held: 'held steady' };

/**
 * What Foundry expected, said in words.
 *
 * The founder was shown `development_verified:schema-snapshot-freshness:passed`
 * — an internal identity, printed at the boundary where the company is owned.
 * Both families that can reach here are colon triples built by
 * `developmentEventType` and `externalObservationEventType`; they are named
 * below rather than imported, because this module stays family-agnostic and a
 * generic parse would put a sentence on anything shaped like a triple.
 *
 * Two places knowing one format is a shape this repository treats as a defect,
 * so the constructors and this function are compared by a test rather than
 * trusted to agree. An identity from neither family is printed as it stands:
 * showing a raw fact is honest, and inventing a sentence for a shape we do not
 * recognise would not be.
 */
export function shadowExpectationPhrase(eventType: string): string {
  const [family, subject, outcome, ...rest] = eventType.split(':');
  if (rest.length || !subject || !outcome) return eventType;
  if (family === 'development_verified') return `${subject} to report ${outcome}`;
  if (family === 'external_metric') return `${subject} to have ${DIRECTION_WORD[outcome] ?? outcome}`;
  return eventType;
}

/**
 * WHERE FOUNDRY WAS WATCHING.
 *
 * This tells the founder what differed from what Foundry expected, and did not
 * say what was doing the watching. "Your billing responsibility did not do what
 * was expected" means one thing when the observation came from the company's
 * own external metric feed and another when it came from somewhere else, and
 * the founder could not tell which.
 *
 * `observationChannel` is the channel named when the expectation was created,
 * which migration 191 also enforces the observation came from — so the sentence
 * and the guard cannot drift apart. `channelEvidence` is the signal that showed
 * the channel existed and was current: the reason Shadowing was allowed to
 * begin at all, previously written and never read.
 */
export async function getMaterialShadowingExceptions(productId:string):Promise<Array<{
  responsibilityId:string;title:string;expectedEventType:string;observedSummary:string;
  observationChannel:string|null;channelEvidence:string|null;classification:'deviated'|'unresolved';
}>> {
  const result=await query(`SELECT r.id AS responsibility_id,r.title,x.expected_event_type,e.summary,c.classification,
      x.observation_source_kind,x.observation_source_evidence_ref
    FROM responsibility_shadow_comparisons c
    JOIN responsibility_shadow_expectations x ON x.id=c.expectation_id
    JOIN institutional_responsibilities r ON r.id=x.responsibility_id
    JOIN signal_events e ON c.observation_ref='signal_event:' || e.id
    WHERE c.product_id=? AND r.product_id=? AND c.classification IN ('deviated','unresolved')
      -- THE FOUNDER ALREADY ANSWERED THIS. A disposition of
      -- deliberately_not_done is a recorded decision with a reason and
      -- evidence: the company is not doing this. absence-summary honours it and
      -- keeps those responsibilities out of what needs the founder; this did
      -- not, so a responsibility they had
      -- explicitly retired went on producing exceptions on the page they read
      -- every day. The comparison rows stay — retiring a responsibility decides
      -- what belongs on the daily surface, not what Foundry observed.
      AND r.disposition='active'
    ORDER BY c.created_at DESC`,[productId,productId]);
  return (result.rows as unknown as Array<Record<string,unknown>>).map((row)=>({responsibilityId:String(row.responsibility_id),
    title:String(row.title),expectedEventType:String(row.expected_event_type),observedSummary:String(row.summary),
    // Null on rows written before migration 191 named the channel. Saying
    // nothing is right for those; naming one we did not record would not be.
    observationChannel:row.observation_source_kind==null?null:String(row.observation_source_kind),
    channelEvidence:row.observation_source_evidence_ref==null?null:String(row.observation_source_evidence_ref),
    classification:row.classification as 'deviated'|'unresolved'}));
}
