// =============================================================================
// FOUNDRY — Web-Based Audit Intake (Non-Code Founder Track)
// URL-based product analysis for founders without GitHub repos.
// =============================================================================

import { query } from '../../db/client.js';
import { callSonnet, parseJSONResponse } from '../ai/client.js';
import { nanoid } from 'nanoid';

export interface WebAuditResult {
  id: string;
  product_id: string;
  url: string;
  lighthouse_scores: LighthouseScores | null;
  page_analysis: PageAnalysis;
  trust_signals: TrustSignals;
  mobile_responsiveness: MobileAnalysis;
  findings: WebAuditFinding[];
}

interface LighthouseScores {
  performance: number;
  accessibility: number;
  best_practices: number;
  seo: number;
}

interface PageAnalysis {
  detected_features: string[];
  has_forms: boolean;
  has_payment: boolean;
  has_auth: boolean;
  payment_processor: string | null;
  auth_system: string | null;
}

interface TrustSignals {
  has_ssl: boolean;
  has_privacy_policy: boolean;
  has_terms: boolean;
  has_contact_info: boolean;
  has_social_proof: boolean;
  social_proof_details: string[];
}

interface MobileAnalysis {
  has_viewport_meta: boolean;
  responsive_indicators: string[];
}

interface WebAuditFinding {
  dimension: string;
  dimension_number: number;
  finding: string;
  evidence: string;
  severity: 'critical' | 'major' | 'minor' | 'informational';
}

interface VendorRecommendation {
  category: string;
  recommendation: string;
  priority: string;
  estimated_cost_range: string;
  estimated_timeline: string;
}

/**
 * Run a web-based audit for a non-code product.
 * Fetches the URL, analyzes the page, and scores via Claude Sonnet.
 */
