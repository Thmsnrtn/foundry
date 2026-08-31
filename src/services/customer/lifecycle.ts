// =============================================================================
// FOUNDRY — Customer Lifecycle Rules Service
// Seeds default rules, evaluates triggers, manages lifecycle automation.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';
import {
  getCustomersByStage,
  getAtRiskCustomers,
  addAgentNote,
  transitionStage,
  type CustomerRecord,
} from './intelligence.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface LifecycleRule {
  id: string;
  product_id: string;
  name: string;
  description: string | null;
  trigger_event: string;
  trigger_conditions: Record<string, unknown>;
  action_agent: string;
  action_type: string;
  action_parameters: Record<string, unknown>;
  authority_level: number;
  enabled: boolean;
  cooldown_hours: number;
  times_triggered: number;
  success_count: number;
  failure_count: number;
  created_by: string;
  created_at: string;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function parseJson<T>(value: string | null | undefined, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

function rowToRule(row: Record<string, unknown>): LifecycleRule {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    name: row.name as string,
    description: (row.description as string) ?? null,
    trigger_event: row.trigger_event as string,
    trigger_conditions: parseJson<Record<string, unknown>>(row.trigger_conditions as string, {}),
    action_agent: row.action_agent as string,
    action_type: row.action_type as string,
    action_parameters: parseJson<Record<string, unknown>>(row.action_parameters as string, {}),
    authority_level: (row.authority_level as number) ?? 1,
    enabled: (row.enabled as number) === 1,
    cooldown_hours: (row.cooldown_hours as number) ?? 72,
    times_triggered: (row.times_triggered as number) ?? 0,
    success_count: (row.success_count as number) ?? 0,
    failure_count: (row.failure_count as number) ?? 0,
    created_by: (row.created_by as string) ?? 'system',
    created_at: row.created_at as string,
  };
}

// ─── seedDefaultRules ─────────────────────────────────────────────────────────

/**
 * Seed 6 default lifecycle rules for a new product.
 */
export async function seedDefaultRules(productId: string): Promise<void> {
  const existing = await query(
    `SELECT id FROM lifecycle_rules WHERE product_id = ? LIMIT 1`,
    [productId]
  );
  if (existing.rows.length > 0) return; // Already seeded

  const defaultRules: Array<{
    name: string;
    description: string;
    trigger_event: string;
    trigger_conditions: Record<string, unknown>;
    action_agent: string;
    action_type: string;
    action_parameters: Record<string, unknown>;
    authority_level: number;
    cooldown_hours: number;
  }> = [
    {
      name: 'Health Score Critical Alert',
      description: 'Flag customers with health score below 40 for immediate review',
      trigger_event: 'health_score_dropped',
      trigger_conditions: { threshold: 40 },
      action_agent: 'harbor',
      action_type: 'add_note',
      action_parameters: {
        note_template: 'Customer health score dropped below 40. Immediate outreach recommended.',
        also_create_remediation: true,
      },
      authority_level: 1,
      cooldown_hours: 72,
    },
    {
      name: 'Health Score Emergency Escalation',
      description: 'Escalate to CEO when health score drops below 20',
      trigger_event: 'health_score_dropped',
      trigger_conditions: { threshold: 20 },
      action_agent: 'harbor',
      action_type: 'escalate_to_ceo',
      action_parameters: {
        escalation_message: 'Customer health score critically low (below 20). Immediate intervention required.',
        priority: 'critical',
      },
      authority_level: 3,
      cooldown_hours: 168,
    },
    {
      name: 'Paying Customer Inactivity',
      description: 'Monitor paying customers inactive for 14+ days',
      trigger_event: 'days_since_login',
      trigger_conditions: { days: 14, stage: 'paying' },
      action_agent: 'harbor',
      action_type: 'add_note',
      action_parameters: {
        note_template: 'Paying customer has been inactive for 14+ days. Consider re-engagement.',
      },
      authority_level: 0,
      cooldown_hours: 168,
    },
    {
      name: 'Trial Day 3 Activation Check',
      description: 'Check activation progress for trial users on day 3',
      trigger_event: 'trial_day_X',
      trigger_conditions: { day: 3, activation_complete: false },
      action_agent: 'beacon',
      action_type: 'add_note',
      action_parameters: {
        note_template: 'Trial user has not completed activation by day 3. Consider onboarding nudge.',
      },
      authority_level: 0,
      cooldown_hours: 72,
    },
    {
      name: 'At-Risk Stage Transition',
      description: 'React when a customer transitions to at_risk stage',
      trigger_event: 'stage_changed',
      trigger_conditions: { stage: 'at_risk' },
      action_agent: 'harbor',
      action_type: 'add_note',
      action_parameters: {
        note_template: 'Customer moved to at_risk stage. Review recent activity and consider proactive outreach.',
        update_do_not_contact: false,
      },
      authority_level: 1,
      cooldown_hours: 48,
    },
    {
      name: 'Billing Health Degradation',
      description: 'Monitor customers with billing health score below 50',
      trigger_event: 'health_score_dropped',
      trigger_conditions: { billing_health_threshold: 50 },
      action_agent: 'forge',
      action_type: 'add_note',
      action_parameters: {
        note_template: 'Billing health score dropped below 50. Check for failed payments or downgrade signals.',
      },
      authority_level: 1,
      cooldown_hours: 72,
    },
  ];

  for (const rule of defaultRules) {
    await query(
      `INSERT INTO lifecycle_rules
         (id, product_id, name, description, trigger_event, trigger_conditions,
          action_agent, action_type, action_parameters, authority_level,
          enabled, cooldown_hours, created_by, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, 'system', datetime('now'))`,
      [
        nanoid(),
        productId,
        rule.name,
        rule.description,
        rule.trigger_event,
        JSON.stringify(rule.trigger_conditions),
        rule.action_agent,
        rule.action_type,
        JSON.stringify(rule.action_parameters),
        rule.authority_level,
        rule.cooldown_hours,
      ]
    );
  }
}

