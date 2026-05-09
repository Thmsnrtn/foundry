// =============================================================================
// FOUNDRY — CLI Tool
// Usage: tsx src/cli/index.ts <command>
// =============================================================================

import { Command } from 'commander';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { executeRaw, query } from '../db/client.js';
import { JOB_REGISTRY } from '../jobs/index.js';
import { getProductDNA } from '../services/wisdom/dna.js';
import { synthesizeJudgmentPatterns } from '../services/wisdom/patterns.js';
import { getRemediationStats } from '../services/audit/remediation.js';
import { remediationOutcomeCheck } from '../jobs/index.js';
import { nanoid } from 'nanoid';

const __dirname = dirname(fileURLToPath(import.meta.url));
const program = new Command();

program.name('foundry').description('Foundry CLI').version('0.1.0');

// ─── Database Migration ──────────────────────────────────────────────────────
program
  .command('db:migrate')
  .description('Run all database migrations')
  .action(async () => {
    console.log('Running migrations...');
    const migrations = [
      '001_initial.sql', '002_wisdom_remediation.sql', '003_ux_intelligence.sql',
      '004_sector_profiles.sql', '004_signal_wisdom.sql', '005_growth_stages.sql', '005_signal_history.sql',
      '006_founder_health.sql', '006_intelligence_layer.sql', '007_lifestyle_mode.sql', '007_operating_plan.sql',
      '008_non_code_track.sql', '009_marketplace_intelligence.sql', '010_cofounder_alignment.sql', '011_global_support.sql',
      '012_business_model.sql', '013_regulatory_intelligence.sql', '014_competitive_v2.sql', '015_value_delivery.sql',
      '016_founder_psychology.sql', '017_expansion_advisor.sql', '018_wisdom_network.sql', '019_ethical_ai.sql',
      '020_conversational_coo.sql', '021_data_ingestion.sql', '022_action_execution.sql', '023_predictive_intelligence.sql',
      '024_founder_network.sql', '025_ai_calibration.sql', '026_financial_simulator.sql',
      '027_customer_intelligence.sql', '028_growth_experiments.sql', '029_event_bus.sql',
      '030_investor_automation.sql', '031_voice_coo.sql', '032_knowledge_graph.sql', '033_portfolio_mode.sql',
    ];
    for (const file of migrations) {
      console.log(`  Running ${file}...`);
      // In production (dist/cli/), migrations are at ../../src/db/migrations
      // In development (src/cli/), migrations are at ../db/migrations
      let filePath = resolve(__dirname, '../db/migrations', file);
      try { readFileSync(filePath); } catch {
        filePath = resolve(__dirname, '../../src/db/migrations', file);
      }
      const sql = readFileSync(filePath, 'utf-8');
      // Split on statement-ending semicolons
      const statements = sql
        .split(/;\s*\n/)
        .map(s => s.replace(/--[^\n]*/g, '').trim())
        .filter(s => s.length > 0);
      for (const stmt of statements) {
        try {
          await query(stmt, []);
        } catch (e: any) {
          // ALTER TABLE ADD COLUMN fails if column already exists — that's fine
          if (stmt.toUpperCase().includes('ALTER TABLE') && e?.message?.includes('duplicate column')) {
            continue;
          }
          throw e;
        }
      }
    }
    console.log('Migrations complete.');
  });

// ─── Database Seed ───────────────────────────────────────────────────────────
program
  .command('db:seed')
  .description('Seed database with founding products (AcreOS, Apex Micro, Koldly, Foundry)')
  .action(async () => {
    const { seedDatabase } = await import('../db/seed.js');
    await seedDatabase();
  });

// ─── Demo Seed ──────────────────────────────────────────────────────────────
program
  .command('db:seed-demo')
  .description('Seed a realistic demo founder (Maya / LabFlow) with 6 months of data')
  .action(async () => {
    const { seedDemoFounder } = await import('../db/seed-demo.js');
    await seedDemoFounder();
  });

