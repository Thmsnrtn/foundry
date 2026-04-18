# Lens 148 — Customer Data Portability Readiness

**Distinct value:** Evaluates whether a founder can export ALL their data from Foundry: every product, every metric, every decision, every agent output, every briefing, all settings. Tests the existing export functionality against the complete data model to identify what is exported and what is silently omitted.

**Tenancy-critical:** Yes. Data portability is per-tenant. The export must include exactly one founder's data, no more and no less. Cross-tenant data (anonymized decision patterns) must be excluded. The export must be complete enough to satisfy GDPR Article 20 (right to data portability).

## Executive Summary

Foundry has a data export feature at `GET /privacy/export` that returns a JSON file containing metrics, briefings, decisions, customers, and agent configurations for the currently selected product. This is a solid foundation but exports only 5 of approximately 20+ data categories. Critical omissions include: stressor history, audit scores, lifecycle state, competitive intelligence, scenario models, cohort data, founding story artifacts, signal history, agent run details, SCP briefings narrative content, wisdom layer data (DNA, patterns, failures), team members, and privacy consent records themselves. The export is per-product, not per-founder, and there is no way to export all products at once.

## Existing Export Implementation

### Route: `GET /privacy/export` (`src/routes/dashboard/privacy.ts:373-402`)

The export function at `src/services/privacy/consent.ts:232-277` queries 5 tables:

| Table | Fields Exported | Completeness |
|-------|----------------|-------------|
| `metric_snapshots` | `SELECT *` | Full row data |
| `scp_briefings` | `id, product_id, briefing_date, headline, health_score, signal_score, risk_state, created_at` | **Partial** — excludes `narrative_html`, `agent_highlights`, `recommendations`, which are the most valuable fields |
| `decisions` | `id, product_id, title, description, status, category, created_at` | **Partial** — excludes `resolution_reasoning`, `outcome_logged`, `outcome_description`, `gate_level`, `risk_context` |
| `customers` | `id, product_id, segment, acquisition_channel, mrr_cents, status, created_at` | **Partial** — excludes health score, lifecycle stage, and engagement data |
| `agent_configs` | `id, product_id, agent_name, config_json, updated_at` | Full row data |

### Export format

The export returns a JSON file with a `Content-Disposition: attachment` header:
```json
{
  "exported_at": "2026-04-16T...",
  "product_id": "...",
  "product_name": "...",
  "metrics": [...],
  "briefings": [...],
  "decisions": [...],
  "customers": [...],
  "agent_config": [...]
}
```

This is well-structured and downloadable. The `_format` parameter accepts `'json' | 'csv'` but the CSV path is not implemented (the parameter is typed but ignored).

## Data Categories NOT Exported

| Category | Table(s) | Why It Matters | Severity |
|----------|----------|---------------|----------|
| Audit scores | `audit_scores` | 10-dimension audit history — the core intelligence product | P0 |
| Stressor history | `stressor_history` | Complete risk signal timeline | P1 |
| Lifecycle state | `lifecycle_state` | Current company lifecycle stage and conditions | P1 |
| Scenario models | `scenario_models` | Best/base/stress forecasts for past decisions | P1 |
| Competitive intelligence | `competitors`, `competitive_signals` | Competitor data and weekly scan results | P1 |
| Cohort data | `cohorts` | Retention analysis by acquisition period | P1 |
| Founding story artifacts | `founding_story_artifacts` | Milestone captures and narrative | P2 |
| Signal event history | `signal_events` | Signal score timeline and component breakdown | P1 |
| Agent run details | `agent_run_details` | Individual agent analysis outputs | P1 |
| Product DNA | (via services) | ICP, positioning, voice — the wisdom layer calibration | P1 |
| Judgment patterns | `founder_judgment_patterns` | How the founder makes decisions (learned behavior) | P1 |
| Failure library | (via services) | Documented failure cases and lessons | P2 |
| Team members | `team_members`, `team_invitations` | Who has access to the product | P2 |
| Privacy consents | `privacy_consents` | The founder's own consent decisions | P2 |
| Data residency settings | `data_residency_settings` | Privacy configuration | P3 |
| Webhook configurations | `webhooks` | API integrations the founder has set up | P2 |
| Integration configs | `integrations` | Connected services and their settings | P2 |
| ROI outcomes | `roi_outcomes` | Measured business outcomes | P1 |
| Decision quality scores | `decision_quality_scores` | Decision effectiveness metrics | P1 |
| Playbooks | `execution_playbooks` | Custom automation playbooks | P2 |
| Journal entries | `founder_journal_entries` | Personal founder reflections | P1 |

