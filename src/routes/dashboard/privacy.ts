// =============================================================================
// FOUNDRY — Privacy & Data Settings Routes
// Consent management, data residency, and GDPR-style data export.
// =============================================================================

import { Hono } from 'hono';
import { clientIp } from '../../middleware/rate-limit.js';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  recordConsent,
  getOrInitConsents,
  getConsentTimestamps,
  getDataResidencySettings,
  updateDataResidencySettings,
  exportProductData,
  scheduleDataDeletion,
  type ConsentType,
} from '../../services/privacy/consent.js';
import { getProductsByOwner } from '../../db/client.js';

export const privacySettings = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtDatetime(dateStr: string | null | undefined): string {
  if (!dateStr) return 'Never';
  const d = new Date(dateStr);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function regionLabel(region: string): string {
  const map: Record<string, string> = {
    'us-east': 'US East (N. Virginia)',
    'us-west': 'US West (Oregon)',
    'eu-west': 'EU West (Ireland)',
    'ap-southeast': 'AP Southeast (Singapore)',
  };
  return map[region] ?? region;
}

function retentionLabel(days: number): string {
  if (days === 365) return '1 year';
  if (days === 730) return '2 years';
  if (days === 1825) return '5 years';
  if (days === 0) return 'Forever';
  return `${days} days`;
}

function logRetentionLabel(days: number): string {
  if (days === 30) return '30 days';
  if (days === 90) return '90 days';
  if (days === 365) return '1 year';
  return `${days} days`;
}

// ─── Toggle Component ─────────────────────────────────────────────────────────

function toggle(name: string, checked: boolean, id: string): string {
  return `<label class="toggle-switch" for="${id}" style="position:relative;display:inline-block;width:44px;height:24px;cursor:pointer;flex-shrink:0;">
    <input type="checkbox" id="${id}" name="${name}" value="1"${checked ? ' checked' : ''} style="opacity:0;width:0;height:0;position:absolute;" onchange="this.closest('form').submit()">
    <span style="position:absolute;inset:0;border-radius:24px;background:${checked ? '#4ecca3' : 'rgba(255,255,255,0.12)'};transition:background 0.2s;"></span>
    <span style="position:absolute;top:3px;left:${checked ? '23px' : '3px'};width:18px;height:18px;border-radius:50%;background:#fff;transition:left 0.2s;box-shadow:0 1px 3px rgba(0,0,0,0.3);"></span>
  </label>`;
}

// ─── GET /privacy ──────────────────────────────────────────────────────────────

privacySettings.get('/privacy', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Privacy & Data', undefined, c);
  const successMsg = c.req.query('success');

  if (!ctx.productId) {
    const content = html`
      <h1 style="margin:0 0 0.5rem;">Privacy &amp; Data</h1>
      <p style="color:var(--text-dim);">No product selected.</p>
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const productId = ctx.productId;

  const [consents, timestamps, residency] = await Promise.all([
    getOrInitConsents(productId),
    getConsentTimestamps(productId),
    getDataResidencySettings(productId),
  ]);

  const successBannerText = successMsg === 'all_deletion_scheduled'
    ? `Deletion scheduled for all ${ctx.allProducts.length} product${ctx.allProducts.length !== 1 ? 's' : ''}. Data will be removed after 30 days.`
    : successMsg === 'deletion_scheduled'
    ? 'Deletion scheduled. Product data will be removed after 30 days.'
    : successMsg
    ? 'Settings saved successfully.'
    : null;

  const successBanner = successBannerText
    ? html`<div style="background:${successMsg?.includes('deletion') ? '#ff6b6b22' : '#4ecca322'};border:1px solid ${successMsg?.includes('deletion') ? '#ff6b6b44' : '#4ecca344'};border-radius:8px;padding:0.75rem 1.25rem;margin-bottom:1.5rem;color:${successMsg?.includes('deletion') ? '#ff6b6b' : '#4ecca3'};font-size:0.875rem;font-weight:500;">
        ${successBannerText}
      </div>`
    : '';

  const consentItems: Array<{ name: ConsentType; label: string; description: string; learnMore: string; }> = [
    {
      name: 'benchmark_contribution',
      label: 'Anonymized Benchmarking',
      description: 'Share your anonymized metrics to the Foundry benchmarking pool. You\'ll get industry percentile comparisons in return.',
      learnMore: 'Your data is stripped of all identifying information before contributing. Only aggregated statistics are ever accessible to other founders.',
    },
    {
      name: 'aggregate_insights',
      label: 'Aggregate Insights',
      description: 'Receive insights derived from anonymized data across all Foundry products in your category.',
      learnMore: 'Insights are generated from statistical patterns across hundreds of products. No individual product data is ever revealed.',
    },
    {
      name: 'product_improvement',
      label: 'Help Improve Foundry',
      description: 'Allow Foundry to use your anonymized usage patterns to improve the product for everyone.',
      learnMore: 'This covers feature usage, navigation patterns, and error rates — never your business data or customer information.',
    },
    {
      name: 'ai_training_opt_out',
      label: 'Opt Out of AI Training',
      description: 'Your data is never used to train AI models. Enable this to make that preference explicit.',
      learnMore: 'By default, Foundry does not use your data for AI training. This toggle is a formal, auditable record of your preference.',
    },
  ];

  const consentRows = consentItems.map((item) => {
    const checked = consents[item.name];
    const lastUpdated = timestamps[item.name];
    const detailsId = `details-${item.name}`;

    return html`
    <div style="padding:1.25rem;border-bottom:1px solid rgba(255,255,255,0.05);">
      <form method="POST" action="/privacy/consent" style="display:contents;">
        <input type="hidden" name="consent_type" value="${item.name}" />
        <div style="display:flex;align-items:flex-start;gap:1rem;">
          ${''}${toggle(item.name, checked, `toggle-${item.name}`)}
          <div style="flex:1;min-width:0;">
            <div style="display:flex;align-items:baseline;gap:0.75rem;flex-wrap:wrap;">
              <span style="font-size:0.9rem;font-weight:600;color:var(--text-primary);">${item.label}</span>
              <span style="font-size:0.72rem;color:var(--text-muted);">Updated: ${fmtDatetime(lastUpdated)}</span>
            </div>
            <p style="margin:0.25rem 0 0;font-size:0.82rem;color:var(--text-dim);line-height:1.5;">${item.description}</p>
            <details id="${detailsId}" style="margin-top:0.5rem;">
              <summary style="font-size:0.78rem;color:var(--accent);cursor:pointer;list-style:none;display:inline-flex;align-items:center;gap:0.3rem;user-select:none;">
                Learn more
              </summary>
              <p style="margin:0.5rem 0 0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;background:rgba(255,255,255,0.03);padding:0.625rem 0.875rem;border-radius:6px;border-left:2px solid rgba(255,255,255,0.1);">
                ${item.learnMore}
              </p>
            </details>
          </div>
        </div>
      </form>
    </div>`;
  });

  const regionOptions = [
    { value: 'us-east', label: 'US East (N. Virginia)' },
    { value: 'us-west', label: 'US West (Oregon)' },
    { value: 'eu-west', label: 'EU West (Ireland)' },
    { value: 'ap-southeast', label: 'AP Southeast (Singapore)' },
  ];

  const retentionOptions = [
    { value: '365', label: '1 year' },
    { value: '730', label: '2 years' },
    { value: '1825', label: '5 years' },
    { value: '0', label: 'Forever' },
  ];

  const logRetentionOptions = [
    { value: '30', label: '30 days' },
    { value: '90', label: '90 days' },
    { value: '365', label: '1 year' },
  ];

  const regionSelect = regionOptions.map((opt) =>
    `<option value="${opt.value}"${residency.preferred_region === opt.value ? ' selected' : ''}>${opt.label}</option>`
  ).join('');

  const retentionSelect = retentionOptions.map((opt) =>
    `<option value="${opt.value}"${String(residency.data_retention_days) === opt.value ? ' selected' : ''}>${opt.label}</option>`
  ).join('');

  const logRetentionSelect = logRetentionOptions.map((opt) =>
    `<option value="${opt.value}"${String(residency.delete_agent_logs_after_days) === opt.value ? ' selected' : ''}>${opt.label}</option>`
  ).join('');

  const content = html`
    ${successBanner}

    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:1.75rem;flex-wrap:wrap;gap:0.5rem;">
      <div>
        <h1 style="margin:0 0 0.25rem;">Privacy &amp; Data</h1>
        <p style="margin:0;font-size:0.875rem;color:var(--text-dim);">Control how your data is shared, stored, and used across the Foundry platform.</p>
      </div>
    </div>

    <!-- Section 1: Data Sharing & Consent -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.02);">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">Section 1</div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">Data Sharing &amp; Consent</h2>
        <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-dim);">Toggle each data sharing preference. Changes take effect immediately.</p>
      </div>
      ${consentRows}
    </div>

    <!-- Section 2: Data Residency -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.02);">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">Section 2</div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">Data Residency</h2>
        <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-dim);">Choose where your data is stored and how long it is retained.</p>
      </div>
      <div style="padding:1.25rem;">
        <form method="POST" action="/privacy/residency">
          <div style="display:grid;gap:1.25rem;">

            <div>
              <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;" for="preferred_region">
                Preferred Region
                <span style="font-size:0.72rem;font-weight:400;color:#ffb347;margin-left:0.5rem;">&#9432; Data residency enforcement coming soon</span>
              </label>
              <select id="preferred_region" name="preferred_region" class="input" style="max-width:320px;">
                ${''}${html([regionSelect] as unknown as TemplateStringsArray)}
              </select>
              <p style="margin:0.35rem 0 0;font-size:0.75rem;color:var(--text-muted);">Current: ${regionLabel(residency.preferred_region)}</p>
            </div>

            <div>
              <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;" for="data_retention_days">
                Data Retention Period
              </label>
              <select id="data_retention_days" name="data_retention_days" class="input" style="max-width:200px;">
                ${''}${html([retentionSelect] as unknown as TemplateStringsArray)}
              </select>
              <p style="margin:0.35rem 0 0;font-size:0.75rem;color:var(--text-muted);">How long Foundry retains your product data. Current: ${retentionLabel(residency.data_retention_days)}</p>
            </div>

            <div>
              <label style="display:block;font-size:0.8rem;font-weight:600;color:var(--text-primary);margin-bottom:0.5rem;" for="delete_agent_logs_after_days">
                Agent Log Retention
              </label>
              <select id="delete_agent_logs_after_days" name="delete_agent_logs_after_days" class="input" style="max-width:200px;">
                ${''}${html([logRetentionSelect] as unknown as TemplateStringsArray)}
              </select>
              <p style="margin:0.35rem 0 0;font-size:0.75rem;color:var(--text-muted);">Agent activity logs older than this are automatically deleted. Current: ${logRetentionLabel(residency.delete_agent_logs_after_days)}</p>
            </div>

          </div>
          <div style="margin-top:1.25rem;">
            <button type="submit" class="btn btn-primary">Save Residency Settings</button>
          </div>
        </form>
      </div>
    </div>

    <!-- Section 3: Your Data -->
    <div class="card" style="padding:0;overflow:hidden;margin-bottom:1.5rem;">
      <div style="padding:1rem 1.25rem;border-bottom:1px solid rgba(255,255,255,0.07);background:rgba(255,255,255,0.02);">
        <div style="font-size:0.65rem;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.2rem;">Section 3</div>
        <h2 style="margin:0;font-size:1rem;font-weight:700;">Your Data</h2>
        <p style="margin:0.25rem 0 0;font-size:0.8rem;color:var(--text-dim);">Export or delete your product data at any time.</p>
      </div>
      <div style="padding:1.25rem;display:flex;flex-direction:column;gap:1.25rem;">

        <div style="display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--text-primary);margin-bottom:0.25rem;">Export Current Product</div>
            <p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">Download a complete copy of your current product data — metrics, briefings, decisions, customers, and agent configuration.</p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-shrink:0;flex-wrap:wrap;">
            <a href="/privacy/export" class="btn btn-ghost" style="white-space:nowrap;" aria-label="Download current product data as JSON">JSON</a>
            <a href="/privacy/export?format=csv" class="btn btn-ghost" style="white-space:nowrap;" aria-label="Download current product data as CSV">CSV</a>
          </div>
        </div>

        ${ctx.allProducts.length > 1 ? html`
        <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:1.25rem;display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-size:0.875rem;font-weight:600;color:var(--accent);margin-bottom:0.25rem;">Export All Products (Fleet)</div>
            <p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">Download data across all ${ctx.allProducts.length} products in a single file. Includes metrics, briefings, decisions, customers, and agent configuration for every product.</p>
          </div>
          <div style="display:flex;gap:0.5rem;flex-shrink:0;flex-wrap:wrap;">
            <a href="/settings/export-all" class="btn btn-ghost" style="white-space:nowrap;" aria-label="Download all products data as JSON">JSON</a>
            <a href="/settings/export-all?format=csv" class="btn btn-ghost" style="white-space:nowrap;" aria-label="Download all products data as CSV">CSV</a>
          </div>
        </div>
        ` : ''}

        <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:1.25rem;display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-size:0.875rem;font-weight:600;color:#ff6b6b;margin-bottom:0.25rem;">Request Product Deletion</div>
            <p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">Permanently delete this product and all associated data. This action cannot be undone. Please export your data first.</p>
          </div>
          <button
            type="button"
            class="btn"
            style="white-space:nowrap;flex-shrink:0;color:#ff6b6b;border-color:#ff6b6b44;background:transparent;"
            onclick="document.getElementById('delete-modal').style.display='flex'"
            aria-label="Delete current product data"
          >
            Delete This Product
          </button>
        </div>

        ${ctx.allProducts.length > 1 ? html`
        <div style="border-top:1px solid rgba(255,255,255,0.05);padding-top:1.25rem;display:flex;align-items:flex-start;gap:1rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:200px;">
            <div style="font-size:0.875rem;font-weight:600;color:#ff6b6b;margin-bottom:0.25rem;">Delete All Products (Fleet)</div>
            <p style="margin:0;font-size:0.8rem;color:var(--text-dim);line-height:1.5;">Schedule deletion for all ${ctx.allProducts.length} products and all associated data. You will see a confirmation listing every product before proceeding.</p>
          </div>
          <a
            href="/settings/delete-all-products"
            class="btn"
            style="white-space:nowrap;flex-shrink:0;color:#ff6b6b;border-color:#ff6b6b44;background:transparent;"
            aria-label="Delete all products"
          >
            Delete All Products
          </a>
        </div>
        ` : ''}

      </div>
    </div>

    <!-- Delete Confirmation Modal -->
    <div id="delete-modal" role="dialog" aria-modal="true" aria-label="Confirm product deletion" style="display:none;position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:1000;align-items:center;justify-content:center;padding:1rem;">
      <div style="background:var(--bg-card);border:1px solid rgba(255,107,107,0.3);border-radius:12px;padding:2rem;max-width:440px;width:100%;">
        <h2 style="margin:0 0 0.75rem;color:#ff6b6b;font-size:1.1rem;">Delete all data for ${ctx.productName}?</h2>
        <p style="margin:0 0 1rem;font-size:0.875rem;color:var(--text-dim);line-height:1.55;">
          This will permanently schedule deletion of all data for <strong>${ctx.productName}</strong> including metrics, briefings, decisions, and agent logs.
          This cannot be undone.
        </p>
        <p style="margin:0 0 1.5rem;font-size:0.8rem;color:var(--text-muted);">
          We recommend <a href="/privacy/export" style="color:var(--accent);">exporting your data</a> before proceeding.
        </p>
        <div style="display:flex;gap:0.75rem;justify-content:flex-end;">
          <button type="button" class="btn btn-ghost" onclick="document.getElementById('delete-modal').style.display='none'">Cancel</button>
          <form method="POST" action="/privacy/delete" style="display:inline;">
            <button type="submit" class="btn" style="color:#ff6b6b;border-color:#ff6b6b44;background:rgba(255,107,107,0.1);">
              Yes, Delete ${ctx.productName}
            </button>
          </form>
        </div>
      </div>
    </div>
    <script>
      document.addEventListener('keydown', function(e) {
        if (e.key === 'Escape') {
          var modal = document.getElementById('delete-modal');
          if (modal && modal.style.display === 'flex') {
            modal.style.display = 'none';
          }
        }
      });
    </script>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /privacy/consent ─────────────────────────────────────────────────────

