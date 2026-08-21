process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { nanoid } from 'nanoid';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { SCPInstance } from '../../src/services/scp/instance.js';
import { getSCPBoardSection } from '../../src/services/investor/board_packet.js';

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
//   the agents dashboard              `?? 50`, then drew a bar at 50% width in
//                                     amber.
//   the board packet                  `?? 0` for the company, and `?? 0` for an
//                                     agent under the heading "Top Performing
//                                     Agents" — "Health: 0", in red, about an
//                                     agent nothing had measured.
//   the weekly brief                  a NOT NULL column, so it could not record
//                                     that the health was unknown, and opened
//                                     with "Health score is 50/100 this week."
//
// Fifty is the middle of every bar this system draws. An unmeasured company
// rendered as exactly average, beside companies that were measured.
//
// THE READER WAS RIGHT AND THE PRODUCER COULD NOT REACH IT. `SCPBriefing
// .health_score` has always been `number | null`, and the briefing renders
// "N/A". `fleet.ts` has always written `${a.healthScore ?? '—'}`. Both were
// waiting for a null that could not arrive.
//
// NOT AN AUTHORITY DEFECT, and the distinction is worth keeping.
// `updateLifecycleState` only PROMOTES on `healthScore >= 75`, so the invented
// 50 never escalated anything. It erred conservative in the one place where it
// mattered most.
// =============================================================================

const AGENT_FILES = ['compass', 'shield', 'sentinel', 'ledger'] as const;

beforeAll(async () => {
  await runMigrations();
  await query("INSERT INTO founders (id, clerk_user_id, email) VALUES ('f_h','c_h','h@example.com')");
});
beforeEach(async () => {
  await query('DELETE FROM agent_instances');
  await query('DELETE FROM products');
  await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_h','Acme','f_h','active')");
});

async function agent(name: string, health: number | null, sessions = 0, successes = 0) {
  await query(
    `INSERT INTO agent_instances
       (id, product_id, agent_name, display_name, version, authority_level, status,
        total_sessions, successful_sessions, domain_health_score)
     VALUES (?, 'p_h', ?, ?, 1, 2, 'active', ?, ?, ?)`,
    [nanoid(), name, name, sessions, successes, health]);
}

describe('the agents no longer invent a score', () => {
  it('none of them defaults to 50', () => {
    for (const f of AGENT_FILES) {
      const code = stripComments(
        readFileSync(`src/services/scp/agents/${f}.ts`, 'utf8'), { lineComments: true });
      expect(code, `${f} still substitutes 50 for a score the model did not give`)
        .not.toMatch(/domain_health_score \?\? 50/);
      expect(code).not.toMatch(/company_health_score \?\? 50/);
    }
  });

  it('and the parsed shape admits the field being absent', () => {
    for (const f of AGENT_FILES) {
      const code = readFileSync(`src/services/scp/agents/${f}.ts`, 'utf8');
      expect(code).toMatch(/domain_health_score\?: number;/);
    }
  });

  it('and the model is told to omit rather than guess', () => {
    for (const f of AGENT_FILES) {
      expect(readFileSync(`src/services/scp/agents/${f}.ts`, 'utf8'))
        .toMatch(/OMIT THIS FIELD ENTIRELY if you have no/);
    }
  });
});

describe('the company health score', () => {
  it('is null when no agent has scored its domain', async () => {
    await agent('oracle', null);
    await agent('harbor', null);
    expect(await new SCPInstance('p_h').computeHealthScore()).toBeNull();
  });

  it('does not write a number it did not compute', async () => {
    await agent('oracle', null);
    await new SCPInstance('p_h').computeHealthScore();
    const row = (await query("SELECT health_score FROM products WHERE id='p_h'"))
      .rows[0] as Record<string, unknown>;
    expect(row.health_score, 'a stored 50 is what everything downstream reads').toBeNull();
  });

  it('skips the unscored rather than counting them at 50', async () => {
    await agent('oracle', 90);
    await agent('harbor', null);
    await agent('forge', null);
    const score = await new SCPInstance('p_h').computeHealthScore();
    expect(score, 'averaging 90 with two invented 50s gave about 63').toBe(90);
  });

  it('averages the ones that were scored', async () => {
    await agent('oracle', 100);
    await agent('harbor', 50);
    const score = await new SCPInstance('p_h').computeHealthScore();
    expect(score).not.toBeNull();
    expect(score!).toBeGreaterThan(50);
    expect(score!).toBeLessThan(100);
  });
});