## Per-Founder vs. Per-Product Export

The current export is per-product. It exports data for `ctx.productId` (the currently selected product). A founder with 5 products must:
1. Switch to each product in the UI
2. Navigate to Privacy -> Export
3. Download each product's export separately
4. Manually combine them

There is no "Export all my data" button that exports everything across all products.

**For GDPR Article 20 compliance:** The right to data portability applies to the individual (founder), not per-product. A founder requesting their data under GDPR is entitled to ALL their data in one export.

## Export Format Assessment

| Requirement | Status |
|-------------|--------|
| Machine-readable format | Yes (JSON) |
| Commonly used format | Yes (JSON) |
| Structured and labeled | Yes (keyed by category) |
| Complete | No (5 of 20+ categories) |
| CSV option | Declared in type but not implemented |
| Per-founder (all products) | No (per-product only) |
| Includes metadata (export date, product info) | Yes |
| Includes schema/field descriptions | No |
| Can be imported into another system | Partially (data is structured but no import format documentation) |

## Briefing Export Quality Issue

The briefing export at `src/services/privacy/consent.ts:248-251` explicitly selects only metadata columns:
```sql
SELECT id, product_id, briefing_date, headline, health_score, signal_score, risk_state, created_at
FROM scp_briefings WHERE product_id = ?
```

This omits the actual briefing content (the AI-generated narrative, recommendations, and agent highlights). The founder receives a list of dates and scores but not the intelligence they paid for. This is like exporting email metadata but not the email bodies.

## Findings Summary

| # | Finding | Severity | Description |
|---|---------|----------|-------------|
| 1 | Export covers only 5 of 20+ data categories | P0 | Major data categories silently omitted |
| 2 | Briefing narrative content excluded | P1 | Most valuable field omitted from export |
| 3 | Decision reasoning and outcomes excluded | P1 | Context for decisions lost |
| 4 | No per-founder export (only per-product) | P1 | GDPR non-compliant for multi-product founders |
| 5 | CSV export declared but not implemented | P2 | Type signature promises CSV but ignores the parameter |
| 6 | Audit scores (core product) not exported | P0 | The primary intelligence artifact is not portable |
| 7 | Wisdom layer (DNA, patterns, failures) not exported | P1 | Learned calibration data is lost on churn |
| 8 | No export schema documentation | P2 | Receiving system cannot interpret the data without reverse-engineering |
| 9 | No import capability | P3 | Data portability is one-way only |
| 10 | Agent run details not exported | P1 | Individual agent analyses are not included |

## Priority Remediation

1. **P0:** Expand `exportProductData` to include all 20+ data categories with `SELECT *` (or at minimum all non-internal columns)
2. **P0:** Include full briefing content (narrative_html, recommendations, agent_highlights) in export
3. **P1:** Add a per-founder export endpoint that iterates all owned products and combines into a single download
4. **P1:** Include decision reasoning, outcomes, gate levels, and risk context in export
5. **P1:** Include audit scores with all 10 dimensions and blocking issues
6. **P2:** Implement the CSV export option (the type already declares it)
7. **P2:** Add export schema documentation (field names, types, meanings) as a header in the export file
8. **P2:** Include wisdom layer data (DNA, patterns, failures, journal entries) in export