// ─── Run Job ─────────────────────────────────────────────────────────────────
program
  .command('job:run <name>')
  .description('Run a specific scheduled job')
  .action(async (name: string) => {
    const job = JOB_REGISTRY[name];
    if (!job) {
      console.error(`Unknown job: ${name}`);
      console.log('Available jobs:', Object.keys(JOB_REGISTRY).join(', '));
      process.exit(1);
    }
    console.log(`Running job: ${name} — ${job.description}`);
    const start = Date.now();
    await job.fn();
    console.log(`Job ${name} completed in ${Date.now() - start}ms`);
  });

// ─── List Jobs ───────────────────────────────────────────────────────────────
program
  .command('job:list')
  .description('List all scheduled jobs')
  .action(() => {
    console.log('\nScheduled Jobs:');
    console.log('─'.repeat(80));
    for (const [name, job] of Object.entries(JOB_REGISTRY)) {
      console.log(`  ${name.padEnd(25)} ${job.schedule.padEnd(20)} ${job.description}`);
    }
    console.log('');
  });

// ─── Database Status ─────────────────────────────────────────────────────────
program
  .command('db:status')
  .description('Show database table row counts')
  .action(async () => {
    const tables = [
      'founders', 'products', 'lifecycle_state', 'audit_scores', 'decisions',
      'audit_log', 'beta_intake', 'lifecycle_conditions', 'founding_story_artifacts',
      'metric_snapshots', 'stressor_history', 'scenario_models', 'decision_patterns',
      'cohorts', 'competitors', 'competitive_signals',
      'product_dna', 'failure_log', 'founder_judgment_patterns', 'remediation_prs',
    ];
    console.log('\nDatabase Status:');
    console.log('─'.repeat(40));
    for (const table of tables) {
      try {
        const result = await query(`SELECT COUNT(*) as c FROM ${table}`, []);
        const count = (result.rows[0] as Record<string, number>)?.c ?? 0;
        console.log(`  ${table.padEnd(30)} ${count}`);
      } catch {
        console.log(`  ${table.padEnd(30)} (not created)`);
      }
    }
    console.log('');
  });

// ─── Product Status ──────────────────────────────────────────────────────────
program
  .command('product:status <productId>')
  .description('Show full product status')
  .action(async (productId: string) => {
    const product = await query('SELECT * FROM products WHERE id = ?', [productId]);
    if (product.rows.length === 0) { console.error('Product not found'); return; }
    const p = product.rows[0] as Record<string, unknown>;
    const ls = await query('SELECT * FROM lifecycle_state WHERE product_id = ?', [productId]);
    const lsRow = ls.rows[0] as Record<string, unknown>;
    const stressors = await query("SELECT * FROM stressor_history WHERE product_id = ? AND status = 'active'", [productId]);
    const decisions = await query("SELECT * FROM decisions WHERE product_id = ? AND status = 'pending'", [productId]);

    console.log(`\nProduct: ${p.name}`);
    console.log(`Risk State: ${lsRow?.risk_state ?? 'unknown'}`);
    console.log(`Current Prompt: ${lsRow?.current_prompt ?? 'unknown'}`);
    console.log(`Active Stressors: ${stressors.rows.length}`);
    console.log(`Pending Decisions: ${decisions.rows.length}`);
  });

// ─── Wisdom Commands ─────────────────────────────────────────────────────────
program
  .command('wisdom:status <productId>')
  .description('Show wisdom layer status for a product')
  .action(async (productId: string) => {
    const dna = await getProductDNA(productId);
    const ls = await query('SELECT wisdom_layer_active, dna_completion_pct FROM lifecycle_state WHERE product_id = ?', [productId]);
    const lsRow = ls.rows[0] as Record<string, unknown> | undefined;
    const patterns = await query('SELECT COUNT(*) as cnt FROM founder_judgment_patterns WHERE product_id = ? AND invalidated = 0', [productId]);
    const failures = await query('SELECT COUNT(*) as cnt FROM failure_log WHERE product_id = ?', [productId]);

    console.log(`\nWisdom Layer Status:`);
    console.log(`  DNA Completion: ${dna?.completion_pct ?? 0}%`);
    console.log(`  Wisdom Active:  ${(lsRow?.wisdom_layer_active as number) === 1 ? 'YES' : 'NO'}`);
    console.log(`  Patterns:       ${(patterns.rows[0] as Record<string, number>)?.cnt ?? 0}`);
    console.log(`  Failures:       ${(failures.rows[0] as Record<string, number>)?.cnt ?? 0}`);
    if (dna) {
      const sections = ['icp_description', 'icp_pain', 'icp_trigger', 'icp_sophistication', 'positioning_statement', 'what_we_are_not', 'primary_objection', 'objection_response', 'market_insight', 'retention_hypothesis'];
      const filled = sections.filter((s) => (dna as any)[s]);
      console.log(`  Filled Sections: ${filled.join(', ') || 'none'}`);
    }
  });

