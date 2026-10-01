import { describe, expect, it } from 'vitest';
import { JOB_REGISTRY, RETIRED_LOOPS, retiredLoopRefusal } from '../../src/jobs/index.js';

// =============================================================================
// THE SCHEDULER RUNS ONLY WHAT IS READ (Roadmap 2027 R12, 1 October 2026;
// OBJECTIVE §6, cost per decision ↓).
//
// The survey of 1 October 2026 read every scheduled job against what reads its
// output. Twenty of the jobs left after R10 and R11 either wrote rows nothing
// read (a weekly founder pulse to a log, lifecycle conditions with no reader,
// milestones and nav badges loaded into a layout context no view renders,
// growth stages, founder judgment patterns) or could never find work in this
// deployment (yellow and red company digests, cold-start exits, competitor
// scans with no competitors, cross-company patterns that need ten companies).
// One, the weekly DNA nudge, threw a TypeError every week and swallowed it.
//
// They are retired and refused by name. What stays and why is written beside
// the registry; the decisions, autopilot and red-team machinery stays for the
// owner to rule on, because Control and the MCP tools still read it.
// =============================================================================

const RETIRED = [
  'founder_pulse_check', 'lifecycle_check', 'stressor_cleanup', 'story_capture', 'dna_completion_nudge',
  'milestone_check', 'nav_badge_refresh', 'prediction_accuracy', 'stage_detection', 'predictive_intelligence',
  'cold_start_check', 'scenario_accuracy', 'founder_health_refresh', 'portfolio_snapshots',
  'remediation_outcome_check', 'competitive_scan', 'yellow_pulse', 'red_daily', 'pattern_aggregation',
  'founder_pattern_synthesis',
];

// Kept, by name, until the owner rules (decisions/autopilot/red team), or
// because something an owner surface, a gate or the public API reads depends
// on them. A future retirement removes the name here deliberately.
const KEPT_PENDING_A_RULING = [
  'autopilot_tick', 'red_team_sweep', 'memory_premise_check', 'decision_follow_up',
  'scp_expire_overdue_decisions', 'action_draft_generation',
];

describe('a job nothing reads', () => {
  it('is no longer scheduled, and is refused with what it was', () => {
    for (const name of RETIRED) {
      expect(JOB_REGISTRY, name).not.toHaveProperty(name);
      expect(RETIRED_LOOPS, name).toHaveProperty(name);
      expect(retiredLoopRefusal(name)).toContain(RETIRED_LOOPS[name]!);
    }
  });
});

describe('what stays for the owner to rule on', () => {
  it('is still scheduled, so retiring it is a decision and not a side effect', () => {
    for (const name of KEPT_PENDING_A_RULING) expect(JOB_REGISTRY, name).toHaveProperty(name);
  });
});
