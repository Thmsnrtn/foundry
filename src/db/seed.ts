// =============================================================================
// FOUNDRY — Database Seed Script
// Seeds the four founding products with migrated operational histories:
// 1. AcreOS (Product #1)
// 2. Apex Micro (Product #2)
// 3. Koldly (Product #3)
// 4. Foundry (Product #4 - self)
// =============================================================================

import { query, batch } from './client.js';
import { nanoid } from 'nanoid';

export async function seedDatabase(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    console.warn('[SEED] Refusing to seed in production. Skipping.');
    return;
  }
  console.log('[SEED] Seeding founding products (development only)...');

  // ─── Create Founder (you, the builder) ──────────────────────────────────────
  const founderId = nanoid();
  console.log(`Creating founder: ${founderId}`);
  
  await query(
    `INSERT OR IGNORE INTO founders (id, clerk_user_id, email, name, tier, cohort_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      founderId,
      'dev_founder_001',
      'builder@foundry.dev',
      'Builder',
      'investor_ready',
      null,
      new Date('2026-01-01').toISOString(),
    ]
  );

  // ─── Product 1: AcreOS ───────────────────────────────────────────────────────
  const acreosId = nanoid();
  console.log(`Creating AcreOS: ${acreosId}`);
  
  await batch([
    {
      sql: `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, stack_description, market_category, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        acreosId,
        'AcreOS',
        founderId,
        'https://github.com/user/AcreOS',
        'user',
        'AcreOS',
        'TypeScript, React, Hono, Turso',
        'developer_tools',
        new Date('2025-09-01').toISOString(),
        'active',
      ],
    },
    {
      sql: `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state, risk_state_changed_at, risk_state_reason, prompt_1_status, prompt_1_completed_at, prompt_1_verdict, prompt_1_composite)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        acreosId,
        'prompt_4',
        'green',
        new Date('2025-10-15').toISOString(),
        'Product launched successfully, initial metrics stable',
        'completed',
        new Date('2025-09-15').toISOString(),
        'READY',
        7.2,
      ],
    },
  ]);

  // AcreOS Phase 2 baseline audit (before remediation)
  await query(
    `INSERT INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      acreosId,
      'initial',
      5, 6, 5, 6, 4, 5, 4, 6, 4, 3,
      4.8,
      'NOT READY',
      new Date('2025-09-05').toISOString(),
    ]
  );

  // AcreOS post-remediation audit
  await query(
    `INSERT INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      acreosId,
      'post_remediation',
      8, 7, 7, 8, 7, 7, 6, 7, 7, 6,
      7.2,
      'READY',
      new Date('2025-09-15').toISOString(),
    ]
  );

  // AcreOS founding story artifact - ecosystem connection
  await query(
    `INSERT INTO founding_story_artifacts (id, product_id, phase, artifact_type, title, content, created_at, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      acreosId,
      'prompt_1',
      'audit',
      'AcreOS Audit Journey: 4.8 → 7.2',
      JSON.stringify({
        initial_score: 4.8,
        final_score: 7.2,
        blocking_issues_resolved: 12,
        time_to_ready: '10 days',
      }),
      new Date('2025-09-15').toISOString(),
      false,
    ]
  );

  // AcreOS recent metrics
  const acreosMetricsDate = new Date();
  acreosMetricsDate.setDate(acreosMetricsDate.getDate() - 1);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, activation_rate, day_30_retention, mrr_health_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      acreosId,
      acreosMetricsDate.toISOString().split('T')[0],
      28,
      145,
      12900, // $129
      8500,  // $85
      0,
      3200,  // $32
      0.38,
      0.71,
      0.25,  // Healthy: churned/new = 0.25
    ]
  );

  // AcreOS cohort
  await query(
    `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count, activated_count, retained_day_30, retained_day_60, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      acreosId,
      '2025-10-01',
      'organic',
      42,
      31,
      28,
      25,
      new Date('2025-10-01').toISOString(),
    ]
  );

  // ─── Product 2: Apex Micro ───────────────────────────────────────────────────
  const apexMicroId = nanoid();
  console.log(`Creating Apex Micro: ${apexMicroId}`);
  
  await batch([
    {
      sql: `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, stack_description, market_category, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        apexMicroId,
        'Apex Micro',
        founderId,
        'https://github.com/user/apex-micro',
        'user',
        'apex-micro',
        'TypeScript, Bun, Hono, Upstash Redis',
        'api_tools',
        new Date('2025-08-15').toISOString(),
        'active',
      ],
    },
    {
      sql: `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state, risk_state_changed_at, risk_state_reason, prompt_1_status, prompt_1_completed_at, prompt_1_verdict, prompt_1_composite)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        apexMicroId,
        'prompt_5',
        'green',
        new Date('2025-11-01').toISOString(),
        'Steady growth, no stressors detected',
        'completed',
        new Date('2025-08-28').toISOString(),
        'READY',
        7.4,
      ],
    },
  ]);

  // Apex Micro audit history
  await query(
    `INSERT INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      apexMicroId,
      'post_remediation',
      8, 8, 7, 7, 8, 7, 7, 7, 7, 7,
      7.4,
      'READY',
      new Date('2025-08-28').toISOString(),
    ]
  );

  // Apex Micro recent metrics
  const apexMetricsDate = new Date();
  apexMetricsDate.setDate(apexMetricsDate.getDate() - 1);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, activation_rate, day_30_retention, mrr_health_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      apexMicroId,
      apexMetricsDate.toISOString().split('T')[0],
      35,
      220,
      18700, // $187
      12300, // $123
      4100,  // $41
      5900,  // $59
      0.42,
      0.68,
      0.32,  // Healthy: churned/new = 0.32
    ]
  );

  // Apex Micro decision pattern (retrospective)
  await query(
    `INSERT INTO decision_patterns (id, decision_type, product_lifecycle_stage, risk_state_at_decision, key_metrics_context, option_chosen_category, outcome_direction, outcome_magnitude, outcome_timeframe_days, market_category, scenario_accuracy_score, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      'pricing_change',
      'prompt_4',
      'green',
      JSON.stringify({ mrr_range: '10k-50k', retention_range: '60-70' }),
      'increase_tier_pricing',
      'positive',
      'moderate',
      30,
      'api_tools',
      0.78,
      new Date('2025-10-15').toISOString(),
    ]
  );

  // ─── Product 3: Koldly ───────────────────────────────────────────────────────
  const koldlyId = nanoid();
  console.log(`Creating Koldly: ${koldlyId}`);
  
  await batch([
    {
      sql: `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, stack_description, market_category, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        koldlyId,
        'Koldly',
        founderId,
        'https://github.com/user/koldly',
        'user',
        'koldly',
        'TypeScript, Next.js, Vercel Postgres',
        'outbound_sales',
        new Date('2025-07-01').toISOString(),
        'active',
      ],
    },
    {
      sql: `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state, risk_state_changed_at, risk_state_reason, prompt_1_status, prompt_1_completed_at, prompt_1_verdict, prompt_1_composite)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        koldlyId,
        'prompt_6',
        'green',
        new Date('2025-12-01').toISOString(),
        'Post-launch growth phase',
        'completed',
        new Date('2025-07-20').toISOString(),
        'READY',
        7.0,
      ],
    },
  ]);

  // Koldly audit
  await query(
    `INSERT INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      koldlyId,
      'post_remediation',
      7, 7, 7, 7, 7, 7, 7, 7, 7, 7,
      7.0,
      'READY',
      new Date('2025-07-20').toISOString(),
    ]
  );

  // Koldly recent metrics
  const koldlyMetricsDate = new Date();
  koldlyMetricsDate.setDate(koldlyMetricsDate.getDate() - 1);
  await query(
    `INSERT INTO metric_snapshots (id, product_id, snapshot_date, signups_7d, active_users, new_mrr_cents, expansion_mrr_cents, contraction_mrr_cents, churned_mrr_cents, activation_rate, day_30_retention, mrr_health_ratio)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      koldlyId,
      koldlyMetricsDate.toISOString().split('T')[0],
      52,
      310,
      29900, // $299
      15700, // $157
      8200,  // $82
      12100, // $121
      0.45,
      0.74,
      0.40,  // Elevated but acceptable: churned/new = 0.40
    ]
  );

  // Koldly cohorts (two cohorts for comparison)
  await batch([
    {
      sql: `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count, activated_count, retained_day_30, retained_day_60, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        nanoid(),
        koldlyId,
        '2025-11-01',
        'founding_cohort',
        30,
        28,
        26,
        24,
        new Date('2025-11-01').toISOString(),
      ],
    },
    {
      sql: `INSERT INTO cohorts (id, product_id, acquisition_period, acquisition_channel, founder_count, activated_count, retained_day_30, retained_day_60, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        nanoid(),
        koldlyId,
        '2025-12-01',
        'organic',
        45,
        38,
        32,
        28,
        new Date('2025-12-01').toISOString(),
      ],
    },
  ]);

  // ─── Product 4: Foundry (Self) ───────────────────────────────────────────────
  const foundryId = nanoid();
  console.log(`Creating Foundry (self): ${foundryId}`);
  
  await batch([
    {
      sql: `INSERT INTO products (id, name, owner_id, github_repo_url, github_repo_owner, github_repo_name, stack_description, market_category, created_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        foundryId,
        'Foundry',
        founderId,
        'https://github.com/user/foundry',
        'user',
        'foundry',
        'TypeScript, Hono, Turso, Claude',
        'business_intelligence',
        new Date('2026-01-01').toISOString(),
        'active',
      ],
    },
    {
      sql: `INSERT INTO lifecycle_state (product_id, current_prompt, risk_state, risk_state_changed_at, risk_state_reason, prompt_1_status, prompt_1_composite)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [
        foundryId,
        'prompt_1',
        'green',
        new Date().toISOString(),
        'Initial state - Cold Start Mode active',
        'in_progress',
        null,
      ],
    },
  ]);

  // Foundry Phase 2 baseline (from handoff doc Section 23)
  await query(
    `INSERT INTO audit_scores (id, product_id, run_type, d1_score, d2_score, d3_score, d4_score, d5_score, d6_score, d7_score, d8_score, d9_score, d10_score, composite, verdict, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      foundryId,
      'initial',
      5, 6, 5, 6, 3, 4, 4, 6, 4, 3,
      4.6,
      'NOT READY',
      new Date('2026-02-01').toISOString(),
    ]
  );

  // Foundry ecosystem connection artifact
  await query(
    `INSERT INTO founding_story_artifacts (id, product_id, phase, artifact_type, title, content, created_at, published)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      foundryId,
      'initialization',
      'ecosystem_connection',
      'Ecosystem Connection: Four Products, Day One',
      JSON.stringify({
        narrative: 'Foundry launches governing four products from its first deployment: AcreOS, Apex Micro, Koldly, and itself. Their existing metric histories, audit records, and lifecycle states migrated as founding data. Intelligence layers start with non-zero knowledge.',
        products_connected: ['AcreOS', 'Apex Micro', 'Koldly', 'Foundry'],
        connection_date: new Date().toISOString(),
      }),
      new Date().toISOString(),
      false,
    ]
  );

  // ─── Competitor Seeding ──────────────────────────────────────────────────────
  // Seed competitors for each product
  await batch([
    {
      sql: `INSERT INTO competitors (id, product_id, name, website, positioning, monitoring_active)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [nanoid(), acreosId, 'OperatorHQ', 'https://operatorhq.example', 'No-code business operations platform', true],
    },
    {
      sql: `INSERT INTO competitors (id, product_id, name, website, positioning, monitoring_active)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [nanoid(), apexMicroId, 'MicroAPI', 'https://microapi.example', 'API-first microservices toolkit', true],
    },
    {
      sql: `INSERT INTO competitors (id, product_id, name, website, positioning, monitoring_active)
            VALUES (?, ?, ?, ?, ?, ?)`,
      args: [nanoid(), koldlyId, 'SalesFlow', 'https://salesflow.example', 'AI-powered outbound automation', true],
    },
  ]);

  console.log('✅ Seed complete!');
  console.log('');
  console.log('Founding Products:');
  console.log(`  AcreOS:      ${acreosId}`);
  console.log(`  Apex Micro:  ${apexMicroId}`);
  console.log(`  Koldly:      ${koldlyId}`);
  console.log(`  Foundry:     ${foundryId}`);
  console.log('');
  console.log(`Founder ID:  ${founderId}`);
}