program
  .command('wisdom:patterns <productId>')
  .description('List judgment patterns for a product')
  .action(async (productId: string) => {
    const result = await query('SELECT * FROM founder_judgment_patterns WHERE product_id = ? ORDER BY confidence DESC', [productId]);
    if (result.rows.length === 0) { console.log('No patterns found.'); return; }
    console.log(`\nJudgment Patterns (${result.rows.length}):`);
    for (const row of result.rows) {
      const p = row as Record<string, unknown>;
      console.log(`  [${p.category}] ${p.pattern_description}`);
      console.log(`    Confidence: ${((p.confidence as number) * 100).toFixed(0)}% · Observed: ${p.times_observed}× · Invalidated: ${p.invalidated ? 'YES' : 'NO'}`);
    }
  });

program
  .command('wisdom:synthesize <productId>')
  .description('Run pattern synthesis for a product')
  .action(async (productId: string) => {
    const product = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
    if (product.rows.length === 0) { console.error('Product not found'); return; }
    const ownerId = (product.rows[0] as Record<string, string>).owner_id;
    console.log('Synthesizing judgment patterns...');
    await synthesizeJudgmentPatterns(productId, ownerId);
    console.log('Pattern synthesis complete.');
  });

program
  .command('wisdom:failures <productId>')
  .description('List failure log for a product')
  .action(async (productId: string) => {
    const result = await query('SELECT * FROM failure_log WHERE product_id = ? ORDER BY created_at DESC', [productId]);
    if (result.rows.length === 0) { console.log('No failures logged.'); return; }
    console.log(`\nFailure Log (${result.rows.length}):`);
    for (const row of result.rows) {
      const f = row as Record<string, unknown>;
      console.log(`  [${f.category}] ${f.what_was_tried}`);
      console.log(`    Outcome: ${f.outcome}`);
      if (f.founder_hypothesis) console.log(`    Hypothesis: ${f.founder_hypothesis}`);
      console.log(`    Logged: ${f.created_at}`);
    }
  });

// ─── Remediation Commands ────────────────────────────────────────────────────
program
  .command('audit:remediate <productId>')
  .option('--issue <issueId>', 'Remediate a specific blocking issue')
  .description('Run remediation for latest audit')
  .action(async (productId: string, opts: { issue?: string }) => {
    const { runAudit } = await import('../services/audit/engine.js');
    const product = await query('SELECT * FROM products WHERE id = ?', [productId]);
    if (product.rows.length === 0) { console.error('Product not found'); return; }
    const p = product.rows[0] as Record<string, unknown>;

    console.log(`Running post-remediation audit for ${p.name}...`);
    const audit = await runAudit({
      id: p.id as string, name: p.name as string, owner_id: p.owner_id as string,
      github_repo_url: p.github_repo_url as string | null,
      github_repo_owner: p.github_repo_owner as string | null,
      github_repo_name: p.github_repo_name as string | null,
      github_access_token: p.github_access_token as string | null,
      stack_description: null, market_category: null,
      created_at: p.created_at as string, updated_at: p.updated_at as string,
      status: 'active',
      sector_profile: 'b2b_saas', growth_stage: 'pre_launch',
      growth_stage_updated_at: null, growth_stage_overridden: false,
    }, 'post_remediation');
    console.log(`Audit complete. Composite: ${audit.composite?.toFixed(1)}, Verdict: ${audit.verdict}`);
  });