export async function runWebAudit(url: string, productId: string, ownerId: string): Promise<WebAuditResult> {
  // Fetch the URL (basic HTTP)
  let htmlContent = '';
  let hasSSL = false;
  // The most literal SSRF shape in the codebase: a founder hands us a URL over
  // an API route and the server fetches it. Checked before the request, with
  // DNS re-resolution, so a public hostname that now points at loopback or a
  // cloud metadata endpoint is refused.
  // Through the canonical guarded path: it screens the URL AND re-screens
  // every redirect hop, because the server at the far end chooses those.
  const { safeFetch } = await import('../outbound/ssrf.js');
  try {
    const response = await safeFetch(url, {
      headers: { 'User-Agent': 'Foundry-Audit-Bot/1.0' },
      redirect: 'follow',
    });
    htmlContent = await response.text();
    hasSSL = url.startsWith('https://');
  } catch {
    htmlContent = '';
  }

  // Use Claude Sonnet to analyze the page
  const analysisPrompt = `Analyze this web page HTML for a SaaS product audit. Return JSON with these fields:
{
  "page_analysis": {
    "detected_features": ["list of visible product features"],
    "has_forms": boolean,
    "has_payment": boolean,
    "has_auth": boolean,
    "payment_processor": "stripe|paypal|other|null",
    "auth_system": "custom|oauth|clerk|auth0|null"
  },
  "trust_signals": {
    "has_privacy_policy": boolean,
    "has_terms": boolean,
    "has_contact_info": boolean,
    "has_social_proof": boolean,
    "social_proof_details": ["testimonials", "logos", etc]
  },
  "mobile_responsiveness": {
    "has_viewport_meta": boolean,
    "responsive_indicators": ["media queries found", "flex/grid layout", etc]
  },
  "findings": [
    {"dimension": "D3", "dimension_number": 3, "finding": "...", "evidence": "...", "severity": "major"}
  ]
}

Score against these dimensions from external observation:
- D3 (Trust Density): SSL, privacy, terms, social proof, verifiable claims
- D4 (Value Legibility): Can a stranger understand what this does and why they'd pay?
- D9 (Launch Readiness): Marketing pages, analytics tags, onboarding flow visible
- D10 (Stranger Test): Overall first impression of trust and professionalism

URL: ${url}
SSL: ${hasSSL}

HTML content (first 15000 chars):
${htmlContent.slice(0, 15000)}`;

  const response = await callSonnet(
    'You are a SaaS product auditor analyzing a web page. Be specific and evidence-based.',
    analysisPrompt,
    4096, productId
  );

  const analysis = parseJSONResponse<{
    page_analysis: PageAnalysis;
    trust_signals: Omit<TrustSignals, 'has_ssl'>;
    mobile_responsiveness: MobileAnalysis;
    findings: WebAuditFinding[];
  }>(response.content);

  const result: WebAuditResult = {
    id: nanoid(),
    product_id: productId,
    url,
    lighthouse_scores: null, // Would require running Lighthouse separately
    page_analysis: analysis.page_analysis,
    trust_signals: { ...analysis.trust_signals, has_ssl: hasSSL },
    mobile_responsiveness: analysis.mobile_responsiveness,
    findings: analysis.findings,
  };

  // Persist
  await query(
    `INSERT INTO web_audit_results (id, product_id, owner_id, url, lighthouse_scores, page_analysis, trust_signals, mobile_responsiveness, findings)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      result.id, productId, ownerId, url, null,
      JSON.stringify(result.page_analysis),
      JSON.stringify(result.trust_signals),
      JSON.stringify(result.mobile_responsiveness),
      JSON.stringify(result.findings),
    ]
  );

  return result;
}

/**
 * Generate vendor/contractor recommendations instead of PRs for non-code founders.
 */
export async function generateVendorRecommendations(
  auditFindings: WebAuditFinding[],
  productId: string,
  ownerId: string
): Promise<VendorRecommendation[]> {
  if (auditFindings.length === 0) return [];

  const prompt = `Based on these audit findings for a no-code/outsourced SaaS product, generate actionable vendor/contractor recommendations.

Findings:
${auditFindings.map((f) => `- [${f.severity}] ${f.dimension}: ${f.finding} (Evidence: ${f.evidence})`).join('\n')}

For each recommendation, provide:
- category: migration | development | design | security | compliance
- recommendation: specific actionable advice
- priority: low | medium | high | critical
- estimated_cost_range: e.g. "$2K-$5K"
- estimated_timeline: e.g. "2-4 weeks"

Return JSON array of recommendations. Be specific about what type of vendor/freelancer to hire and what to ask for.`;

  const response = await callSonnet(
    'You are a technical advisor for non-technical founders. Translate technical audit findings into actionable hiring decisions.',
    prompt,
    4096, productId
  );

  const recommendations = parseJSONResponse<VendorRecommendation[]>(response.content);

  // Persist each recommendation
  for (const rec of recommendations) {
    await query(
      `INSERT INTO vendor_recommendations (id, product_id, owner_id, category, recommendation, priority, estimated_cost_range, estimated_timeline)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, ownerId, rec.category, rec.recommendation, rec.priority, rec.estimated_cost_range, rec.estimated_timeline]
    );
  }

  return recommendations;
}

/**
 * Assess whether a no-code product is ready to migrate to custom code.
 *
 * FOUR OF THE FIVE COMPONENTS WERE BROKEN, EACH IN A DIFFERENT WAY, AND EVERY
 * ONE OF THEM FAILED TOWARDS A CLAIM.
 *
 *   Revenue    read as `new_mrr_cents + expansion_mrr_cents` — two ONE-PERIOD
 *              MOVEMENT columns — instead of `mrr_cents`, the level, with each
 *              coalesced to 0. A daily job writes a placeholder snapshot whose
 *              movement columns are `INTEGER DEFAULT 0`, so a company at
 *              $80k MRR was assessed at $0 and told "revenue may not yet
 *              justify migration costs", and the migration plan the model then
 *              wrote said "MRR: $0" in its prompt.
 *   Users      `?? 0`, so a company that reports no user count is measured at
 *              zero users rather than at nothing.
 *   Churn      `churnRate < 5` against a column stored as a 0–1 FRACTION, so
 *              the test was "is churn under 500%" and 90% monthly churn
 *              collected the fifteen points for "low churn suggests
 *              product-market fit".
 *   NPS        `(m?.nps_score as number) ?? 0 >= 50` parses as
 *              `nps_score ?? (0 >= 50)`, because `>=` binds tighter than `??`.
 *              The comparison against 50 never ran on the score. Any non-zero
 *              NPS — including -40 — was "High NPS confirms value delivery".
 *
 * A threshold is a FINDING. It fires on a measured value or it does not fire,
 * and an absent measurement is neither a pass nor a fail: it is silence, and it
 * is now reported as silence. `ready` is null when what could not be measured
 * could still change the answer — which is a bound, not a hedge.
 */
