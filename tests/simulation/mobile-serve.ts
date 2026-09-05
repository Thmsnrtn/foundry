// Serves the owner surface with a real blocking decision present, so the phone
// composition can be driven exactly as it renders. Not a test: the harness the
// acceptance test and a person both point a browser at.
process.env.NODE_ENV = 'test';
process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.CLERK_SECRET_KEY = 'sk_test_fake';
process.env.CLERK_PUBLISHABLE_KEY = 'pk_test_fake';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.APP_URL = 'http://localhost:8099';
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

const { Hono } = await import('hono');
const { serve } = await import('@hono/node-server');
const { runMigrations } = await import('../../src/db/migrate.js');
const { query } = await import('../../src/db/client.js');

await runMigrations();
const F = 'mob_owner';
await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
  [F, 'clerk_mob', 'owner@example.com', 'Thomas']);
await query('INSERT INTO products (id,name,owner_id,status,scp_status) VALUES (?,?,?,?,?)',
  ['mob_p', 'Private Foundry', F, 'active', 'active']);

const { produceSchemaDescription } = await import(
  '../../src/services/institution/carrying.js');
await produceSchemaDescription({ founderId: F, evidenceMode: 'real' });

const founder = (await query('SELECT * FROM founders WHERE id = ?', [F]))
  .rows[0] as Record<string, unknown>;

const app = new (Hono as any)();
app.use('*', async (c: any, next: any) => {
  c.set('founder', founder); c.set('userId', F); c.set('csrfToken', 'test-csrf');
  await next();
});
app.onError((err: any, c: any) => c.text(`ERR: ${String(err?.stack ?? err)}`, 500));
const shell = await import('../../src/routes/dashboard/foundry-shell.js');
app.route('/', (shell as any).foundryShellRoutes);

serve({ fetch: app.fetch, port: 8099 });
console.log('SERVING 8099');
