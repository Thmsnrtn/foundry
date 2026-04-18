// =============================================================================
// FOUNDRY — Input Validation Schemas
// Zod schemas for all API and form inputs. Central definition prevents drift.
// =============================================================================

import { z } from 'zod';

// ─── Metrics ────────────────────────────────────────────────────────────────

export const reportMetricsSchema = z.object({
  signups_7d: z.number().int().min(0).optional(),
  active_users: z.number().int().min(0).optional(),
  new_mrr_cents: z.number().int().min(0).optional(),
  expansion_mrr_cents: z.number().int().min(0).optional(),
  contraction_mrr_cents: z.number().int().min(0).optional(),
  churned_mrr_cents: z.number().int().min(0).optional(),
  activation_rate: z.number().min(0).max(1).optional(),
  day_30_retention: z.number().min(0).max(1).optional(),
  support_volume_7d: z.number().int().min(0).optional(),
  nps_score: z.number().min(-100).max(100).optional(),
  churn_rate: z.number().min(0).max(1).optional(),
  custom_metrics: z.record(z.unknown()).optional(),
});

export type ReportMetricsInput = z.infer<typeof reportMetricsSchema>;

// ─── Decisions ──────────────────────────────────────────────────────────────

export const resolveDecisionSchema = z.object({
  chosen_option: z.string().min(1).max(500),
  resolution_reasoning: z.string().max(5000).optional(),
});

export const recordOutcomeSchema = z.object({
  outcome: z.string().min(1).max(5000),
});

// ─── Onboarding ─────────────────────────────────────────────────────────────

export const selectRepoSchema = z.object({
  repo_owner: z.string().min(1).max(200).regex(/^[\w.-]+$/),
  repo_name: z.string().min(1).max(200).regex(/^[\w.-]+$/),
  access_token: z.string().min(1),
  market_category: z.string().max(200).optional(),
});

export const competitorSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().max(500).optional().or(z.literal('')),
  positioning: z.string().max(1000).optional(),
});

export const addCompetitorsSchema = z.object({
  product_id: z.string().min(1),
  competitors: z.array(competitorSchema).max(10).optional(),
});

// ─── Competitive Intelligence ───────────────────────────────────────────────

export const addCompetitorSchema = z.object({
  name: z.string().min(1).max(200),
  website: z.string().url().max(500).optional().or(z.literal('')),
  positioning: z.string().max(2000).optional(),
  primary_icp: z.string().max(500).optional(),
  pricing_model: z.string().max(500).optional(),
});

// ─── Beta Intake ────────────────────────────────────────────────────────────

export const betaIntakeSchema = z.object({
  participant_name: z.string().min(1).max(200),
  interview_summary: z.string().max(10000).optional(),
  key_quotes: z
    .array(
      z.object({
        quote: z.string().min(1).max(2000),
        theme: z.string().min(1).max(200),
      })
    )
    .max(20)
    .optional(),
  activation_outcome: z.record(z.unknown()).optional(),
  testimonial_text: z.string().max(5000).optional(),
  testimonial_permitted: z.boolean().optional(),
  positioning_feedback: z.string().max(5000).optional(),
  hypothesis_signals: z.record(z.unknown()).optional(),
});

// ─── Product DNA ────────────────────────────────────────────────────────────

const DNA_ALLOWED_FIELDS = [
  'icp_description',
  'icp_pain',
  'icp_trigger',
  'icp_sophistication',
  'positioning_statement',
  'what_we_are_not',
  'primary_objection',
  'objection_response',
  'market_insight',
  'retention_hypothesis',
  'growth_hypothesis',
  'voice_principles',
  'positioning_history',
] as const;

export const productDNAUpdateSchema = z
  .record(z.unknown())
  .refine(
    (data) => {
      const keys = Object.keys(data);
      return keys.every((k) => (DNA_ALLOWED_FIELDS as readonly string[]).includes(k));
    },
    {
      message: `Only the following fields are allowed: ${DNA_ALLOWED_FIELDS.join(', ')}`,
    }
  );

// ─── Settings ───────────────────────────────────────────────────────────────

export const preferencesSchema = z.object({
  digest_time: z.string().regex(/^\d{2}:\d{2}$/).optional(),
  timezone: z.string().max(100).optional(),
  notification_channels: z.array(z.enum(['email', 'dashboard'])).optional(),
});

// ─── Failure Log ────────────────────────────────────────────────────────────

export const failureLogSchema = z.object({
  category: z.enum([
    'positioning',
    'pricing',
    'onboarding',
    'acquisition',
    'retention',
    'messaging',
    'feature',
    'operations',
    'other',
  ]),
  what_was_tried: z.string().min(1).max(5000),
  timeframe: z.string().max(200).optional(),
  outcome: z.string().min(1).max(5000),
  founder_hypothesis: z.string().max(5000).optional(),
  linked_stressor_id: z.string().optional(),
});

// ─── Helpers ────────────────────────────────────────────────────────────────

/**
 * Validate input and return typed result, or throw a 400-friendly error.
 */
export function validate<T>(schema: z.ZodSchema<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const messages = result.error.issues.map(
      (i) => `${i.path.join('.')}: ${i.message}`
    );
    const err = new Error(`Validation failed: ${messages.join('; ')}`);
    (err as any).status = 400;
    (err as any).issues = result.error.issues;
    throw err;
  }
  return result.data;
}