export async function assessMigrationReadiness(productId: string): Promise<{
  ready: boolean | null;
  score: number;
  measurable: number;
  reasons: string[];
  not_measured: string[];
  transition_plan: string | null;
}> {
  const product = await query('SELECT * FROM products WHERE id = ?', [productId]);
  const p = product.rows[0] as Record<string, unknown> | undefined;
  if (!p) {
    return {
      ready: null, score: 0, measurable: 0,
      reasons: ['Product not found'], not_measured: [], transition_plan: null,
    };
  }

  const metrics = await query(
    'SELECT * FROM metric_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1',
    [productId]
  );
  const m = metrics.rows[0] as Record<string, unknown> | undefined;
  /** A number the company actually reported, or null. Never a stand-in zero. */
  const reported = (key: string): number | null => {
    const v = m?.[key];
    return v === null || v === undefined ? null : Number(v);
  };
  const mrrCents = reported('mrr_cents');
  const activeUsers = reported('active_users');

  const reasons: string[] = [];
  const notMeasured: string[] = [];
  let score = 0;
  /** The share of the 100-point scale this company could be assessed on. */
  let measurable = 0;

  // Revenue justifies migration cost
  if (mrrCents === null) {
    notMeasured.push('MRR is not reported, so revenue cannot weigh either way');
  } else {
    measurable += 30;
    if (mrrCents > 500000) { score += 30; reasons.push('Revenue ($5K+/mo) can justify development costs'); }
    else if (mrrCents > 200000) { score += 15; reasons.push('Moderate revenue may justify phased migration'); }
    else { reasons.push('Revenue may not yet justify migration costs'); }
  }

  // User count suggests platform limits approaching
  if (activeUsers === null) {
    notMeasured.push('Active users are not reported');
  } else {
    measurable += 20;
    if (activeUsers > 100) { score += 20; reasons.push('User count suggests no-code platform limits approaching'); }
    else if (activeUsers > 50) { score += 10; }
  }

  // Check for vendor recommendations with "migration" category. Always
  // measurable: a count over rows this product owns is zero when there are
  // none, and that zero is a measurement.
  const migrationRecs = await query(
    `SELECT COUNT(*) as c FROM vendor_recommendations WHERE product_id = ? AND category = 'migration'`,
    [productId]
  );
  const migCount = (migrationRecs.rows[0] as Record<string, number>)?.c ?? 0;
  measurable += 20;
  if (migCount > 0) { score += 20; reasons.push(`${migCount} migration-related recommendations already identified`); }

  // Product-market fit signals. `churn_rate` is a 0–1 FRACTION here and
  // everywhere else in `metric_snapshots`; 0.05 is five percent a month.
  const churnRate = reported('churn_rate');
  if (churnRate === null) {
    notMeasured.push('Churn is not reported');
  } else {
    measurable += 15;
    if (churnRate < 0.05) { score += 15; reasons.push('Low churn suggests product-market fit'); }
  }
  const nps = reported('nps_score');
  if (nps === null) {
    notMeasured.push('NPS is not reported');
  } else {
    measurable += 15;
    if (nps >= 50) { score += 15; reasons.push('High NPS confirms value delivery'); }
  }

  let transitionPlan: string | null = null;
  if (score >= 50) {
    const prompt = `Create a brief migration plan for moving a ${p.build_platform} product to custom code.
Product: ${p.name}
Current users: ${activeUsers === null ? 'not reported' : activeUsers}
MRR: ${mrrCents === null ? 'not reported' : `$${(mrrCents / 100).toFixed(0)}`}
Key findings: ${reasons.join(', ')}

Outline 3-5 steps with timeline and cost estimates.`;

    const response = await callSonnet(
      'You are a technical migration advisor. Be practical and cost-conscious.',
      prompt,
      1024, productId
    );
    transitionPlan = response.content;
  }

  // Ready when the evidence reaches the threshold. NOT ready only when the
  // evidence that is missing could not reach it even if all of it came back
  // perfect. Between those, the honest answer is that this cannot be said yet.
  const ready = measurable === 0
    ? null
    : score >= 50
      ? true
      : score + (100 - measurable) >= 50
        ? null
        : false;

  return { ready, score, measurable, reasons, not_measured: notMeasured, transition_plan: transitionPlan };
}
