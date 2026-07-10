// =============================================================================
// FOUNDRY — MCP loop tools (the Trust Plane)
//
// The decision loop, exposed as tools: any MCP client (Claude Code, Claude
// Desktop, agents) can consult the company's beliefs, trust, and dissent — and
// act through the same governed paths the UI uses. The founder's judgment
// infrastructure becomes ambient across every AI surface they work in.
//
// Tenancy: the caller's product is fixed by their API key (the transport passes
// ctx.productId); any product_id argument is IGNORED. Setting autopilot modes is
// deliberately NOT exposed — crossing into 'act' is a founder-consent moment
// that happens in Controls, never through an agent (Trust Law).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../db/client.js';
import type { MCPTool, MCPToolResult } from './server.js';

export interface LoopToolContext {
  productId: string;
  founderId: string;
}

const text = (t: string): MCPToolResult => ({ content: [{ type: 'text', text: t }] });
const json = (v: unknown): MCPToolResult => text(JSON.stringify(v, null, 2));

export const LOOP_TOOLS: MCPTool[] = [
  {
    name: 'foundry_letter',
    description: "Today's Letter from the company: what the autopilot handled, the ONE decision that needs the founder, what was learned (expired beliefs, peer radar), and how trust moved. Deterministic — composed from ledgers, never hallucinated. Read this first to know the company's state.",
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'foundry_decision_queue',
    description: 'Pending decisions with their stakes (gate 0-4), category, deadline, and the agent team\'s recommendation. Gate 3+ decisions are high-stakes and should be contested (foundry_red_team) before resolving.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'foundry_resolve_decision',
    description: 'Resolve a pending decision on the founder\'s behalf. Gate-3 decisions REQUIRE reasoning. If the Red Team objected and is being overruled, its falsifiable objections automatically become monitored premises — the overruling is accountable.',
    inputSchema: {
      type: 'object',
      properties: {
        decision_id: { type: 'string', description: 'The decision to resolve' },
        chosen_option: { type: 'string', description: 'The option being chosen' },
        reasoning: { type: 'string', description: 'Why (required for gate-3 decisions)' },
      },
      required: ['decision_id', 'chosen_option'],
    },
  },
  {
    name: 'foundry_record_decision',
    description: 'Record a strategic decision in the company ledger, with the BELIEF it rests on as a monitored premise. If the premise names a metric (churn_rate, activation_rate, day_30_retention, nps_score, mrr_health_ratio) with a comparator and threshold, Foundry will watch it and flag the decision if telemetry later contradicts it.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'What was decided (short)' },
        decision: { type: 'string', description: 'The chosen direction, concretely' },
        rationale: { type: 'string', description: 'Why' },
        premise: { type: 'string', description: 'The belief this decision rests on, in plain words' },
        premise_metric: { type: 'string', description: 'Optional metric key to auto-check the premise against' },
        premise_comparator: { type: 'string', description: 'One of < <= > >= — the condition that must KEEP holding' },
        premise_threshold: { type: 'number', description: 'The threshold for the comparator' },
      },
      required: ['title', 'decision'],
    },
  },
  {
    name: 'foundry_red_team',
    description: 'Summon the adversarial pre-mortem for a pending decision: three lenses (downside, competitor, capacity) argue why it FAILS, grounded in the company\'s real telemetry. Objections are falsifiable where possible. Run this before resolving anything gate-3+.',
    inputSchema: {
      type: 'object',
      properties: { decision_id: { type: 'string', description: 'The pending decision to contest' } },
      required: ['decision_id'],
    },
  },
  {
    name: 'foundry_fork_reality',
    description: 'Simulate each option\'s 90-day MRR trajectory (1,000-run seeded Monte Carlo on the company\'s OWN growth history). Returns p10/p50/p90 bands per option plus a do-nothing ghost. Abstains honestly if the company has under 4 months of history.',
    inputSchema: {
      type: 'object',
      properties: { decision_id: { type: 'string', description: 'The pending decision to fork' } },
      required: ['decision_id'],
    },
  },
  {
    name: 'foundry_expired_beliefs',
    description: 'Decisions whose stated premises the company\'s OWN telemetry has since falsified — the accountability queue. Each shows the belief, the evidence against it, and the decision that rests on it. These should be revisited before making related decisions.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'foundry_trust',
    description: 'The trust ledger: per decision category — the autopilot mode (shadow/suggest/act), shadow agreement rate (did the founder choose what the agents recommended?), clean cycles banked, and outcome-backed graduation proposals. Consult this to weight how much to defer to the agents in each category.',
    inputSchema: { type: 'object', properties: {}, required: [] },
  },
];

