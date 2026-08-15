// =============================================================================
// FOUNDRY — Test Setup
// Global setup for all test files. Sets test environment variables.
// =============================================================================

// Set test environment variables before any module imports
process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake_key';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake_key';
// Do not install a fake provider credential globally. Code paths that
// intentionally exercise AI must stub both the credential and transport in
// their own test. A fake key here made otherwise deterministic fallback tests
// perform real network retries and occasionally time out.
delete process.env.ANTHROPIC_API_KEY;
delete process.env.OPENROUTER_API_KEY;
process.env.STRIPE_SECRET_KEY = 'sk_test_fake_key';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_fake_secret';
process.env.APP_URL = 'http://localhost:8080';
process.env.ECOSYSTEM_SERVICE_KEY = 'test-ecosystem-key';
