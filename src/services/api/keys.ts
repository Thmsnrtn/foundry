// =============================================================================
// FOUNDRY — API Key Authentication Middleware Helper
// Thin wrapper for extracting and validating Bearer API keys from HTTP headers.
// =============================================================================

import { validateApiKey } from '../rbac/permissions.js';

// ─── authenticateApiKey ───────────────────────────────────────────────────────

/**
 * Extracts a Bearer token from the Authorization header and validates it.
 * Returns the associated product/user context, or null if invalid.
 */
export async function authenticateApiKey(
  authHeader: string | undefined
): Promise<{
  productId: string;
  userId: string;
  scopes: string[];
} | null> {
  if (!authHeader) return null;

  const match = /^Bearer\s+(.+)$/i.exec(authHeader.trim());
  if (!match) return null;

  const token = match[1].trim();
  if (!token) return null;

  return validateApiKey(token);
}
