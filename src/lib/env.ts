// =============================================================================
// FOUNDRY — Environment Variable Validation
// Validates all required environment variables at startup.
// Fails fast with actionable error messages.
// =============================================================================

import { z } from 'zod';

const envSchema = z.object({
  // Database
  TURSO_DATABASE_URL: z.string().min(1, 'TURSO_DATABASE_URL is required'),
  TURSO_AUTH_TOKEN: z.string().optional(),

  // Authentication
  CLERK_SECRET_KEY: z.string().min(1, 'CLERK_SECRET_KEY is required'),
  CLERK_PUBLISHABLE_KEY: z.string().min(1, 'CLERK_PUBLISHABLE_KEY is required'),
  CLERK_WEBHOOK_SECRET: z.string().optional(),

  // GitHub OAuth
  GITHUB_CLIENT_ID: z.string().optional(),
  GITHUB_CLIENT_SECRET: z.string().optional(),

  // AI
  ANTHROPIC_API_KEY: z.string().min(1, 'ANTHROPIC_API_KEY is required'),

  // Email
  RESEND_API_KEY: z.string().optional(),
  RESEND_FROM_ADDRESS: z.string().optional(),

  // Payments
  STRIPE_SECRET_KEY: z.string().min(1, 'STRIPE_SECRET_KEY is required'),
  STRIPE_WEBHOOK_SECRET: z.string().optional(),
  STRIPE_FOUNDING_COHORT_PRICE_ID: z.string().optional(),
  STRIPE_GROWTH_PRICE_ID: z.string().optional(),
  STRIPE_SCALE_PRICE_ID: z.string().optional(),

  // Ecosystem
  ECOSYSTEM_SERVICE_KEY: z.string().optional(),
  KOLDLY_INTERNAL_API_URL: z.string().optional(),

  // Application
  APP_URL: z.string().url().default('http://localhost:8080'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.string().default('8080'),
});

export type Env = z.infer<typeof envSchema>;

let _validatedEnv: Env | null = null;

/**
 * Validate environment variables at startup. Throws with all missing vars listed.
 */
export function validateEnv(): Env {
  if (_validatedEnv) return _validatedEnv;

  const result = envSchema.safeParse(process.env);

  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`
    );
    console.error(
      `\n❌ Environment validation failed:\n${issues.join('\n')}\n\nSee .env.example for required variables.\n`
    );
    process.exit(1);
  }

  _validatedEnv = result.data;
  return _validatedEnv;
}

/**
 * Get validated environment. Must call validateEnv() first.
 */
export function env(): Env {
  if (!_validatedEnv) {
    return validateEnv();
  }
  return _validatedEnv;
}
