// =============================================================================
// FOUNDRY — Environment Validation
// Validates all required env vars at startup. Fails fast with clear errors.
// =============================================================================

interface EnvVar {
  name: string;
  required: boolean;
  description: string;
}

const REQUIRED_VARS: EnvVar[] = [
  // Core — app won't start without these
  { name: 'TURSO_DATABASE_URL', required: true, description: 'Turso database URL' },
  { name: 'CLERK_SECRET_KEY', required: true, description: 'Clerk backend secret key' },
  { name: 'CLERK_PUBLISHABLE_KEY', required: true, description: 'Clerk frontend publishable key' },

  // Degraded without these — features disabled, app still runs
  { name: 'TURSO_AUTH_TOKEN', required: false, description: 'Turso auth token (required for remote DB)' },
  { name: 'CLERK_WEBHOOK_SECRET', required: false, description: 'Clerk webhook signing secret — webhook endpoint disabled without this' },
  { name: 'ANTHROPIC_API_KEY', required: false, description: 'Anthropic API key — AI features disabled without this' },
  { name: 'STRIPE_SECRET_KEY', required: false, description: 'Stripe secret key — billing disabled without this' },
  { name: 'STRIPE_WEBHOOK_SECRET', required: false, description: 'Stripe webhook signing secret' },
  { name: 'STRIPE_FOUNDING_COHORT_PRICE_ID', required: false, description: 'Stripe Price ID for Founding Cohort ($99)' },
  { name: 'STRIPE_GROWTH_PRICE_ID', required: false, description: 'Stripe Price ID for Growth ($199)' },
  { name: 'STRIPE_SCALE_PRICE_ID', required: false, description: 'Stripe Price ID for Scale ($399)' },
  { name: 'RESEND_API_KEY', required: false, description: 'Resend API key — email disabled without this' },
  { name: 'RESEND_FROM_ADDRESS', required: false, description: 'From address for emails' },
  { name: 'APP_URL', required: false, description: 'Public app URL — defaults to http://localhost:8080' },
  { name: 'GITHUB_CLIENT_ID', required: false, description: 'GitHub OAuth app client ID' },
  { name: 'GITHUB_CLIENT_SECRET', required: false, description: 'GitHub OAuth app client secret' },
  { name: 'ECOSYSTEM_SERVICE_KEY', required: false, description: 'Internal API authentication key' },
];

export function validateEnvironment(): void {
  const missing: string[] = [];
  const warnings: string[] = [];

  for (const v of REQUIRED_VARS) {
    const value = process.env[v.name];
    if (v.required && !value) {
      missing.push(`  ${v.name} — ${v.description}`);
    } else if (!v.required && !value) {
      warnings.push(`  ${v.name} — ${v.description} (optional, some features disabled)`);
    }
  }

  if (warnings.length > 0) {
    console.warn('\n⚠️  Optional environment variables not set:');
    for (const w of warnings) console.warn(w);
  }

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:\n');
    for (const m of missing) console.error(m);
    console.error(`\nSet these in your .env file or deployment config.\n`);
    process.exit(1);
  }

  console.log('✓ Environment validated');
}
