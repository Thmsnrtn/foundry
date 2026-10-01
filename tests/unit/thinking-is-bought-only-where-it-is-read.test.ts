import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { JOB_REGISTRY, RETIRED_LOOPS, retiredLoopRefusal } from '../../src/jobs/index.js';
import { WORK_THE_MODEL_DOES } from '../../src/services/ai/what-it-is-for.js';

// =============================================================================
// THINKING IS BOUGHT ONLY WHERE IT IS READ (Roadmap 2027 R11, 1 October 2026;
// OBJECTIVE §6, cost per decision ↓; STRATEGY S35).
//
// Until the charter is signed the owner's thinking budget is a dollar a day,
// and the forge and discovery, which an owner surface reads, draw on it. Six
// scheduled jobs were spending from the same dollar on work no door, gate or
// person ever read: a daily insight, a weekly plan and a spoken morning
// briefing nobody opened, a signal every two hours whose prose lived only in
// memory, and weekly geopolitical and regulatory scans. Two more, a knowledge
// graph and a recovery plan, called Opus when their condition was met and were
// read by nothing either.
//
// They are retired: refused by name, their modules gone, and the kinds of
// thinking only they bought gone from the vocabulary, so nothing can buy them
// again without saying in code which decision they would change.
// =============================================================================

const ROOT = resolve(import.meta.dirname, '../..');

const RETIRED = [
  'daily_insight_generate', 'weekly_plan_generate', 'morning_briefings', 'signal_alert_check',
  'geopolitical_scan', 'regulatory_scan', 'graph_rebuild', 'weekly_synthesis',
];

describe('a job whose thinking nobody read', () => {
  it('is no longer scheduled, and is refused with what it was', () => {
    for (const name of RETIRED) {
      expect(JOB_REGISTRY, name).not.toHaveProperty(name);
      expect(RETIRED_LOOPS, name).toHaveProperty(name);
      expect(retiredLoopRefusal(name)).toContain(RETIRED_LOOPS[name]!);
    }
  });

  it('took its modules with it', () => {
    for (const gone of [
      'src/services/intelligence/global.ts', 'src/services/intelligence/regulatory.ts',
      'src/services/intelligence/recovery.ts', 'src/services/graph/engine.ts', 'src/services/voice/briefing.ts',
    ]) expect(existsSync(join(ROOT, gone)), gone).toBe(false);
  });

  it('took the kinds of thinking only it bought out of the vocabulary', () => {
    for (const kind of ['the weekly plan', 'the spoken briefing', 'global intelligence', 'regulatory read', 'the graph', 'recovering a company']) {
      expect(WORK_THE_MODEL_DOES, kind).not.toHaveProperty(kind);
    }
  });
});
