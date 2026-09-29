// =============================================================================
// FOUNDRY — which Clerk instance this deployment signs people in with
//
// Clerk keys say which instance they belong to: `sk_test_` / `pk_test_` for a
// development instance, `sk_live_` / `pk_live_` for production. A development
// instance can be reset, and that would lock the owner out of their own
// institution (PENDING 24). So the kind is read from the keys and reported by
// health, never taken from a setting that could say something else.
//
// A production publishable key also carries the instance's Frontend API host —
// `pk_live_` + base64("clerk.<domain>$") — which is the host the sign-in pages
// load Clerk from. It is decoded here for the security policy, and refused
// unless it is a bare hostname: whatever this returns is written into a
// Content-Security-Policy header, and a key is configuration, not something to
// trust with the syntax of a policy.
// =============================================================================

export type ClerkInstance = 'development' | 'production' | 'mismatched' | 'not_configured';

function kindOf(key: string | undefined, secret: boolean): 'development' | 'production' | null {
  const k = (key ?? '').trim();
  const [dev, live] = secret ? ['sk_test_', 'sk_live_'] : ['pk_test_', 'pk_live_'];
  if (k.startsWith(dev)) return 'development';
  if (k.startsWith(live)) return 'production';
  return null;
}

export function clerkInstanceOf(env: NodeJS.ProcessEnv = process.env): ClerkInstance {
  const secret = kindOf(env.CLERK_SECRET_KEY, true);
  const publishable = kindOf(env.CLERK_PUBLISHABLE_KEY, false);
  if (!secret && !publishable) return 'not_configured';
  if (secret !== publishable) return 'mismatched';
  return secret as 'development' | 'production';
}

const HOSTNAME = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/;

/** The Frontend API host a production publishable key names, or null. */
export function clerkFrontendHost(publishableKey: string | undefined): string | null {
  const k = (publishableKey ?? '').trim();
  if (!k.startsWith('pk_live_')) return null;
  const encoded = k.slice('pk_live_'.length);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) return null;
  let decoded: string;
  try { decoded = Buffer.from(encoded, 'base64').toString('utf8'); } catch { return null; }
  const host = decoded.endsWith('$') ? decoded.slice(0, -1) : decoded;
  return HOSTNAME.test(host) ? host : null;
}