// ─── getRules ─────────────────────────────────────────────────────────────────

export async function getRules(productId: string): Promise<LifecycleRule[]> {
  const result = await query(
    `SELECT * FROM lifecycle_rules WHERE product_id = ? ORDER BY created_at ASC`,
    [productId]
  );
  return (result.rows as unknown as Array<Record<string, unknown>>).map(rowToRule);
}

// ─── shouldTriggerRule ────────────────────────────────────────────────────────

/**
 * Check if a rule should trigger for a customer (respects cooldown).
 */
export async function shouldTriggerRule(ruleId: string, customerId: string): Promise<boolean> {
  const ruleResult = await query(
    `SELECT cooldown_hours FROM lifecycle_rules WHERE id = ?`,
    [ruleId]
  );
  if (ruleResult.rows.length === 0) return false;

  const cooldownHours = (ruleResult.rows[0] as Record<string, unknown>).cooldown_hours as number ?? 72;

  // Check last trigger within cooldown window
  const triggerResult = await query(
    `SELECT id FROM lifecycle_rule_triggers
     WHERE rule_id = ? AND customer_id = ?
       AND triggered_at > datetime('now', ? || ' hours')
     LIMIT 1`,
    [ruleId, customerId, `-${cooldownHours}`]
  );

  return triggerResult.rows.length === 0;
}

// ─── recordTrigger ────────────────────────────────────────────────────────────

/**
 * WHAT A RULE TRIGGER'S OUTCOME MEANS.
 *
 * `success` used to cover three different things, and one of them was nothing
 * happening at all: an action type Foundry does not implement wrote a note
 * saying it had been triggered and returned true, so `success_count` — the
 * number a founder reads as "this rule worked" — counted rules that had never
 * done anything.
 *
 * These say what actually occurred. None of them claims a business outcome:
 * carrying out an action is not the same as the action having worked, and this
 * table has never observed the latter.
 */
export type RuleTriggerOutcome =
  /** The configured action was carried out. Not "it helped". */
  | 'carried_out'
  /** Foundry has no implementation for this action type — nothing was done. */
  | 'unsupported_action'
  /** The action was attempted and threw. */
  | 'failed'
  /** Queued, not yet attempted. */
  | 'pending';

async function recordTrigger(
  ruleId: string,
  productId: string,
  customerId: string,
  outcome: RuleTriggerOutcome
): Promise<void> {
  await query(
    `INSERT INTO lifecycle_rule_triggers (id, rule_id, product_id, customer_id, triggered_at, outcome)
     VALUES (?, ?, ?, ?, datetime('now'), ?)`,
    [nanoid(), ruleId, productId, customerId, outcome]
  );

  // `success_count` counts actions CARRIED OUT. An unsupported action type is
  // neither: nothing was attempted, so counting it as either a success or a
  // failure would describe work that did not happen.
  await query(
    `UPDATE lifecycle_rules
     SET times_triggered = times_triggered + 1,
         success_count = success_count + CASE WHEN ? = 'carried_out' THEN 1 ELSE 0 END,
         failure_count = failure_count + CASE WHEN ? = 'failed' THEN 1 ELSE 0 END
     WHERE id = ?`,
    [outcome, outcome, ruleId]
  );
}

// ─── executeRuleAction ────────────────────────────────────────────────────────

