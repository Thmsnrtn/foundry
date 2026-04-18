// =============================================================================
// FOUNDRY — Request Body Validation Middleware
// Validates incoming JSON/form bodies against Zod schemas.
// Returns 422 with structured field errors on validation failure.
// =============================================================================

import { z } from 'zod';
import type { Context, Next } from 'hono';

/**
 * Validate request body against a Zod schema.
 * On success, stores the parsed data via `c.set('validatedBody', ...)`.
 * On failure, returns 422 with `{ error, details }`.
 */
export function validateBody<T extends z.ZodType>(schema: T) {
  return async (c: Context, next: Next) => {
    try {
      const ct = c.req.header('Content-Type') ?? '';
      let body: unknown;
      if (ct.includes('application/json')) {
        body = await c.req.json();
      } else {
        body = await c.req.parseBody();
      }
      const result = schema.safeParse(body);
      if (!result.success) {
        return c.json({
          error: 'Validation failed',
          details: result.error.flatten().fieldErrors,
        }, 422);
      }
      c.set('validatedBody' as never, result.data as never);
      await next();
    } catch {
      return c.json({ error: 'Invalid request body' }, 400);
    }
  };
}
