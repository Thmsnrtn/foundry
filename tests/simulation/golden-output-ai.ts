// =============================================================================
// FOUNDRY — Golden Output (AI surfaces) — the taste check for MODEL-generated text
//
// The deterministic taste check (golden-output.ts) covers the Letter, drafts,
// and decision framing. This one covers what the MODEL writes — the /talk
// reply, and (extend as needed) the briefing and Red Team pre-mortem — the
// other half of "does it read like a sharp operator?" Requires a live AI key;
// prints a clear skip message and exits 0 when none is set, so it's safe in CI
// and ready to run the moment a key exists.
//
// Run: npm run sim:golden:ai   (with ANTHROPIC_API_KEY or OPENROUTER_API_KEY set)
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { nanoid } from 'nanoid';

const hasKey = !!(process.env.ANTHROPIC_API_KEY || process.env.OPENROUTER_API_KEY);
const rule = (t: string) => console.log(`\n${'═'.repeat(70)}\n  ${t}\n${'═'.repeat(70)}`);

async function main() {
  if (!hasKey) {
    console.log('\n  ⏭  Skipping the AI taste check — no ANTHROPIC_API_KEY / OPENROUTER_API_KEY set.');
    console.log('     Set one and re-run to read what the MODEL writes (the /talk reply,');
    console.log('     briefing, Red Team pre-mortem) and judge whether it reads like a sharp');
    console.log('     chief of staff. The deterministic surfaces are covered by sim:golden.\n');
    return;
  }

  await runMigrations();
  await query('PRAGMA foreign_keys=OFF', []);
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('ga_f','clk_ga','maya@northwind.co')", []);
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('ga_p','Northwind','ga_f','active')", []);
  await query("INSERT INTO lifecycle_state (product_id, current_prompt, risk_state) VALUES ('ga_p','prompt_3','yellow')", []);
  await query(`INSERT INTO metric_snapshots (id, product_id, snapshot_date, new_mrr_cents, churn_rate, activation_rate, signups_7d)
    VALUES (?, 'ga_p', date('now'), 1200000, 0.063, 0.34, 14)`, [nanoid()]);
  await query(`INSERT INTO decisions (id, product_id, category, gate, what, why_now, status)
    VALUES ('ga_d','ga_p','strategic',3,'Move upmarket to 40-seat contracts','Meridian deadline Friday','pending')`, []);

  rule('/talk — "what needs me?" (the fast path is deterministic; this asks judgment)');
  const { handleUtterance } = await import('../../src/services/chat/institution.js');
  for (const q of [
    'Churn crept to 6.3% as we moved upmarket. Is that a problem or just the mix shifting?',
    'Should I take the Meridian contract at a 30% discount?',
  ]) {
    console.log(`\nMaya: ${q}`);
    try {
      const turn = await handleUtterance('ga_p', 'ga_f', q);
      console.log(`Foundry: ${turn.reply}`);
      if (turn.captured) console.log(`   📒 captured: ${turn.captured.kind}`);
    } catch (e) {
      console.log(`   (error: ${String(e).slice(0, 160)})`);
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log('  Read the replies. Do they cite Maya\'s real numbers and give a clear,');
  console.log('  grounded read — or hedge like a generic chatbot? That gap is the product.');
  console.log('─'.repeat(70) + '\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