program
  .command('remediation:status <productId>')
  .description('Show remediation PR status for a product')
  .action(async (productId: string) => {
    const stats = await getRemediationStats(productId);
    const prs = await query('SELECT * FROM remediation_prs WHERE product_id = ? ORDER BY created_at DESC', [productId]);

    console.log(`\nRemediation Status:`);
    console.log(`  Total Issues:      ${stats.total_issues}`);
    console.log(`  Auto:              ${stats.auto_count}`);
    console.log(`  Wisdom Required:   ${stats.wisdom_required_count}`);
    console.log(`  Human Only:        ${stats.human_only_count}`);
    console.log(`  PRs Open:          ${stats.prs_open}`);
    console.log(`  PRs Merged:        ${stats.prs_merged}`);
    if (prs.rows.length > 0) {
      console.log(`\n  Recent PRs:`);
      for (const row of prs.rows) {
        const pr = row as Record<string, unknown>;
        console.log(`    ${pr.blocking_issue_id} [${pr.status}] ${pr.fix_summary ?? pr.blocking_issue_summary}`);
        if (pr.github_pr_url) console.log(`      ${pr.github_pr_url}`);
      }
    }
  });

program
  .command('remediation:check')
  .description('Run remediation outcome check (check PR merge status)')
  .action(async () => {
    console.log('Running remediation outcome check...');
    await remediationOutcomeCheck();
    console.log('Outcome check complete.');
  });

// ─── UX Intelligence Commands ────────────────────────────────────────────────
program
  .command('ux:milestones <productId>')
  .description('List all milestones for a product')
  .action(async (productId: string) => {
    const result = await query(
      'SELECT * FROM milestone_events WHERE product_id = ? ORDER BY created_at DESC',
      [productId],
    );
    if (result.rows.length === 0) { console.log('No milestones awarded yet.'); return; }
    console.log(`\nMilestones (${result.rows.length}):`);
    for (const row of result.rows) {
      const m = row as Record<string, unknown>;
      const seen = m.seen_at ? '✓' : '●';
      console.log(`  ${seen} ${m.milestone_title} — ${m.milestone_description}`);
      console.log(`    Awarded: ${m.created_at}${m.seen_at ? ` · Seen: ${m.seen_at}` : ''}`);
    }
  });

program
  .command('ux:next-action <founderId> <productId>')
  .description('Show the current "Your Move" action for a founder')
  .action(async (founderId: string, productId: string) => {
    const { getNextAction } = await import('../services/ux/next-action.js');
    const founderResult = await query('SELECT * FROM founders WHERE id = ?', [founderId]);
    if (founderResult.rows.length === 0) { console.error('Founder not found'); return; }
    const founder = founderResult.rows[0] as unknown as import('../types/index.js').Founder;
    const action = await getNextAction(founder, productId);
    if (!action) { console.log('No action — everything is operating normally.'); return; }
    console.log(`\nYour Move [${action.urgency.toUpperCase()}]:`);
    console.log(`  ${action.headline}`);
    console.log(`  ${action.subtext}`);
    if (action.action_url) console.log(`  → ${action.action_url} (${action.action_label})`);
  });

program
  .command('ux:check-milestones <productId>')
  .description('Run milestone checks for a product and award any new milestones')
  .action(async (productId: string) => {
    const { checkAndAwardMilestones } = await import('../services/ux/milestones.js');
    const product = await query('SELECT owner_id FROM products WHERE id = ?', [productId]);
    if (product.rows.length === 0) { console.error('Product not found'); return; }
    const ownerId = (product.rows[0] as Record<string, string>).owner_id;
    console.log('Checking milestones...');
    const awarded = await checkAndAwardMilestones(productId, ownerId);
    if (awarded.length === 0) {
      console.log('No new milestones.');
    } else {
      console.log(`Awarded ${awarded.length} milestones:`);
      for (const m of awarded) {
        console.log(`  🏆 ${m.milestone_title}`);
      }
    }
  });

program
  .command('ux:gate <founderId> <featureKey>')
  .description('Check if a founder can access a feature')
  .action(async (founderId: string, featureKey: string) => {
    const { canAccess, getTierBadge, FEATURE_GATES } = await import('../middleware/tier-gate.js');
    const founderResult = await query('SELECT * FROM founders WHERE id = ?', [founderId]);
    if (founderResult.rows.length === 0) { console.error('Founder not found'); return; }
    const founder = founderResult.rows[0] as unknown as import('../types/index.js').Founder;
    const gate = FEATURE_GATES[featureKey];
    const hasAccess = canAccess(founder, featureKey);
    console.log(`\nFeature Gate Check:`);
    console.log(`  Feature: ${gate?.name ?? featureKey}`);
    console.log(`  Founder Tier: ${getTierBadge(founder.tier)}`);
    console.log(`  Required Tiers: ${gate?.requiredTier.join(', ') ?? 'unknown'}`);
    console.log(`  Access: ${hasAccess ? '✓ ALLOWED' : '✗ DENIED'}`);
  });

