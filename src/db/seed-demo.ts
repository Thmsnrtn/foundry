// =============================================================================
// FOUNDRY — Demo Seed Script
// Creates a realistic founder with 6 months of history. Run with:
//   tsx src/cli/index.ts db:seed-demo
// =============================================================================

import { query, batch } from './client.js';
import { nanoid } from 'nanoid';

export async function seedDemoFounder(): Promise<void> {
  console.log('🌱 Seeding demo founder with 6 months of realistic data...\n');

  const founderId = 'demo_founder_001';
  const productId = 'demo_product_001';
  const now = new Date();

  // ─── Founder ──────────────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO founders (id, clerk_user_id, email, name, tier, cohort_id, created_at, lifestyle_mode, lifestyle_target_mrr, country_code, local_currency, ppp_factor)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [founderId, 'demo_clerk_001', 'maya@labflow.app', 'Maya Okonkwo', 'founding_cohort', 'cohort_001',
     new Date(now.getTime() - 180 * 86400000).toISOString(), 0, null, 'US', 'USD', 1.0]
  );
  console.log('  ✓ Founder: Maya Okonkwo (LabFlow)');

  // ─── Product ──────────────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, stack_description, market_category, sector_profile, growth_stage, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, 'LabFlow', founderId, 'https://github.com/maya/labflow', 'maya', 'labflow',
     'TypeScript, Next.js, Prisma, Supabase', 'education', 'education', 'early_traction', 'active',
     new Date(now.getTime() - 180 * 86400000).toISOString()]
  );
  console.log('  ✓ Product: LabFlow (education SaaS)');

  // ─── Lifecycle State ──────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO lifecycle_state (product_id, current_prompt, risk_state, risk_state_reason, risk_state_changed_at,
       prompt_1_status, prompt_1_completed_at, prompt_1_composite, prompt_1_verdict,
       prompt_2_status, prompt_3_status, prompt_4_status, prompt_5_status, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, 'prompt_3', 'yellow',
     'Churn approaching new revenue. 2 elevated stressors.',
     new Date(now.getTime() - 7 * 86400000).toISOString(),
     'completed', new Date(now.getTime() - 150 * 86400000).toISOString(), 6.8, 'READY_WITH_CONDITIONS',
     'completed', 'in_progress', 'not_started', 'dormant',
     now.toISOString()]
  );
  console.log('  ✓ Lifecycle: Prompt 3, Yellow risk state');

  // ─── Product DNA ──────────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO product_dna (id, product_id, owner_id, icp_description, icp_pain, icp_trigger, positioning_statement, what_we_are_not, primary_objection, objection_response, market_insight, retention_hypothesis, completion_pct, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, founderId,
     'High school science department heads at public schools with 500+ students',
     'Lab inventory is tracked on paper. Safety compliance is manual. Experiment scheduling conflicts waste class time.',
     'New academic year, state audit upcoming, or a safety incident at another school',
     'LabFlow replaces the paper binder with a single screen. Know what you have, what expires, and what conflicts — before class starts.',
     'We are not a full LMS. We are not for universities. We do not replace teachers.',
     'Our budget is decided annually by the district. We can\'t do monthly payments.',
     'LabFlow works with annual PO billing cycles. No credit card required. Pricing is per-school, not per-seat.',
     'Education SaaS is won at conferences and lost at renewal. The decision maker (dept head) is not the budget holder (principal/district).',
     'Teachers who use LabFlow for experiment scheduling retain 3x better than those who only use inventory. The scheduling hook is the retention driver.',
     80, new Date(now.getTime() - 120 * 86400000).toISOString(), now.toISOString()]
  );
  console.log('  ✓ Product DNA: 80% complete');

  // ─── 6 Months of Metric Snapshots ─────────────────────────────────────────

  const metricHistory = [
    { daysAgo: 180, mrr: 0,    exp: 0,   churn: 0,   users: 3,  signups: 2,  activation: 0,   retention: 0,    churnRate: 0,    nps: null },
    { daysAgo: 150, mrr: 14700, exp: 0,   churn: 0,   users: 7,  signups: 5,  activation: 60,  retention: 100,  churnRate: 0,    nps: null },
    { daysAgo: 120, mrr: 24500, exp: 0,   churn: 0,   users: 14, signups: 8,  activation: 65,  retention: 85,   churnRate: 0,    nps: 60 },
    { daysAgo: 90,  mrr: 34300, exp: 4900, churn: 4900, users: 18, signups: 6, activation: 55,  retention: 78,   churnRate: 3.2,  nps: 55 },
    { daysAgo: 60,  mrr: 39200, exp: 9800, churn: 9800, users: 22, signups: 7, activation: 50,  retention: 72,   churnRate: 5.1,  nps: 48 },
    { daysAgo: 30,  mrr: 41650, exp: 4900, churn: 14700, users: 20, signups: 4, activation: 45, retention: 65,   churnRate: 7.8,  nps: 42 },
    { daysAgo: 7,   mrr: 39200, exp: 2450, churn: 12250, users: 19, signups: 3, activation: 42, retention: 60,   churnRate: 9.2,  nps: 38 },
  ];

  for (const m of metricHistory) {
    const date = new Date(now.getTime() - m.daysAgo * 86400000).toISOString().split('T')[0]!;
    const healthRatio = m.mrr > 0 ? m.churn / m.mrr : null;
    await query(
      `INSERT OR REPLACE INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, active_users, signups_7d, activation_rate, day_30_retention, churn_rate, nps_score, mrr_health_ratio, support_volume_7d)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, date, m.mrr, m.exp, 0, m.churn, m.users, m.signups, m.activation, m.retention, m.churnRate, m.nps, healthRatio, Math.floor(m.users * 0.3)]
    );
  }
  console.log('  ✓ Metric snapshots: 7 periods over 6 months');

  // ─── Audit Score ──────────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, findings, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, 'initial', 7, 6, 7, 8, 5, 4, 6, 5, 6, 7, 6.8, 'READY_WITH_CONDITIONS',
     JSON.stringify([
       { dimension: 'D5', dimension_number: 5, finding: 'No error monitoring in production', evidence: 'No Sentry/Datadog integration found', severity: 'major' },
       { dimension: 'D6', dimension_number: 6, finding: 'No billing system connected', evidence: 'District PO process is manual', severity: 'critical' },
       { dimension: 'D6', dimension_number: 6, finding: 'Pricing page missing', evidence: 'No /pricing route found', severity: 'major' },
       { dimension: 'D8', dimension_number: 8, finding: 'No competitive differentiation documented', evidence: 'Product DNA what_we_are_not is set but not reflected in marketing', severity: 'minor' },
     ]),
     new Date(now.getTime() - 150 * 86400000).toISOString()]
  );
  console.log('  ✓ Audit score: 6.8 READY_WITH_CONDITIONS');

  // ─── Competitors ──────────────────────────────────────────────────────────

  const competitors = [
    { name: 'Flinn Scientific', website: 'https://flinnsci.com', positioning: 'Legacy lab supplier with digital add-on', pricing: 'Per-seat annual', weaknesses: 'Slow, desktop-only, no scheduling' },
    { name: 'Labster', website: 'https://labster.com', positioning: 'Virtual lab simulations for higher ed', pricing: 'Per-student annual', weaknesses: 'Higher ed focused, no inventory management' },
    { name: 'ChemInventory', website: 'https://cheminventory.net', positioning: 'Chemical inventory management for research labs', pricing: 'Freemium', weaknesses: 'Research-focused, not K-12, no scheduling' },
  ];
  for (const c of competitors) {
    await query(
      `INSERT INTO competitors (id, product_id, name, website, positioning, pricing_model, known_weaknesses, monitoring_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [nanoid(), productId, c.name, c.website, c.positioning, c.pricing, c.weaknesses]
    );
  }
  console.log('  ✓ Competitors: 3 tracked');

  // ─── Active Stressors ─────────────────────────────────────────────────────

  await batch([
    {
      sql: `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status, risk_state_at_identification, identified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'yellow', ?)`,
      args: [nanoid(), productId, 'Churn approaching new revenue',
        'MRR Health Ratio at 0.85 — churn is 85% of new revenue', 60,
        'Investigate churn patterns by cohort. 3 schools cancelled citing "summer break" — may be seasonal.',
        'elevated', new Date(now.getTime() - 14 * 86400000).toISOString()],
    },
    {
      sql: `INSERT INTO stressor_history (id, product_id, stressor_name, signal, timeframe_days, neutralizing_action, severity, status, risk_state_at_identification, identified_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'active', 'yellow', ?)`,
      args: [nanoid(), productId, 'Activation rate erosion',
        'Activation rate dropped from 65% to 42% over 4 months', 45,
        'Audit onboarding funnel. Check if district-level IT restrictions block setup.',
        'elevated', new Date(now.getTime() - 7 * 86400000).toISOString()],
    },
  ]);
  console.log('  ✓ Stressors: 2 active (elevated)');

  // ─── Pending Decisions ────────────────────────────────────────────────────

  await batch([
    {
      sql: `INSERT INTO decisions (id, product_id, category, gate, what, why_now, context, recommendation, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [nanoid(), productId, 'strategic', 3,
        'Offer free summer access to prevent seasonal churn',
        'Three schools cancelled citing summer break. If seasonal churn is the pattern, free summer access could retain them for fall.',
        JSON.stringify([{ label: 'Schools churned', value: '3', source: 'stressor' }, { label: 'Reason cited', value: 'Summer break', source: 'support' }]),
        'Offer free June-August access for annual subscribers. The cost is zero (server costs negligible) and it prevents re-onboarding friction in fall.',
        now.toISOString()],
    },
    {
      sql: `INSERT INTO decisions (id, product_id, category, gate, what, why_now, context, recommendation, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [nanoid(), productId, 'product', 2,
        'Add district-level admin dashboard for principals',
        'Two principals asked for visibility into which teachers use LabFlow. This is the buyer persona — they control budget.',
        JSON.stringify([{ label: 'Principal requests', value: '2', source: 'support' }, { label: 'DNA insight', value: 'Decision maker != user', source: 'product_dna' }]),
        'Build a read-only admin view. Low effort, high signal — it aligns the buyer with the product.',
        now.toISOString()],
    },
    {
      sql: `INSERT INTO decisions (id, product_id, category, gate, what, why_now, context, recommendation, status, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      args: [nanoid(), productId, 'marketing', 1,
        'Submit to ISTE conference speaker track',
        'ISTE 2026 call for proposals closes in 3 weeks. Education SaaS is won at conferences.',
        JSON.stringify([{ label: 'Deadline', value: '3 weeks', source: 'calendar' }, { label: 'DNA insight', value: 'Won at conferences, lost at renewal', source: 'product_dna' }]),
        'Submit a talk on "Lab Safety Compliance Without Paper." It positions LabFlow as a compliance tool, not just scheduling.',
        now.toISOString()],
    },
  ]);
  console.log('  ✓ Decisions: 3 pending (Gate 1, 2, 3)');

  // ─── Cohorts ──────────────────────────────────────────────────────────────

  await batch([
    {
      sql: `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count, activated_count, retained_day_7, retained_day_14, retained_day_30, converted_to_paid, churned_count, mrr_contribution_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [nanoid(), productId, '2026-01', 'conference', 5, 4, 4, 4, 3, 3, 0, 14700],
    },
    {
      sql: `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count, activated_count, retained_day_7, retained_day_14, retained_day_30, converted_to_paid, churned_count, mrr_contribution_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [nanoid(), productId, '2026-02', 'referral', 8, 6, 5, 4, 3, 3, 2, 14700],
    },
    {
      sql: `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count, activated_count, retained_day_7, retained_day_14, retained_day_30, converted_to_paid, churned_count, mrr_contribution_cents)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [nanoid(), productId, '2026-03', 'cold_outreach', 6, 2, 2, 1, 1, 1, 3, 4900],
    },
  ]);
  console.log('  ✓ Cohorts: 3 monthly cohorts with retention data');

  // ─── Customers ────────────────────────────────────────────────────────────

  const customers = [
    { name: 'Lincoln High School', plan: 'annual', mrr: 9800, health: 90, churn: 0.05, champion: true, active: 2 },
    { name: 'Roosevelt STEM Academy', plan: 'annual', mrr: 9800, health: 85, churn: 0.08, champion: true, active: 3 },
    { name: 'MLK Science Dept', plan: 'annual', mrr: 4900, health: 72, churn: 0.15, champion: false, active: 5 },
    { name: 'Jefferson Academy', plan: 'annual', mrr: 4900, health: 55, churn: 0.40, champion: false, active: 12 },
    { name: 'Oakwood Prep', plan: 'trial', mrr: 0, health: 30, churn: 0.75, champion: false, active: 20 },
    { name: 'Riverside High', plan: 'annual', mrr: 4900, health: 25, churn: 0.80, champion: false, active: 30 },
  ];

  for (const c of customers) {
    await query(
      `INSERT INTO customers (id, product_id, owner_id, name, plan, mrr_cents, health_score, churn_risk, is_champion, last_active_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, founderId, c.name, c.plan, c.mrr, c.health, c.churn, c.champion ? 1 : 0,
       new Date(now.getTime() - c.active * 86400000).toISOString(),
       new Date(now.getTime() - 120 * 86400000).toISOString()]
    );
  }
  console.log('  ✓ Customers: 6 (2 champions, 2 at-risk, 1 trial, 1 churning)');

  // ─── Founder Health ───────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO founder_health (id, founder_id, personal_runway_months, weekly_hours_available, engagement_trend, motivation_score, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), founderId, 4.5, 45, 'declining', 52, now.toISOString()]
  );
  console.log('  ✓ Founder health: 4.5mo runway, declining engagement, motivation 52/100');

  // ─── Business Model ───────────────────────────────────────────────────────

  await query(
    `INSERT OR REPLACE INTO business_model_profile (id, product_id, owner_id, revenue_model, avg_cogs_per_customer, avg_cac, is_seasonal, seasonal_peak_months, seasonal_baseline_factor, services_revenue_percentage)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, founderId, 'subscription', 8, 250, 1, JSON.stringify([8, 9, 10, 11, 1, 2, 3, 4, 5]), 0.2, 15]
  );
  console.log('  ✓ Business model: subscription, seasonal (academic year), 15% services');

  // ─── Competitive Signal ───────────────────────────────────────────────────

  await query(
    `INSERT INTO competitive_signals (id, product_id, competitor_name, signal_type, signal_summary, significance, detected_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [nanoid(), productId, 'Flinn Scientific', 'feature_launch',
     'Flinn launched a digital inventory module as part of their existing catalog platform. Free for catalog customers.',
     'high', new Date(now.getTime() - 5 * 86400000).toISOString()]
  );
  console.log('  ✓ Competitive signal: Flinn launched inventory module (high significance)');

  console.log('\n✅ Demo seed complete!');
  console.log(`   Founder: maya@labflow.app`);
  console.log(`   Product: LabFlow (education SaaS, early_traction)`);
  console.log(`   State:   Yellow risk, 2 stressors, 3 pending decisions`);
  console.log(`   Story:   Former teacher, 6 schools, seasonal churn problem, competitor just moved\n`);
}