async function executeRuleAction(
  rule: LifecycleRule,
  customer: CustomerRecord
): Promise<RuleTriggerOutcome> {
  try {
    const params = rule.action_parameters;

    if (rule.action_type === 'add_note') {
      const noteTemplate = (params.note_template as string) ?? 'Lifecycle rule triggered.';
      await addAgentNote(customer.id, rule.action_agent, noteTemplate);
      return 'carried_out';
    }

    if (rule.action_type === 'escalate_to_ceo') {
      const message = (params.escalation_message as string) ?? 'Critical customer alert.';
      await addAgentNote(
        customer.id,
        rule.action_agent,
        `[ESCALATION] ${message}`
      );
      return 'carried_out';
    }

    if (rule.action_type === 'create_remediation') {
      await addAgentNote(
        customer.id,
        rule.action_agent,
        `[REMEDIATION NEEDED] ${(params.note_template as string) ?? 'Customer requires remediation.'}`
      );
      return 'carried_out';
    }

    // An action type with no implementation. Writing a note saying it was
    // triggered and reporting success is the version of this that tells a
    // founder their rule is working while it does nothing at all.
    await addAgentNote(
      customer.id,
      rule.action_agent,
      `[RULE: ${rule.name}] Action type '${rule.action_type}' is not implemented — nothing was done.`
    );
    return 'unsupported_action';
  } catch {
    return 'failed';
  }
}

// ─── customerMatchesRule ──────────────────────────────────────────────────────

function customerMatchesRule(customer: CustomerRecord, rule: LifecycleRule): boolean {
  const cond = rule.trigger_conditions;

  switch (rule.trigger_event) {
    case 'health_score_dropped': {
      const threshold = cond.threshold as number | undefined;
      if (threshold !== undefined && customer.health_score >= threshold) return false;
      const billingThreshold = cond.billing_health_threshold as number | undefined;
      if (billingThreshold !== undefined && customer.billing_health_score >= billingThreshold) return false;
      return true;
    }

    case 'stage_changed': {
      const stage = cond.stage as string | undefined;
      if (stage && customer.stage !== stage) return false;
      return true;
    }

    case 'days_since_login': {
      const days = cond.days as number | undefined;
      const stage = cond.stage as string | undefined;
      if (stage && customer.stage !== stage) return false;
      if (!customer.last_active_at) return true; // Never logged in = infinite days
      if (days !== undefined) {
        const lastActive = new Date(customer.last_active_at).getTime();
        const daysSince = (Date.now() - lastActive) / (1000 * 60 * 60 * 24);
        if (daysSince < days) return false;
      }
      return true;
    }

    case 'trial_day_X': {
      if (customer.stage !== 'trial') return false;
      const activationRequired = cond.activation_complete as boolean | undefined;
      if (activationRequired === false && customer.activation_complete) return false;
      // Check day of trial
      const day = cond.day as number | undefined;
      if (day !== undefined) {
        const createdAt = new Date(customer.created_at).getTime();
        const trialDay = Math.floor((Date.now() - createdAt) / (1000 * 60 * 60 * 24));
        if (trialDay !== day) return false;
      }
      return true;
    }

    case 'payment_failed': {
      // Proxy via billing_health_score below threshold
      return customer.billing_health_score < 50;
    }

    default:
      return false;
  }
}

// ─── evaluateLifecycleRules ───────────────────────────────────────────────────

/**
 * Evaluate all enabled rules for all customers in a product.
 * Called daily by the scheduler.
 */
export async function evaluateLifecycleRules(productId: string): Promise<{
  rules_evaluated: number;
  rules_triggered: number;
  actions_created: number;
}> {
  const [rules, customers] = await Promise.all([
    getRules(productId),
    getCustomersByStage(productId), // all stages
  ]);

  const enabledRules = rules.filter((r) => r.enabled);
  let rulesTriggered = 0;
  let actionsCreated = 0;

  for (const customer of customers) {
    for (const rule of enabledRules) {
      if (!customerMatchesRule(customer, rule)) continue;

      const canTrigger = await shouldTriggerRule(rule.id, customer.id);
      if (!canTrigger) continue;

      const outcome = await executeRuleAction(rule, customer);
      await recordTrigger(rule.id, productId, customer.id, outcome);

      rulesTriggered++;
      // `actions_created` counts actions. An action type with no
      // implementation created none, however many notes were written about it.
      if (outcome === 'carried_out') actionsCreated++;
    }
  }

  return {
    rules_evaluated: enabledRules.length * customers.length,
    rules_triggered: rulesTriggered,
    actions_created: actionsCreated,
  };
}

// ─── toggleRule ───────────────────────────────────────────────────────────────

export async function toggleRule(ruleId: string, enabled: boolean): Promise<void> {
  await query(
    `UPDATE lifecycle_rules SET enabled = ? WHERE id = ?`,
    [enabled ? 1 : 0, ruleId]
  );
}

// Re-export CustomerRecord so callers don't have to import from two places
export type { CustomerRecord };