privacySettings.post('/privacy/consent', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Privacy & Data', undefined, c);

  if (!ctx.productId) return c.redirect('/privacy');

  const body = await c.req.parseBody();
  const consentType = body['consent_type'] as ConsentType | undefined;
  const granted = body[consentType ?? ''] === '1';

  const validTypes: ConsentType[] = [
    'benchmark_contribution',
    'aggregate_insights',
    'product_improvement',
    'ai_training_opt_out',
  ];

  if (!consentType || !validTypes.includes(consentType)) {
    return c.redirect('/privacy');
  }

  // The address is stored as EVIDENCE of the consent, so it has to be one the
  // consenting browser could not have written itself. The raw header is
  // client-supplied; `clientIp` reads the hop a trusted proxy added.
  const ip = clientIp(c);

  await recordConsent(ctx.productId, founder.id, consentType, granted, ip);

  return c.redirect('/privacy?success=1');
});

// ─── POST /privacy/residency ───────────────────────────────────────────────────

privacySettings.post('/privacy/residency', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Privacy & Data', undefined, c);

  if (!ctx.productId) return c.redirect('/privacy');

  const body = await c.req.parseBody();

  const validRegions = ['us-east', 'us-west', 'eu-west', 'ap-southeast'];
  const validRetention = ['365', '730', '1825', '0'];
  const validLogRetention = ['30', '90', '365'];

  const region = String(body['preferred_region'] ?? 'us-east');
  const retentionDays = String(body['data_retention_days'] ?? '730');
  const logDays = String(body['delete_agent_logs_after_days'] ?? '90');

  await updateDataResidencySettings(ctx.productId, {
    preferred_region: validRegions.includes(region) ? region : 'us-east',
    data_retention_days: validRetention.includes(retentionDays) ? parseInt(retentionDays, 10) : 730,
    delete_agent_logs_after_days: validLogRetention.includes(logDays) ? parseInt(logDays, 10) : 90,
  });

  return c.redirect('/privacy?success=1');
});