describe('an agent that never ran', () => {
  it('has no success rate rather than a rate of zero', async () => {
    await agent('compass', 80, 0, 0);
    const overview = await new SCPInstance('p_h').getStatus();
    const compass = overview.agents.find((a) => a.name === 'compass')!;
    expect(compass.successRate, '0 means it ran and always failed').toBeNull();
  });

  it('has no health score when the column is null', async () => {
    await agent('compass', null, 3, 3);
    const overview = await new SCPInstance('p_h').getStatus();
    expect(overview.agents.find((a) => a.name === 'compass')!.domainHealthScore).toBeNull();
  });

  it('and an agent with no row at all has neither', async () => {
    const overview = await new SCPInstance('p_h').getStatus();
    const any = overview.agents[0]!;
    expect(any.totalSessions).toBe(0);
    expect(any.successRate).toBeNull();
    expect(any.domainHealthScore).toBeNull();
  });

  it('still reports a real rate when there is one', async () => {
    await agent('compass', 80, 4, 3);
    const overview = await new SCPInstance('p_h').getStatus();
    expect(overview.agents.find((a) => a.name === 'compass')!.successRate).toBe(0.75);
  });
});

describe('the investor packet', () => {
  it('does not call an unscored agent a top performer', async () => {
    await agent('oracle', 88);
    await agent('harbor', null);
    await agent('forge', null);

    const section = await getSCPBoardSection('p_h');
    expect(section.top_agents.map((a) => a.name)).toEqual(['oracle']);
    expect(section.top_agents.every((a) => a.health > 0),
      'an unscored agent used to appear as "Health: 0" in red').toBe(true);
  });

  it('reports company health as null rather than zero', async () => {
    await agent('oracle', null);
    const section = await getSCPBoardSection('p_h');
    expect(section.health_score,
      'zero is the worst health there is, not the absence of a measurement').toBeNull();
  });

  it('reports a real company health when there is one', async () => {
    await agent('oracle', 90);
    await new SCPInstance('p_h').computeHealthScore();
    expect((await getSCPBoardSection('p_h')).health_score).toBe(90);
  });
});

describe('the fifty was in the schema, not only in the code', () => {
  it('the provisioner no longer stamps every new agent at 50', () => {
    const src = stripComments(
      readFileSync('src/services/scp/provisioner.ts', 'utf8'), { lineComments: true });
    expect(src, 'twelve agents per company, at exactly average health, before running once')
      .not.toMatch(/0, 0, 0, 0, 0, 50, \?/);
    expect(src).toMatch(/0, 0, 0, 0, 0, NULL, \?/);
  });

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

  it('a provisioned agent starts unscored', async () => {
    const { provisionSCP } = await import('../../src/services/scp/provisioner.js');
    await query("INSERT INTO products (id, name, owner_id, status) VALUES ('p_prov','Prov','f_h','active')");
    await provisionSCP('p_prov', 'f_h');
    const rows = (await query(
      "SELECT domain_health_score FROM agent_instances WHERE product_id='p_prov'"))
      .rows as unknown as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.domain_health_score === null)).toBe(true);
    await query("DELETE FROM agent_instances WHERE product_id='p_prov'");
    await query("DELETE FROM products WHERE id='p_prov'");
  });
});

describe('the weekly brief can record that it does not know', () => {
  it('the column is nullable', async () => {
    const cols = ((await query('PRAGMA table_info(weekly_compressed_briefs)')).rows as unknown as
      Array<Record<string, unknown>>);
    const health = cols.find((c) => String(c.name) === 'health_score')!;
    expect(Number(health.notnull), 'NOT NULL meant it always had a number').toBe(0);
  });

  it('and the page says so instead of drawing a bar', () => {
    expect(readFileSync('src/routes/dashboard/weekly-brief.ts', 'utf8'))
      .toMatch(/brief\.health_score == null \? 'not scored'/);
  });
});
