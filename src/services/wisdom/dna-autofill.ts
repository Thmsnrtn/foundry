// =============================================================================
// FOUNDRY — DNA Auto-fill (Wave 2, action 12)
// Pre-fills the Product DNA fields by extracting structured signal from
// existing assets the founder has already created — GitHub README,
// landing page (if discoverable), Stripe descriptions. The founder
// reviews and edits, never types from blank.
//
// Per 300-persona review:
//   - Council 14 (CEOs): the DNA ritual is where founders skip; agent
//     quality silently degrades when DNA is incomplete (60% threshold
//     gates the wisdom layer activation).
//   - Council 24 (early-revenue founders): the highest single
//     onboarding-friction reduction is auto-fill from existing assets.
// =============================================================================

import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { shieldOrLog } from '../ai/prompt-shield.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DNADraft {
  icp_description: string | null;
  icp_pain: string | null;
  icp_trigger: string | null;
  positioning_statement: string | null;
  what_we_are_not: string | null;
  primary_objection: string | null;
  objection_response: string | null;
  market_insight: string | null;
}

export interface AutofillSourceMaterial {
  /** Plain text of the GitHub README, if available. */
  readme?: string;
  /** Plain text of the landing page, if scraped. */
  landingPage?: string;
  /** Stripe product descriptions, joined. */
  stripeDescriptions?: string;
  /** Optional product name for grounding. */
  productName?: string;
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run an LLM extraction over the founder's existing assets to draft DNA
 * fields. Returns a DNADraft the founder can accept/edit. Untrusted
 * content is sanitized before it reaches the LLM (prompt shield).
 */
export async function extractDNAFromAssets(
  source: AutofillSourceMaterial,
  productId: string
): Promise<DNADraft> {
  const readme = source.readme
    ? shieldOrLog(source.readme, { source: 'dna_autofill_readme', productId })
    : '';
  const landing = source.landingPage
    ? shieldOrLog(source.landingPage, { source: 'dna_autofill_landing', productId })
    : '';
  const stripe = source.stripeDescriptions
    ? shieldOrLog(source.stripeDescriptions, { source: 'dna_autofill_stripe', productId })
    : '';

  if (!readme && !landing && !stripe) {
    return emptyDraft();
  }

  const systemPrompt = `You extract Product DNA fields from a founder's existing materials.
You return JSON only — no prose. If a field cannot be reasonably inferred,
return null for that field. Do not invent. Do not fill in plausible-sounding
content; founders prefer "null" over "wrong."

JSON shape:
{
  "icp_description": "string or null — who the customer is, in their own terms",
  "icp_pain": "string or null — the painful gap the product fills",
  "icp_trigger": "string or null — what makes a customer act now",
  "positioning_statement": "string or null — one-sentence positioning",
  "what_we_are_not": "string or null — explicit non-positioning",
  "primary_objection": "string or null — the most common objection prospects raise",
  "objection_response": "string or null — how the founder responds to that objection",
  "market_insight": "string or null — the founder's distinctive view of the market"
}

Constraints:
- Each field, when non-null, is at most 250 characters.
- Voice: write in the founder's voice, second-person ("your", "you") when describing the customer.
- Signal over polish — extract; don't author.`;

  const sourceParts: string[] = [];
  if (source.productName) sourceParts.push(`Product name: ${source.productName}`);
  if (readme) sourceParts.push(`--- GITHUB README ---\n${readme}`);
  if (landing) sourceParts.push(`--- LANDING PAGE ---\n${landing}`);
  if (stripe) sourceParts.push(`--- STRIPE DESCRIPTIONS ---\n${stripe}`);

  const userPrompt = `Extract Product DNA from the following materials:

${sourceParts.join('\n\n')}

Return only the JSON object specified.`;

  const response = await callSonnet(systemPrompt, userPrompt, 1500, productId);
  let parsed: Partial<DNADraft>;
  try {
    parsed = parseJSONResponse<DNADraft>(response.content);
  } catch {
    return emptyDraft();
  }

  // Sanitize each field: enforce length cap, coerce null when empty.
  return {
    icp_description: clamp(parsed.icp_description),
    icp_pain: clamp(parsed.icp_pain),
    icp_trigger: clamp(parsed.icp_trigger),
    positioning_statement: clamp(parsed.positioning_statement),
    what_we_are_not: clamp(parsed.what_we_are_not),
    primary_objection: clamp(parsed.primary_objection),
    objection_response: clamp(parsed.objection_response),
    market_insight: clamp(parsed.market_insight),
  };
}

// ─── Internals ────────────────────────────────────────────────────────────────

function emptyDraft(): DNADraft {
  return {
    icp_description: null,
    icp_pain: null,
    icp_trigger: null,
    positioning_statement: null,
    what_we_are_not: null,
    primary_objection: null,
    objection_response: null,
    market_insight: null,
  };
}

function clamp(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  return trimmed.slice(0, 250);
}
