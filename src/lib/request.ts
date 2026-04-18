// =============================================================================
// FOUNDRY — Request Body Parser
// Handles both JSON and form-encoded bodies transparently.
// =============================================================================

/**
 * Parse request body from either JSON or form-encoded format.
 * Allows routes to accept both API calls and browser form submissions.
 */
export async function parseRequestBody(c: {
  req: {
    header: (n: string) => string | undefined;
    json: () => Promise<any>;
    parseBody: () => Promise<any>;
  };
}): Promise<Record<string, unknown>> {
  const ct = c.req.header('Content-Type') ?? '';
  if (ct.includes('application/json')) {
    return await c.req.json();
  }
  return (await c.req.parseBody()) as Record<string, unknown>;
}

/**
 * Return JSON for API requests, redirect for browser requests.
 */
export function respondWithRedirectOrJson(
  c: any,
  redirectUrl: string,
  jsonBody: Record<string, unknown>,
  status: number = 200,
): Response {
  const accept = c.req.header('Accept') ?? '';
  if (accept.includes('text/html')) {
    return c.redirect(redirectUrl);
  }
  return c.json(jsonBody, status);
}
