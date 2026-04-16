// =============================================================================
// @foundry/sdk — Adapter Core
// Creates the adapter instance with sync, middleware, and optional UI.
// =============================================================================

import type { FoundryAdapterConfig, FoundrySyncPayload, SchemaMapping } from './types.js';
import { buildMetricsFromSchema } from './metrics.js';

const DEFAULT_FOUNDRY_URL = 'https://foundry.app';
const DEFAULT_SYNC_INTERVAL_MINUTES = 60;

export interface FoundryAdapter {
  /**
   * Manually trigger a metric sync to Foundry.
   * Call this from a cron job or after significant events.
   */
  sync(): Promise<{ success: boolean; error?: string }>;

  /**
   * Returns a Hono sub-application that serves the embedded Signal view.
   * Mount this at a protected admin route.
   */
  honoApp(): unknown;

  /**
   * Returns an Express-compatible middleware function.
   * Mount this at a protected admin route.
   */
  expressMiddleware(): unknown;

  /**
   * Stop the automatic sync interval (if running).
   */
  destroy(): void;
}

export function createFoundryAdapter(config: FoundryAdapterConfig): FoundryAdapter {
  const {
    apiKey,
    productId,
    foundryUrl = DEFAULT_FOUNDRY_URL,
    schema,
    queryFn,
    syncIntervalMinutes = DEFAULT_SYNC_INTERVAL_MINUTES,
    mountUI = true,
    wisdomNetworkOptIn = true,
  } = config;

  if (!apiKey)     throw new Error('@foundry/sdk: apiKey is required');
  if (!productId)  throw new Error('@foundry/sdk: productId is required');

  let syncTimer: ReturnType<typeof setInterval> | null = null;

  // Start automatic sync if configured
  if (syncIntervalMinutes > 0 && queryFn) {
    syncTimer = setInterval(() => {
      adapter.sync().catch(console.error);
    }, syncIntervalMinutes * 60 * 1000);
  }

  const adapter: FoundryAdapter = {
    async sync() {
      if (!queryFn) {
        return { success: false, error: 'queryFn is required for metric sync' };
      }

      const resolvedSchema = schema ?? {};
      let payload: FoundrySyncPayload;

      try {
        payload = await buildMetricsFromSchema(queryFn, resolvedSchema, productId);
      } catch (err) {
        return { success: false, error: String(err) };
      }

      try {
        const res = await fetch(`${foundryUrl}/api/products/${productId}/metrics`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Foundry-API-Key': apiKey,
          },
          body: JSON.stringify(payload),
        });

        if (!res.ok) {
          const text = await res.text().catch(() => '');
          return { success: false, error: `HTTP ${res.status}: ${text}` };
        }

        return { success: true };
      } catch (err) {
        return { success: false, error: String(err) };
      }
    },

    honoApp() {
      // Lazily import Hono to keep it as a peer dependency
      try {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { Hono } = require('hono');
        const app = new Hono();

        app.get('/', async (c: { html: (h: string) => unknown }) => {
          return c.html(renderEmbeddedSignalFrame(foundryUrl, productId, apiKey, mountUI));
        });

        app.post('/sync', async (c: { json: (d: unknown, s?: number) => unknown }) => {
          const result = await adapter.sync();
          return c.json(result, result.success ? 200 : 503);
        });

        return app;
      } catch {
        throw new Error('@foundry/sdk: hono is required as a peer dependency');
      }
    },

    expressMiddleware() {
      return async (
        req: { method: string; path: string },
        res: { send: (h: string) => void; json: (d: unknown) => void; status: (c: number) => { json: (d: unknown) => void } }
      ) => {
        if (req.method === 'GET') {
          res.send(renderEmbeddedSignalFrame(foundryUrl, productId, apiKey, mountUI));
        } else if (req.method === 'POST' && req.path === '/sync') {
          const result = await adapter.sync();
          if (result.success) {
            res.json(result);
          } else {
            res.status(503).json(result);
          }
        }
      };
    },

    destroy() {
      if (syncTimer) {
        clearInterval(syncTimer);
        syncTimer = null;
      }
    },
  };

  return adapter;
}

// ─── Embedded UI Frame ────────────────────────────────────────────────────────

function renderEmbeddedSignalFrame(
  foundryUrl: string,
  productId: string,
  apiKey: string,
  mountUI: boolean
): string {
  if (!mountUI) {
    return `<!DOCTYPE html><html><body><p>Foundry SDK — UI disabled. Sync is active.</p></body></html>`;
  }

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Foundry — Business Intelligence</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #0a0a12; color: #e4e4f0; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .frame { text-align: center; padding: 2rem; }
    .powered { font-size: 0.72rem; color: #44445a; margin-top: 1rem; letter-spacing: 0.08em; }
    .powered a { color: #6c63ff; text-decoration: none; }
  </style>
</head>
<body>
  <div class="frame">
    <iframe
      src="${foundryUrl}/embed/signal?product_id=${productId}&key=${encodeURIComponent(apiKey)}"
      style="border: none; width: 340px; height: 480px; border-radius: 12px;"
      title="Foundry Signal"
      loading="lazy"
    ></iframe>
    <div class="powered">Powered by <a href="${foundryUrl}" target="_blank">Foundry</a></div>
  </div>
</body>
</html>`;
}
