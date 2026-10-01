process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';

// =============================================================================
// FIFTY IS A SCORE, NOT AN ABSENCE.
//
// `AgentResult.domainHealthScore` is declared `number | undefined` with the
// comment "0-100; if provided". Five agents wrote `parsed.domain_health_score
// ?? 50` and defeated that before it ever reached the column. From there:
//
//   `SCPInstance.computeHealthScore`  counted every unscored agent AT 50 in the
//                                     weighted average, and wrote the result to
//                                     `products.health_score`.
//   `getSCPOverview`                  reported 50 for an agent with no instance
//                                     row at all, and `successRate: 0` for one
//                                     that had never run — the worst score on
//                                     the page, for the one nobody had asked to
//                                     do anything.
//   the board packet                  `?? 0` for the company, and `?? 0` for an
//                                     agent under the heading "Top Performing
//                                     Agents" — "Health: 0", in red, about an
//                                     agent nothing had measured. That reader,
//                                     `investor/board_packet.ts`, was reachable
//                                     from no entry point and has been deleted;
//                                     the three cases that held it to a null
//                                     went with it. The producer's obligation
//                                     is unchanged and is still checked below.
//   the weekly brief                  a NOT NULL column, so it could not record
//                                     that the health was unknown, and opened
//                                     with "Health score is 50/100 this week."
//
// Fifty is the middle of every bar this system draws. An unmeasured company
// rendered as exactly average, beside companies that were measured.
//
// THE READER WAS RIGHT AND THE PRODUCER COULD NOT REACH IT. `SCPBriefing
// .health_score` has always been `number | null`, and the briefing renders
// "N/A" — it was waiting for a null that could not arrive. Several pages that
// read the same figure have since gone with Commercial Foundry, which changes
// nothing about the producer: the null has to be able to leave the agent, the
// instance and the column, and that is what is checked here.
//
// NOT AN AUTHORITY DEFECT, and the distinction is worth keeping.
// `updateLifecycleState` only PROMOTES on `healthScore >= 75`, so the invented
// 50 never escalated anything. It erred conservative in the one place where it
// mattered most.
// =============================================================================

// THE AGENTS, THE PROVISIONER, THE SCRATCHPAD AND THE WEEKLY BRIEF ARE GONE.
// All twelve agents were retired in Roadmap 2027 R9, with `scp/provisioner.ts`,
// `scp/coordination/scratchpad.ts` and `weekly_compressed_briefs`; the cases
// that read them went with them. What is left is the schema half: neither
// column may come back with a default that states a health nobody measured.

beforeAll(async () => { await runMigrations(); });

describe('the fifty was in the schema, not only in the code', () => {
  it('agent_instances.domain_health_score has no default', async () => {
    const col = ((await query('PRAGMA table_info(agent_instances)')).rows as unknown as
      Array<Record<string, unknown>>).find((c) => String(c.name) === 'domain_health_score')!;
    expect(col.dflt_value, 'DEFAULT 50 agreed with every ?? 50 downstream').toBeNull();
  });

  it('products.health_score has no default', async () => {
    const col = ((await query('PRAGMA table_info(products)')).rows as unknown as
      Array<Record<string, unknown>>).find((c) => String(c.name) === 'health_score')!;
    expect(col.dflt_value, 'DEFAULT 0 started every company at the worst health there is')
      .toBeNull();
  });
});
