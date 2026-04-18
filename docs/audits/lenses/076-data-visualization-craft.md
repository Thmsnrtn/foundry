# Lens 076 — Data Visualization Craft

**Distinct value:** Evaluates the quality and effectiveness of data visualizations in Foundry's fleet dashboards — sparklines, bar charts, score displays, MRR decomposition, cohort heatmaps, audit dimension scores, and the Signal score display. Judges visual encoding quality, data-ink ratio, and whether visualizations tell the truth clearly.

**Tenancy-critical:** Yes. Fleet dashboards must visualize data across 25+ companies. The current single-company visualizations need to scale to comparative views.

## Executive Summary

Foundry's data visualization is surprisingly good for a server-rendered HTML app with no charting library. The Signal score (giant number with sparkline trend) is the centerpiece and it works beautifully — it is immediately legible, color-coded by tier, and includes a delta indicator and trend sparkline. The MRR decomposition uses a four-cell grid with semantic color coding. The audit dimension scores use horizontal bar charts with color-coded fill. The stressor report uses severity-colored left borders. However, visualizations are limited to what HTML/CSS can express: there are no time-series charts, no scatter plots, no comparative multi-product visualizations. The cohort table is a number grid with no heatmap coloring. The decision analytics uses bar fills but no axis labels. There is no charting library and no SVG chart generation beyond sparklines.

## Findings

### DV-01 Signal Score Display Is Excellent
- **Severity:** (Positive Finding)
- **Description:** The Signal score is displayed as a massive 9rem number (center-aligned, tabular-nums, weight 800) with color coding by tier (green/yellow/red), a delta indicator showing change from yesterday, and a SVG sparkline showing the 60-day trend. Clicking the number opens a Signal Anatomy dialog that breaks down the score composition with horizontal bar charts. This is the best visualization in the product — it communicates urgency, trend, and composition in a single glance.
- **Evidence:** `src/public/styles.css:351-372` — Signal number styling. `src/routes/dashboard/index.ts:40-98` — Signal Anatomy dialog with bar decomposition. `src/routes/dashboard/index.ts:22-35` — sparkline SVG generator.
- **Remediation:** N/A — this is the model for all data display in Foundry.
- **Target Phase:** N/A

### DV-02 No Comparative Visualization Across Products
- **Severity:** P1
- **Description:** The portfolio view shows each product's signal score as a card with a giant number. There is no comparative visualization: no small multiples, no side-by-side sparklines, no ranking bar chart, no fleet-level trend. For a fleet management tool, the inability to compare product performance at a glance is a significant gap.
- **Evidence:** `src/routes/dashboard/portfolio.ts:42-52` — portfolio cards show only signal number, product name, and first sentence of prose. No sparklines, no trend indicators, no MRR comparison.
- **Remediation:** Add per-product sparklines to portfolio cards (the sparkline generator already exists). Add a fleet-level comparative bar chart showing all products' signal scores ranked. Add trend arrows (up/down) for each product.
- **Target Phase:** 2

### DV-03 Cohort Table Lacks Visual Encoding
- **Severity:** P2
- **Description:** The cohort retention table displays raw percentages in a grid without any visual encoding. A proper cohort table uses background color intensity (heatmap) to make retention drop-off immediately visible. Currently, "85%" and "12%" are visually identical — both are plain white text on dark background. The historical average row has a slightly different background but no color coding.
- **Evidence:** `src/views/components.ts:446-484` — cohort table renders raw percentage text. No conditional coloring, no heatmap, no bar-in-cell visualization.
- **Remediation:** Add inline background-color with opacity based on the retention percentage: `style="background:rgba(78,204,163,${(retentionPct/100)*0.3})"`. High retention = green tint, low retention = red tint. This transforms the number grid into a readable heatmap.
- **Target Phase:** 3

### DV-04 Audit Dimension Bars Are Well-Designed
- **Severity:** (Positive Finding)
- **Description:** The audit dimension score display uses horizontal progress bars with color-coded fill (green for 7+, yellow for 5-7, red for below 5), dimension names, weight percentages, and numeric scores. The visual hierarchy is correct: the bar draws the eye, the color communicates quality, the number provides precision.
- **Evidence:** `src/views/components.ts:197-212` — dimension rows with `.dim-bar-track` and `.dim-bar-fill`. `src/public/styles.css:927-948` — color classes for score ranges.
- **Remediation:** N/A — this is good visualization design. Consider adding delta arrows comparing to previous audit.
- **Target Phase:** N/A

### DV-05 Decision Analytics Bars Lack Axis Context
- **Severity:** P2
- **Description:** The Decision Intelligence page shows outcome quality bars (`analytics-bar-fill`) with percentage labels. The bars are correct in their encoding (width proportional to favorable rate), but there are no axis labels, no baseline indicator, and no visual distinction between "no data" (0%) and "0% favorable rate". The bar track is always visible at full width, making it clear where the fill ends, but context is missing.
- **Evidence:** `src/routes/dashboard/decisions.ts:508-522` — `barRow()` function. `src/public/styles.css:670-694` — analytics bar styles. No axis labels or grid lines.
- **Remediation:** Add a subtle 50% marker line on the bar track. Show "No outcomes yet" text instead of an empty bar when there is no data. Consider adding a benchmark line (e.g., "founders at this stage average 65% favorable").
- **Target Phase:** 3

### DV-06 MRR Decomposition Uses Semantic Colors Correctly
- **Severity:** (Positive Finding)
- **Description:** The MRR decomposition grid uses four color-coded cells: New (green), Expansion (green at 75% opacity), Contraction (yellow), Churned (red). The total MRR is displayed as a large number. The health ratio is shown with a risk-state badge. The visual encoding correctly maps positive revenue events to green tones and negative events to warning/danger tones.
- **Evidence:** `src/views/components.ts:91-125` — MRR component. `src/public/styles.css:856-864` — semantic color mapping.
- **Remediation:** N/A. Consider adding trend arrows or sparklines per MRR component for temporal context.
- **Target Phase:** N/A

### DV-07 No Time-Series Charts Beyond Sparklines
- **Severity:** P2
- **Description:** The only temporal visualization is the 60-day Signal sparkline. There are no time-series charts for MRR over time, retention trends, decision velocity, agent session counts, or stressor duration. For a business intelligence platform, the absence of temporal visualization is a significant gap. A lightweight SVG charting approach (extending the sparkline generator) could provide line charts without adding a JS charting library.
- **Evidence:** `src/routes/dashboard/index.ts:22-35` — only sparkline generator in the codebase. No chart library in dependencies.
- **Remediation:** Extend the sparkline SVG generator to support larger charts with axis labels, grid lines, and tooltips. Use this for: MRR trend (30-day), retention curve, and agent accuracy over time. SVG generation on the server keeps the zero-JS-library approach.
- **Target Phase:** 3

## Embarrassment Test
1. A founder looking at their cohort retention table cannot tell at a glance which cohorts have healthy retention and which are bleeding — all numbers look the same.
2. A fleet of 25 companies is represented by 25 identical cards with no comparative visualization — a "fleet management tool" that cannot compare fleet members.

## Recommendations (Priority Order)
1. Add sparklines and trend indicators to portfolio cards (P1, Phase 2)
2. Add heatmap coloring to cohort table (P2, Phase 3)
3. Build server-side SVG chart generator for MRR trends (P2, Phase 3)
4. Add axis context to decision analytics bars (P2, Phase 3)
5. Add fleet-level comparative bar chart for signal scores (P2, Phase 3)