export async function executeLoopTool(
  name: string,
  args: Record<string, unknown>,
  ctx: LoopToolContext,
): Promise<MCPToolResult> {
  try {
    switch (name) {
      case 'foundry_letter': {
        const { composeLetter } = await import('../services/letter/composer.js');
        return json(await composeLetter(ctx.productId));
      }
      case 'foundry_decision_queue': {
        const r = await query(
          `SELECT id, what, why_now, category, gate, deadline, recommendation, options
           FROM decisions WHERE product_id = ? AND status = 'pending'
           ORDER BY gate DESC, created_at ASC LIMIT 20`,
          [ctx.productId],
        );
        return json(r.rows);
      }
      case 'foundry_resolve_decision': {
        const decisionId = String(args.decision_id ?? '');
        const chosen = String(args.chosen_option ?? '');
        const reasoning = args.reasoning ? String(args.reasoning) : null;
        const d = await query(
          "SELECT gate, status FROM decisions WHERE id = ? AND product_id = ?",
          [decisionId, ctx.productId],
        );
        const row = d.rows[0] as Record<string, unknown> | undefined;
        if (!row) return text('Error: decision not found in this company');
        if (row.status !== 'pending') return text('Error: decision is not pending');
        if (Number(row.gate) >= 3 && !reasoning) {
          return text('Error: gate-3 decisions require reasoning. Consider foundry_red_team first.');
        }
        const { resolveDecision } = await import('../services/decisions/queue.js');
        await resolveDecision(decisionId, ctx.productId, chosen, 'founder');
        if (reasoning) {
          await query('UPDATE decisions SET resolution_reasoning = ? WHERE id = ?', [reasoning, decisionId]);
        }
        const { recordOverruledDissent } = await import('../services/redteam/council.js');
        const monitored = await recordOverruledDissent(decisionId, ctx.productId);
        return text(`Resolved to "${chosen}".${monitored > 0 ? ` ${monitored} overruled Red Team objection(s) are now monitored premises — being wrong will be discoverable.` : ''}`);
      }
      case 'foundry_record_decision': {
        const decisionId = nanoid();
        await query(
          `INSERT INTO strategic_decisions_log
             (id, product_id, decision_title, decision_description, decision_rationale, made_by, status)
           VALUES (?, ?, ?, ?, ?, 'founder', 'active')`,
          [decisionId, ctx.productId, String(args.title), String(args.decision), args.rationale ? String(args.rationale) : null],
        );
        let premiseNote = '';
        if (args.premise) {
          const { recordPremise } = await import('../services/memory/kernel.js');
          await recordPremise({
            productId: ctx.productId,
            decisionId,
            decisionSource: 'strategic',
            premise: String(args.premise),
            metricKey: args.premise_metric ? String(args.premise_metric) : undefined,
            comparator: args.premise_comparator as '<' | '<=' | '>' | '>=' | undefined,
            threshold: typeof args.premise_threshold === 'number' ? args.premise_threshold : undefined,
          });
          premiseNote = ' Premise recorded — Foundry will hold this decision accountable to it.';
        }
        return text(`Decision "${String(args.title)}" recorded (${decisionId}).${premiseNote}`);
      }
      case 'foundry_red_team': {
        const { runPreMortem } = await import('../services/redteam/council.js');
        const res = await runPreMortem(String(args.decision_id ?? ''), ctx.productId);
        if (!res) return text('Error: decision not found in this company');
        return json({ verdict: res.review.verdict, strongest_objection: res.review.strongest_objection, objections: res.objections });
      }
      case 'foundry_fork_reality': {
        const { runGhostFork } = await import('../services/ghost/simulator.js');
        const forks = await runGhostFork(String(args.decision_id ?? ''), ctx.productId);
        if (!forks) {
          // Distinguish already-forked (return stored) from abstention.
          const existing = await query(
            'SELECT option_label, best_case, base_case, stress_case FROM scenario_models WHERE decision_id = ?',
            [String(args.decision_id ?? '')],
          );
          if (existing.rows.length > 0) return json(existing.rows);
          return text('Abstained: not enough MRR history to simulate honestly (need ≥4 months), or decision not found.');
        }
        return json(forks);
      }
      case 'foundry_expired_beliefs': {
        const { getExpiredBeliefs } = await import('../services/memory/kernel.js');
        const expired = await getExpiredBeliefs(ctx.productId);
        return json(expired.map((e) => ({
          decision: e.decision_title, believed: e.premise.premise, evidence: e.premise.evidence,
          falsified_at: e.premise.falsified_at,
        })));
      }
      case 'foundry_trust': {
        const [{ getTrustLedger }, { getShadowStats, getAllPolicies, MODE_LABELS }] = await Promise.all([
          import('../services/trust/ledger.js'),
          import('../services/autopilot/policy.js'),
        ]);
        const [ledger, shadow, policies] = await Promise.all([
          getTrustLedger(ctx.productId), getShadowStats(ctx.productId), getAllPolicies(ctx.productId),
        ]);
        return json({
          categories: policies.map((p) => ({
            category: p.category,
            mode: p.mode,
            mode_label: MODE_LABELS[p.mode],
            clean_cycles: p.clean_cycles,
            shadow: shadow.find((s) => s.category === p.category) ?? null,
            outcomes: ledger.categories.find((c) => c.category === p.category) ?? null,
          })),
          graduation_proposals: ledger.proposals,
        });
      }
      default:
        return text(`Unknown tool: ${name}`);
    }
  } catch (err) {
    return text(`Error executing ${name}: ${err instanceof Error ? err.message : String(err)}`);
  }
}
