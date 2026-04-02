// =============================================================================
// FOUNDRY — RBAC Enforcement Middleware
// Gates routes by permission or minimum role level.
// =============================================================================

import { createMiddleware } from 'hono/factory';
import { hasPermission } from '../services/rbac/permissions.js';

/**
 * Require a specific RBAC permission for a route.
 * Falls back to owner-level access (always allowed) if user is the product owner.
 *
 * Usage in routes:
 *   router.use('*', requirePermission('experiments:manage'));
 *   router.get('/', requirePermission('briefings:view'), handler);
 */
export function requirePermission(permission: string) {
  return createMiddleware(async (c, next) => {
    const productId = c.get('productId') as string | undefined;
    const userId = c.get('userId') as string | undefined;

    if (!productId || !userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Check if user is the product owner (owners always have all permissions)
    const { query } = await import('../db/client.js');
    const ownerCheck = await query(
      `SELECT id FROM products WHERE id=? AND owner_id=?`,
      [productId, userId]
    );

    if (ownerCheck.rows.length > 0) {
      // Product owner — skip RBAC check
      await next();
      return;
    }

    // Check RBAC permission
    const allowed = await hasPermission(productId, userId, permission);
    if (!allowed) {
      // Return HTML forbidden page for browser requests, JSON for API requests
      const acceptHeader = c.req.header('Accept') ?? '';
      if (acceptHeader.includes('text/html')) {
        return c.html(`
          <!DOCTYPE html><html><body style="font-family:sans-serif;max-width:480px;margin:100px auto;text-align:center;">
          <h2>Access Restricted</h2>
          <p>You don't have permission to access this area. Required: <code>${permission}</code></p>
          <a href="/dashboard">&#8592; Back to Dashboard</a>
          </body></html>
        `, 403);
      }
      return c.json({ error: `Insufficient permissions. Required: ${permission}` }, 403);
    }

    await next();
  });
}

/**
 * Require a minimum role level.
 * Roles in order: viewer < analyst < admin < owner
 */
export function requireRole(minimumRole: 'viewer' | 'analyst' | 'admin' | 'owner') {
  const roleRank = { viewer: 1, analyst: 2, admin: 3, owner: 4 };

  return createMiddleware(async (c, next) => {
    const productId = c.get('productId') as string | undefined;
    const userId = c.get('userId') as string | undefined;

    if (!productId || !userId) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const { getUserRole } = await import('../services/rbac/permissions.js');
    const { query } = await import('../db/client.js');

    // Check if owner
    const ownerCheck = await query(`SELECT id FROM products WHERE id=? AND owner_id=?`, [productId, userId]);
    if (ownerCheck.rows.length > 0) {
      await next();
      return;
    }

    const role = await getUserRole(productId, userId);
    const userRank = role ? (roleRank[role as keyof typeof roleRank] ?? 0) : 0;
    const requiredRank = roleRank[minimumRole];

    if (userRank < requiredRank) {
      return c.json({ error: `Requires ${minimumRole} role or higher` }, 403);
    }

    await next();
  });
}
