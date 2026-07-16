// =============================================================================
// FOUNDRY — Golden Output Harness (the taste check)
//
// The go-live caveat that was never closed: "does the real generated output
// read like a sharp operator, or like generic MBA advice?" This seeds a
// realistic founder + 90 days of history and prints EVERY deterministic
// founder-facing artifact — the Letter, the fleet Letter, the department
// drafts, the decision framing, the calibration display — so a human can read
// what Foundry actually says. No model calls; no live keys; no deploy needed.
//
// Run: npm run sim:golden
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { nanoid } from 'nanoid';

const rule = (t: string) => console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);
const block = (t: string) => console.log(`\n${t}\n`);

async function seed() {
  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email, preferences) VALUES ('g_f','clk_g','maya@northwind.co', ?)",
    [JSON.stringify({ fluency: 'plain' })]);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('g_p','Northwind','g_f','active')", []);
  await query("INSERT INTO lifecycle_state (product_id, current_prompt, risk_state, risk_state_reason) VALUES ('g_p','prompt_3','yellow','Churn ticked up while activation stalled')", []);

  // 90 days of metrics: growing MRR, but churn creeping and activation soft.
  const today = new Date();
  for (let d = 90; d >= 0; d -= 7) {
    const date = new Date(today.getTime() - d * 86_400_000).toISOString().slice(0, 10);
    const wk = (90 - d) / 7;
    await query(
      `INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, signups_7d, active_users, activation_rate, day_30_retention, churn_rate, nps_score, support_volume_7d, mrr_health_ratio)
       VALUES (?, 'g_p', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), date, 800000 + wk * 45000, Math.round(9 + wk), 120 + wk * 8,
       0.34, 0.55 - wk * 0.005, 0.055 + wk * 0.002, 41, 18 + Math.round(wk), 0.4],
    );
  }

  // A champion, an at-risk customer, and a happy-but-quiet one.
  await query(`INSERT INTO customers (id, product_id, owner_id, name, email, health_score, churn_risk, is_champion, last_active_at, external_id) VALUES
    ('g_c1','g_p','g_f','Priya Raman','priya@acme.io',0.94,0.08,1,?, 'cus_priya'),
    ('g_c2','g_p','g_f','Dan Whorley','dan@lugetech.com',0.31,0.86,0,?, 'cus_dan')`,
    [new Date(today.getTime() - 2 * 86_400_000).toISOString(),
     new Date(today.getTime() - 24 * 86_400_000).toISOString()]);

  // Product DNA so marketing/product drafts have something real to cite.
  await query(`INSERT INTO product_dna (id, product_id, icp_description, icp_pain, positioning_statement, primary_objection, what_we_are_not, growth_hypothesis, sections_completed, completion_pct)
    VALUES ('g_dna','g_p','ops leads at 20-100 person B2B SaaS','drowning in manual reporting across disconnected tools','the reporting layer that assembles itself','we already have a BI tool','not another dashboard you have to configure','warm intros convert 4x cold', '[]', 60)`, []);

  // Two open decisions of different stakes, one with a recommendation.
  await query(`INSERT INTO decisions (id, product_id, category, gate, what, why_now, recommendation, status) VALUES
    ('g_d1','g_p','strategic',3,'Sign the 40-seat Meridian contract at 30% discount','Their procurement deadline is Friday','Take it — logo value and expansion path outweigh the margin hit at this stage','pending'),
    ('g_d2','g_p','urgent',1,'Refund the double-charged Lugetech invoice','Support flagged it this morning',NULL,'pending')`, []);

  // A recorded belief and one that has since gone false (the memory kernel).
  await query(`INSERT INTO decision_premises (id, product_id, decision_id, decision_source, premise, premise_type, metric_key, comparator, threshold, status, evidence, origin) VALUES
    ('g_pr1','g_p','g_d1','decision','Churn stays under 5% as we move upmarket','metric','churn_rate','<',0.05,'falsified','observed churn_rate = 0.063 (premise required < 0.05)','founder'),
    ('g_pr2','g_p','g_d1','decision','Activation holds above 30%','metric','activation_rate','>',0.30,'holding',NULL,'founder')`, []);

  // Some autonomous history so trust + calibration have something to say.
  await query("INSERT INTO autopilot_policies (id, product_id, category, mode, set_by, clean_cycles) VALUES ('g_ap','g_p','customer_success','suggest','earned',6)", []);
}

async function main() {
  await seed();
  const { composeLetter } = await import('../../src/services/letter/composer.js');
  const { draftCheckIn } = await import('../../src/services/departments/success.js');
  const { draftContentBrief } = await import('../../src/services/departments/marketing.js');
  const { deriveHypothesis } = await import('../../src/services/departments/product.js');
  const { draftReferralAsk } = await import('../../src/services/departments/outreach.js');
  const { getProductDNA } = await import('../../src/services/wisdom/dna.js');
  const { adviceFooter } = await import('../../src/services/ux/fluency.js');

  rule('THE LETTER (plain fluency) — what Maya reads over coffee');
  const letter = await composeLetter('g_p', 'plain');
  if (letter.needsYou) block(`⚑ The one thing that needs you:\n   ${letter.needsYou}`);
  block(`What I handled:\n${letter.handled.map((l) => '   • ' + l).join('\n') || '   (nothing autonomous yet)'}`);
  block(`What I learned:\n${letter.learned.map((l) => '   • ' + l).join('\n') || '   (quiet)'}`);
  block(`How trust moved:\n${letter.trust.map((l) => '   • ' + l).join('\n') || '   (quiet)'}`);
  block(`   — ${adviceFooter('plain')}`);

  rule('CUSTOMER SUCCESS — the check-in it would send to an at-risk account');
  const dan = (await query("SELECT * FROM customers WHERE id='g_c2'", [])).rows[0] as Record<string, unknown>;
  const checkIn = draftCheckIn(dan, 'Northwind');
  block(`Subject: ${checkIn.subject}\n\n${checkIn.body}`);

  rule('OUTREACH — the referral ask it would send to a champion');
  const priya = (await query("SELECT * FROM customers WHERE id='g_c1'", [])).rows[0] as Record<string, unknown>;
  const ref = draftReferralAsk(priya, 'Northwind');
  block(`Subject: ${ref.subject}\n\n${ref.body}`);

  rule('MARKETING — the content brief it would propose (grounded in real DNA)');
  const dna = await getProductDNA('g_p');
  const brief = draftContentBrief(dna as never);
  block(`${brief.title} (grounded: ${brief.grounded})\n\n${brief.brief}`);

  rule('PRODUCT — the hypothesis it would put in front of the founder');
  const snap = (await query("SELECT * FROM metric_snapshots WHERE product_id='g_p' ORDER BY snapshot_date DESC LIMIT 1", [])).rows[0] as Record<string, unknown>;
  const hyp = deriveHypothesis(snap);
  block(hyp ? `${hyp.what}\n   Why now: ${hyp.whyNow}\n   The bet on record: ${hyp.premise}` : '(no metric over a line)');

  rule('THE EXPIRED BELIEF — the memory kernel catching a decision going stale');
  const { getExpiredBeliefs } = await import('../../src/services/memory/kernel.js');
  const expired = await getExpiredBeliefs('g_p');
  block(expired.map((e) => `   "${e.premise.premise}"\n   → ${e.premise.evidence}`).join('\n') || '   (none)');

  console.log('\n' + '─'.repeat(70));
  console.log('  Read the above as Maya would. Does it sound like a sharp chief');
  console.log('  of staff — specific, grounded, honest — or like generic advice?');
  console.log('─'.repeat(70) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