// ─── CSV Conversion Helper ────────────────────────────────────────────────────

/** UTF-8 BOM for Excel compatibility */
const CSV_BOM = '\uFEFF';

function jsonToCsv(rows: unknown[]): string {
  if (rows.length === 0) return '';
  const headers = Object.keys(rows[0] as Record<string, unknown>);
  const escape = (val: unknown): string => {
    const str = val === null || val === undefined ? '' : String(val);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const lines = [headers.join(',')];
  for (const row of rows) {
    const r = row as Record<string, unknown>;
    lines.push(headers.map((h) => escape(r[h])).join(','));
  }
  return lines.join('\n');
}

function csvResponse(body: string, filename: string): Response {
  return new Response(CSV_BOM + body, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
}

// ─── GET /privacy/export ───────────────────────────────────────────────────────

privacySettings.get('/privacy/export', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Privacy & Data', undefined, c);

  if (!ctx.productId) {
    return c.json({ error: 'No product selected' }, 400);
  }

  const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
  const data = await exportProductData(ctx.productId, format);
  const today = new Date().toISOString().slice(0, 10);

  if (format === 'csv') {
    const sections = Object.entries(data) as Array<[string, unknown[]]>;
    const csvParts = sections
      .filter(([, rows]) => Array.isArray(rows) && rows.length > 0)
      .map(([name, rows]) => `# ${name}\n${jsonToCsv(rows)}`)
      .join('\n\n');

    return csvResponse(csvParts, `foundry-export-${today}.csv`);
  }

  const filename = `foundry-export-${today}.json`;

  const payload = {
    exported_at: new Date().toISOString(),
    product_id: ctx.productId,
    product_name: ctx.productName,
    ...data,
  };

  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ─── GET /settings/export-all — Fleet-wide data export (F-064-A) ─────────────

privacySettings.get('/settings/export-all', async (c) => {
  const founder = c.get('founder');
  // DELIBERATELY OWNER-ONLY. Erasure and export are the data controller's
  // rights over the company's records, not an ordinary company capability a
  // colleague can be granted.
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) {
    return c.json({ error: 'No products found' }, 400);
  }

  const format = c.req.query('format') === 'csv' ? 'csv' : 'json';
  const today = new Date().toISOString().slice(0, 10);

  const allProductData: Array<{
    product_id: string;
    product_name: string;
    data: Awaited<ReturnType<typeof exportProductData>>;
  }> = [];

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    const productId = p.id as string;
    const productName = p.name as string;
    const data = await exportProductData(productId, format);
    allProductData.push({ product_id: productId, product_name: productName, data });
  }

  if (format === 'csv') {
    const csvParts: string[] = [];
    for (const product of allProductData) {
      csvParts.push(`## Product: ${product.product_name} (${product.product_id})`);
      const sections = Object.entries(product.data) as Array<[string, unknown[]]>;
      for (const [name, rows] of sections) {
        if (Array.isArray(rows) && rows.length > 0) {
          csvParts.push(`# ${name}\n${jsonToCsv(rows)}`);
        }
      }
      csvParts.push('');
    }
    return csvResponse(csvParts.join('\n\n'), `foundry-fleet-export-${today}.csv`);
  }

  const payload = {
    exported_at: new Date().toISOString(),
    founder_id: founder.id,
    product_count: allProductData.length,
    products: allProductData.map((p) => ({
      product_id: p.product_id,
      product_name: p.product_name,
      ...p.data,
    })),
  };

  const filename = `foundry-fleet-export-${today}.json`;
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

// ─── POST /privacy/delete ──────────────────────────────────────────────────────

privacySettings.post('/privacy/delete', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Privacy & Data', undefined, c);

  if (!ctx.productId) return c.redirect('/privacy');

  await scheduleDataDeletion(ctx.productId, 30);

  return c.redirect('/privacy?success=deletion_scheduled');
});

// ─── GET /settings/delete-all-products — Fleet-wide deletion confirmation (F-063-A) ──

privacySettings.get('/settings/delete-all-products', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Delete All Products', undefined, c);
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) {
    return c.redirect('/privacy');
  }

  const productList = products.rows.map((row) => {
    const p = row as Record<string, unknown>;
    return { id: p.id as string, name: p.name as string };
  });

  const content = html`
    <div style="max-width:600px;margin:0 auto;">
      <h1 style="color:#ff6b6b;margin:0 0 0.5rem;">Delete All Products</h1>
      <p style="color:var(--text-dim);margin:0 0 1.5rem;font-size:0.875rem;line-height:1.55;">
        This will schedule deletion for <strong>all ${productList.length} product${productList.length > 1 ? 's' : ''}</strong>
        and their associated data. Deletion occurs after a 30-day grace period. This action cannot be undone.
      </p>

      <div class="card" style="margin-bottom:1.5rem;padding:0;overflow:hidden;">
        <div style="padding:0.75rem 1rem;background:rgba(255,107,107,0.08);border-bottom:1px solid rgba(255,107,107,0.15);">
          <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;letter-spacing:0.1em;color:#ff6b6b;">Products to be deleted</div>
        </div>
        ${productList.map((p) => html`
          <div style="padding:0.75rem 1rem;border-bottom:1px solid rgba(255,255,255,0.05);display:flex;align-items:center;gap:0.75rem;">
            <span style="width:8px;height:8px;border-radius:50%;background:#ff6b6b;flex-shrink:0;"></span>
            <span style="font-size:0.875rem;color:var(--text-primary);">${p.name}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);font-family:monospace;">${p.id}</span>
          </div>
        `)}
      </div>

      <p style="font-size:0.8rem;color:var(--text-muted);margin-bottom:1.5rem;">
        We recommend <a href="/settings/export-all" style="color:var(--accent);">exporting all data</a> before proceeding.
      </p>

      <div style="display:flex;gap:0.75rem;">
        <a href="/privacy" class="btn btn-ghost">Cancel</a>
        <form method="POST" action="/settings/delete-all-products">
          <button type="submit" class="btn" style="color:#ff6b6b;border-color:#ff6b6b44;background:rgba(255,107,107,0.1);">
            Yes, Delete All ${productList.length} Product${productList.length > 1 ? 's' : ''}
          </button>
        </form>
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /settings/delete-all-products — Execute fleet-wide deletion (F-063-A) ──

privacySettings.post('/settings/delete-all-products', async (c) => {
  const founder = c.get('founder');
  const products = await getProductsByOwner(founder.id);

  if (products.rows.length === 0) {
    return c.redirect('/privacy');
  }

  for (const row of products.rows) {
    const p = row as Record<string, unknown>;
    await scheduleDataDeletion(p.id as string, 30);
  }

  return c.redirect('/privacy?success=all_deletion_scheduled');
});