program
  .command('ux:notifications <founderId>')
  .description('List unread notifications for a founder')
  .action(async (founderId: string) => {
    const { getUnreadNotifications, getUnreadCount } = await import('../services/ux/notifications.js');
    const count = await getUnreadCount(founderId);
    const notifications = await getUnreadNotifications(founderId);
    console.log(`\nUnread Notifications (${count}):`);
    if (notifications.length === 0) { console.log('  No unread notifications.'); return; }
    for (const n of notifications) {
      console.log(`  ${n.type === 'milestone' ? '🏆' : '🔔'} ${n.title}`);
      console.log(`    ${n.body}`);
      if (n.action_url) console.log(`    → ${n.action_url}`);
    }
  });

// ─── Dogfood: seed Foundry's own North Star + voice fingerprint ──────────────
//
// Persona review Cluster A (PG, Butterfield, Cagan, Maples, Chesky) all said
// the same thing: dogfood the product before adding to it. The disciplines
// shipped in V3.1 (North Star, voice gate) need seed data to operate. This
// command idempotently seeds sensible defaults derived from the existing
// docs/audits/narrow-launch-readiness.md (5 friendly alpha founders) and
// the codebase voice that's already evident in commit messages and
// CONTRIBUTING.md (terse, plainspoken, judgment-first).
//
// Usage: foundry seed:dogfood <productId>
//
// Re-running is safe: upserts the North Star, only creates a fingerprint if
// none is currently active.
program
  .command('seed:dogfood <productId>')
  .description("Seed Foundry's own North Star and voice fingerprint with sensible defaults")
  .action(async (productId: string) => {
    const productCheck = await query('SELECT id, name FROM products WHERE id = ?', [productId]);
    if (productCheck.rows.length === 0) {
      console.error(`Product ${productId} not found.`);
      process.exit(1);
    }
    const productName = (productCheck.rows[0] as Record<string, string>).name;

    const { upsertNorthStar, getNorthStar } = await import('../services/destination/north-star.js');
    const { getActiveFingerprint, createDraftFingerprint, activateFingerprint } = await import(
      '../services/calibration/voice-fingerprint.js'
    );

    // North Star — narrow-launch-readiness.md targets 5 friendly alpha
    // founders. ARR target is conservative: 5 × $199 (Growth tier) × 12 months.
    // Adjust target_date to ~13 weeks from now.
    const targetDate = new Date(Date.now() + 91 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);

    const ns = await upsertNorthStar(productId, {
      arr_target_dollars: 11_940, // 5 × $199 × 12
      paying_accounts_target: 5,
      nrr_floor_pct: 80,
      target_date: targetDate,
      destination_summary:
        '5 paying alpha founders by end of Q3 — proven friendly-alpha narrow positioning before scaling.',
    });
    console.log(`North Star seeded for ${productName}:`);
    console.log(`  ARR target:      $${ns.arr_target_dollars?.toLocaleString()} by ${ns.target_date}`);
    console.log(`  Paying accounts: ${ns.paying_accounts_target}`);
    console.log(`  NRR floor:       ${ns.nrr_floor_pct}%`);
    console.log(`  Summary:         ${ns.destination_summary}`);

    // Voice fingerprint — only seed if none is active.
    const existing = await getActiveFingerprint(productId);
    if (existing) {
      console.log(`\nVoice fingerprint already active (version ${existing.version}). Skipping.`);
    } else {
      // Defaults derived from the codebase's own voice: docs/CONTRIBUTING.md,
      // commit messages, the 18-persona review. Founder editable later.
      const fp = await createDraftFingerprint(productId, {
        register: 'plainspoken',
        energy: 'measured',
        pov: 'second-person operator',
        sentence_rhythm: 'short and direct; one idea per sentence; resist multi-clause hedging',
        lexical_preferences: [
          'specific over abstract',
          'verbs over nouns',
          'concrete numbers over vague qualifiers',
        ],
        banned_words: [
          'leverage',
          'synergy',
          'game-changer',
          'paradigm',
          'unleash',
          'cutting-edge',
          'world-class',
          'best-in-class',
          'transform your business',
          'next-generation',
        ],
        anti_exemplars: [
          'We leverage cutting-edge AI to transform your business operations.',
          'Foundry is a best-in-class, world-class operating system.',
          'Unleash the power of next-generation autonomous agents.',
        ],
        exemplar_sentences: [
          'Foundry runs a small council of AI agents on your repo and tells you one thing to do each morning.',
          "Built for solo SaaS founders running one to five products. Single founder, full team.",
          'You set the pace. They earn the trust.',
          "The product is more built than it is used; the leverage this month is in dogfooding.",
          'Run your SaaS like there is a team behind it.',
          'Decisions, not noise.',
          "Agents that prove themselves earn autonomy.",
        ],
        source: 'founder',
        notes:
          'Initial dogfood seed. Calibrate against actual artifacts via taste journal once you have a few weeks of usage.',
      });
      await activateFingerprint(fp.id);
      console.log(`\nVoice fingerprint seeded and activated (version ${fp.version}):`);
      console.log(`  Register:           ${fp.register}`);
      console.log(`  Energy:             ${fp.energy}`);
      console.log(`  Banned words:       ${fp.banned_words.length}`);
      console.log(`  Exemplar sentences: ${fp.exemplar_sentences.length}`);
    }

    console.log('\nDone. Run the briefing to see the destination block in action:');
    console.log(`  foundry job:run scp_daily_briefing`);
  });

