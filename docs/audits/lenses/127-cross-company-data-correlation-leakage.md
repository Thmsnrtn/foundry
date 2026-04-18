# Lens 127 — Cross-Company Data Correlation Leakage

**Auditor perspective:** Edge-case hunter / domain adversary — does fleet intelligence reveal Company A's data in Company B's view?
**Distinct-value declaration:** Traces every cross-company data flow to determine whether aggregated or correlated data could be reverse-engineered to identify or characterize specific companies. Distinct from lens 44 (direct access control) -- this lens targets statistical/inferential leakage.
**Tenancy-critical:** Yes. This is a core tenant isolation concern at the intelligence layer.

**Date:** 2026-04-16
**Repo:** foundry (Hono + Turso + Clerk + Anthropic)

---

## Summary

| Severity | Count |
|----------|-------|
| P1 | 2 |
| P2 | 3 |

---

## CL-01. `decision_patterns` table has no anonymization and is globally queryable

**Severity: P1**
**Files:** `src/db/client.ts:210-250`, `src/services/decisions/patterns.ts`

The `decision_patterns` table stores cross-product decision outcomes for pattern matching. When a founder makes a decision, the system looks for similar decisions across ALL products to show outcome patterns. The `getRelevantPatterns()` function in `db/client.ts` queries:

```sql
SELECT * FROM decision_patterns
WHERE decision_type = ? AND lifecycle_stage = ?
ORDER BY confidence DESC LIMIT 5
```

There is no `product_id` filter. Any founder viewing decision recommendations sees patterns derived from all other founders' decisions. The patterns include:
- `decision_type` (e.g., "pricing_change", "feature_launch")
- `lifecycle_stage` (e.g., "prompt_5", "prompt_7")
- `risk_state` at time of decision
- `outcome_direction` ("positive", "neutral", "negative")
- `outcome_magnitude` and `outcome_timeframe_days`
- `market_category` (if set)

**Leakage vector:** A founder in a niche market category (e.g., "vertical SaaS for dental practices") could see that the only pricing_change decision in their category at prompt_5 had a "negative" outcome. If there are few companies in that category, this reveals another specific company's decision outcome.

**Evidence:**
- `src/db/client.ts`: `getRelevantPatterns` has no product exclusion or anonymization
- No minimum sample size before showing patterns (even 1 data point is shown)
- `market_category` is stored, creating small-N correlation risk

---

## CL-02. Portfolio benchmarking reveals position in percentile distribution

**Severity: P1**
**Files:** `src/services/portfolio/manager.ts:136-189`

The `benchmarkProduct` function computes percentile rankings for a product against all products in a portfolio. The response includes:

```json
{
  "product_percentile": { "churn_rate": 25, "activation_rate": 75 },
  "portfolio_median": { "churn_rate": 0.05, "activation_rate": 0.42 }
}
```

In a small portfolio (3-5 companies), the percentile is highly identifying. If Company A sees their churn_rate is at the 0th percentile (worst), they know they have the highest churn in the portfolio. Combined with the median value, they can bound the range of other companies' metrics.

**Evidence:**
- `src/services/portfolio/manager.ts:165-177`: Percentile computed as `below / total * 100`
- No minimum portfolio size before showing percentiles
- The `portfolio_median` exposes the exact median value of all members' metrics

**Impact:** Portfolio members can infer each other's approximate metric values, especially in small portfolios. This may violate confidentiality expectations between portfolio companies.

---

## CL-03. Network Intelligence benchmarks expose aggregate distributions

**Severity: P2**
**Files:** `src/services/network/benchmarks.ts`, `src/jobs/index.ts:917-935`

The `networkContribution` job submits anonymized metrics to the Intelligence Network. The `scp_benchmark_refresh` job computes percentiles across all contributing products. Dashboard benchmark pages show "You are in the Xth percentile for churn_rate among early-stage SaaS."

While individual company data is not exposed, the percentile distribution itself leaks information. In a small Foundry user base (e.g., 25 companies), a company at the 96th percentile for activation_rate knows there are only 1-2 companies above them. If they can identify other Foundry users in their network, they can correlate.

**Evidence:**
- `src/jobs/index.ts:1294-1301`: Benchmark submissions include `company_stage` and `industry` -- creating small-N buckets
- No k-anonymity or differential privacy on benchmark outputs
- No minimum bucket size before showing percentiles

---

## CL-04. `aggregateInsights` in wisdom network crosses company boundaries

**Severity: P2**
**Files:** `src/services/wisdom/network.ts`

The `aggregateInsights()` function (called by `patternAggregation` job) generates cross-product wisdom insights. These insights are derived from patterns across multiple companies and may surface on individual company dashboards.

The risk is that an insight like "Companies that reduced churn by implementing X at your lifecycle stage saw 20% MRR growth" could be reverse-engineered if the founder knows which other companies are in the Foundry ecosystem and what actions they recently took.

**Evidence:**
- `src/services/wisdom/network.ts`: `aggregateInsights` is imported and called from the jobs file
- The orientation doc notes: "Cross-product decision_patterns table has no access controls -- any founder can influence"

---

## CL-05. Competitive scan results could cross-contaminate shared competitor analysis

**Severity: P2**
**Files:** `src/services/intelligence/competitive.ts`

If two Foundry companies compete in the same market, their competitive scans (via Claude AI analysis) may identify each other as competitors. The scan stores results in `competitive_signals` per product. While the data is product-scoped, the AI analysis draws from public information and could surface intelligence about another Foundry customer.

This is not a direct data leak but a reputational concern: "Foundry told Company A that Company B (also a Foundry customer) launched a competing feature."

---

## Recommendations

1. **Add minimum sample size to decision patterns** -- Do not show patterns with fewer than 5 data points. This prevents small-N inference.
2. **Exclude the querying company's own decisions from pattern results** -- Add `AND product_id != ?` to prevent self-correlation.
3. **Set minimum portfolio size for benchmarking** -- Require at least 10 companies before showing percentile distributions.
4. **Apply k-anonymity to network benchmarks** -- Suppress buckets (stage + industry) with fewer than 5 companies.
5. **Document the cross-company intelligence model** -- Make it explicit to founders that decision patterns and benchmarks are derived from anonymized aggregate data, and let them opt out via the privacy settings page.
