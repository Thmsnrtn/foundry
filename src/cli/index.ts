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
    const migrations = ['001_initial.sql', '002_wisdom_remediation.sql', '003_ux_intelligence.sql', '004_signal_wisdom.sql', '005_signal_history.sql'];
    for (const file of migrations) {
      console.log(`  Running ${file}...`);
      const filePath = resolve(__dirname, '../db/migrations', file);
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

program.parse();