// ─── Preflight: pre-deploy readiness check ───────────────────────────────────
//
// Replaces the ad-hoc 'manual end-to-end run' from
// docs/audits/pre-alpha-readiness-2026-05-08.md with a repeatable check.
// Run this against a production-like environment (Fly secrets imported,
// Turso URL pointing at the prod DB, etc.) before sending alpha invites.
//
// Each check is one of:
//   ok    — passes
//   warn  — non-blocking concern (degraded feature)
//   fail  — blocking — fix before deploy
//
// Exits 1 if any check fails. Exits 0 if only warnings or all-ok.

interface PreflightCheck {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

program
  .command('preflight')
  .description('Pre-deploy readiness check: env vars, DB, migrations, secrets')
  .action(async () => {
    const checks: PreflightCheck[] = [];

    // 1. Required env vars — must be present.
    const requiredEnv = ['TURSO_DATABASE_URL', 'CLERK_SECRET_KEY', 'CLERK_PUBLISHABLE_KEY'];
    for (const v of requiredEnv) {
      checks.push(
        process.env[v]
          ? { name: `env: ${v}`, status: 'ok', detail: 'set' }
          : { name: `env: ${v}`, status: 'fail', detail: 'missing — app will not start' }
      );
    }

    // 2. Critical optional env vars.
    const opt: Array<{ name: string; reason: string }> = [
      { name: 'ENCRYPTION_KEY', reason: 'integration credentials encryption' },
      { name: 'OPENROUTER_API_KEY', reason: 'primary AI provider' },
      { name: 'STRIPE_WEBHOOK_SECRET', reason: 'billing webhook verification' },
      { name: 'CLERK_WEBHOOK_SECRET', reason: 'auth webhook verification' },
      { name: 'RESEND_API_KEY', reason: 'outbound email' },
    ];
    for (const v of opt) {
      checks.push(
        process.env[v.name]
          ? { name: `env: ${v.name}`, status: 'ok', detail: 'set' }
          : { name: `env: ${v.name}`, status: 'warn', detail: `${v.reason} disabled without this` }
      );
    }

    // 3. ENCRYPTION_KEY format.
    const ek = process.env.ENCRYPTION_KEY;
    if (ek) {
      const isValid = ek.length === 64 && /^[0-9a-f]+$/i.test(ek);
      checks.push({
        name: 'ENCRYPTION_KEY format',
        status: isValid ? 'ok' : 'fail',
        detail: isValid
          ? '64 hex chars (32 bytes)'
          : `expected 64 hex chars, got ${ek.length} chars — generate with: openssl rand -hex 32`,
      });
    }

    // 4. Stripe webhook secret format.
    const sws = process.env.STRIPE_WEBHOOK_SECRET;
    if (sws) {
      checks.push({
        name: 'STRIPE_WEBHOOK_SECRET format',
        status: sws.startsWith('whsec_') ? 'ok' : 'warn',
        detail: sws.startsWith('whsec_')
          ? 'whsec_ prefix present'
          : "expected 'whsec_' prefix — copy from Stripe Dashboard → Webhooks",
      });
    }

    // 5. Database reachability + critical tables exist.
    try {
      const fr = await query('SELECT id FROM founders LIMIT 1', []);
      checks.push({ name: 'database reachable', status: 'ok', detail: 'SELECT founders ok' });
      const _ = fr; // silence unused
    } catch (err) {
      checks.push({
        name: 'database reachable',
        status: 'fail',
        detail: `SELECT founders failed: ${String(err)}`,
      });
    }

    // 6. V3.1 migration coherence — verify the most recent migrations' tables exist.
    const v31Tables = [
      'north_stars',
      'outcome_trees',
      'freeze_periods',
      'team_health_metrics',
      'product_voice_fingerprints',
      'taste_journals',
      'idempotency_keys',
      'data_classifications',
      'communication_budgets',
    ];
    for (const t of v31Tables) {
      try {
        await query(`SELECT 1 FROM ${t} LIMIT 1`, []);
        checks.push({ name: `table: ${t}`, status: 'ok', detail: 'present' });
      } catch {
        checks.push({
          name: `table: ${t}`,
          status: 'fail',
          detail: `missing — run: foundry db:migrate`,
        });
      }
    }

    // 7. products.disabled_tools column (V3.1 migration 068).
    try {
      await query('SELECT disabled_tools FROM products LIMIT 1', []);
      checks.push({
        name: 'column: products.disabled_tools',
        status: 'ok',
        detail: 'present',
      });
    } catch {
      checks.push({
        name: 'column: products.disabled_tools',
        status: 'fail',
        detail: 'missing — run: foundry db:migrate (migration 068)',
      });
    }

    // 8. AI provider reachability — only when OPENROUTER_API_KEY is set.
    //    Cheap: a model-list ping. Skip when offline.
    if (process.env.OPENROUTER_API_KEY) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 5000);
        const res = await fetch('https://openrouter.ai/api/v1/models', {
          headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}` },
          signal: controller.signal,
        });
        clearTimeout(timeout);
        checks.push({
          name: 'AI provider reachable',
          status: res.ok ? 'ok' : 'warn',
          detail: res.ok ? `${res.status} OK` : `HTTP ${res.status} — check OPENROUTER_API_KEY`,
        });
      } catch (err) {
        checks.push({
          name: 'AI provider reachable',
          status: 'warn',
          detail: `unreachable: ${String(err).slice(0, 100)} — network or key issue`,
        });
      }
    }

    // ── Render ─────────────────────────────────────────────────────────────
    const fails = checks.filter((c) => c.status === 'fail');
    const warns = checks.filter((c) => c.status === 'warn');
    const oks = checks.filter((c) => c.status === 'ok');

    console.log(`\nFoundry preflight — ${checks.length} checks`);
    console.log('─'.repeat(70));
    for (const c of checks) {
      const icon = c.status === 'ok' ? '✓' : c.status === 'warn' ? '⚠' : '✗';
      console.log(`${icon} ${c.name.padEnd(40)} ${c.detail}`);
    }
    console.log('─'.repeat(70));
    console.log(`${oks.length} ok  ·  ${warns.length} warn  ·  ${fails.length} fail`);

    if (fails.length > 0) {
      console.log(
        '\nDeploy is NOT ready. Fix the failing checks above, then re-run preflight.'
      );
      process.exit(1);
    }
    if (warns.length > 0) {
      console.log(
        '\nDeploy is ready with degraded features. Address warnings post-deploy if they matter to you.'
      );
    } else {
      console.log('\nDeploy is ready.');
    }
  });

program.parse();
