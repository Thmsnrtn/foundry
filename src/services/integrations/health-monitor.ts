// =============================================================================
// FOUNDRY — Integration Health Monitor
// Tracks per-integration health: failure counts, data freshness, status.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── recordIntegrationEvent ───────────────────────────────────────────────────

export async function recordIntegrationEvent(
  productId: string,
  source: string,
  success: boolean,
  errorMessage?: string,
): Promise<void> {
  const now = new Date().toISOString();
  const id = nanoid();

  // Try to load existing row
  const existing = await query(
    `SELECT id, consecutive_failures FROM integration_health
     WHERE product_id = ? AND integration_source = ?`,
    [productId, source],
  );

  if (existing.rows.length === 0) {
    // Insert new row
    const failures = success ? 0 : 1;
    const status = _computeStatus(failures, now, success ? now : null);
    await query(
      `INSERT INTO integration_health
         (id, product_id, integration_source, last_event_at, last_successful_sync,
          consecutive_failures, error_message, status, data_freshness_hours, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0.0, ?)`,
      [
        id,
        productId,
        source,
        now,
        success ? now : null,
        failures,
        success ? null : (errorMessage ?? null),
        status,
        now,
      ],
    );
  } else {
    const row = existing.rows[0] as Record<string, unknown>;
    const prevFailures = (row.consecutive_failures as number) ?? 0;
    const failures = success ? 0 : prevFailures + 1;

    const status = _computeStatus(failures, now, success ? now : null);

    await query(
      `UPDATE integration_health
       SET last_event_at = ?,
           last_successful_sync = CASE WHEN ? = 1 THEN ? ELSE last_successful_sync END,
           consecutive_failures = ?,
           error_message = ?,
           status = ?,
           data_freshness_hours = 0.0,
           updated_at = ?
       WHERE product_id = ? AND integration_source = ?`,
      [
        now,
        success ? 1 : 0,
        now,
        failures,
        success ? null : (errorMessage ?? null),
        status,
        now,
        productId,
        source,
      ],
    );
  }
}

// ─── computeIntegrationStatuses ───────────────────────────────────────────────

export async function computeIntegrationStatuses(productId: string): Promise<void> {
  const result = await query(
    `SELECT id, integration_source, last_event_at, consecutive_failures
     FROM integration_health
     WHERE product_id = ?`,
    [productId],
  );

  const now = Date.now();

  for (const r of result.rows) {
    const row = r as Record<string, unknown>;
    const lastEventAt = row.last_event_at as string | null;
    const failures = (row.consecutive_failures as number) ?? 0;

    const freshness = lastEventAt
      ? (now - new Date(lastEventAt).getTime()) / 3600000
      : null;

    let status: string;
    if (failures > 3) {
      status = 'error';
    } else if (failures >= 1 && failures <= 3) {
      status = 'degraded';
    } else if (freshness !== null && freshness > 24) {
      status = 'stale';
    } else if (freshness !== null && freshness <= 24 && failures === 0) {
      status = 'healthy';
    } else {
      status = 'unknown';
    }

    await query(
      `UPDATE integration_health
       SET status = ?,
           data_freshness_hours = ?,
           updated_at = datetime('now')
       WHERE id = ?`,
      [status, freshness, row.id as string],
    );
  }
}

// ─── getIntegrationHealth ─────────────────────────────────────────────────────

export async function getIntegrationHealth(productId: string): Promise<
  Array<{
    source: string;
    status: 'healthy' | 'degraded' | 'stale' | 'error' | 'unknown';
    last_event_at: string | null;
    /** When the connection last WORKED, which is not when data last arrived.
     *  NULL means it has never completed a sync. */
    last_successful_sync: string | null;
    data_freshness_hours: number | null;
    consecutive_failures: number;
    error_message: string | null;
    status_message: string;
  }>
> {
  // `last_successful_sync` IS THE FACT THAT SEPARATES QUIET FROM BROKEN, and it
  // was recorded on every successful event and then never selected. The page
  // showed `last_event_at` — when data last ARRIVED — and built its whole
  // status message from it. For a webhook-driven source, a quiet fortnight and
  // a dead connection produce the identical line: "No data in 14 days".
  //
  // `institution/loop-health.ts` already says this about the scheduler, in
  // these words: "Nothing happened" and "nothing ran" are different facts. One
  // rule, stated in one place and not the other, over a column that had the
  // answer the whole time.
  const result = await query(
    `SELECT integration_source, status, last_event_at, last_successful_sync,
            data_freshness_hours, consecutive_failures, error_message
     FROM integration_health
     WHERE product_id = ?
     ORDER BY integration_source ASC`,
    [productId],
  );

  return result.rows.map((r) => {
    const row = r as Record<string, unknown>;
    const source = row.integration_source as string;
    const status = (row.status as string) as 'healthy' | 'degraded' | 'stale' | 'error' | 'unknown';
    const lastEventAt = (row.last_event_at as string) ?? null;
    const freshness = row.data_freshness_hours !== null
      ? Number(row.data_freshness_hours)
      : null;
    const failures = (row.consecutive_failures as number) ?? 0;
    const errorMessage = (row.error_message as string) ?? null;
    const lastSuccessfulSync = (row.last_successful_sync as string) ?? null;

    return {
      source,
      status,
      last_event_at: lastEventAt,
      /** When the integration last WORKED, as opposed to when data last
       *  arrived. NULL means it has never completed a sync — which is a
       *  configuration problem, not a quiet source. */
      last_successful_sync: lastSuccessfulSync,
      data_freshness_hours: freshness,
      consecutive_failures: failures,
      error_message: errorMessage,
      status_message: _buildStatusMessage(
        status, lastEventAt, lastSuccessfulSync, freshness, failures, errorMessage),
    };
  });
}

// ─── getHealthSummary ─────────────────────────────────────────────────────────

export async function getHealthSummary(productId: string): Promise<{
  healthy: number;
  degraded: number;
  stale: number;
  error: number;
  worst_status: string;
  action_needed: string | null;
}> {
  const integrations = await getIntegrationHealth(productId);

  let healthy = 0;
  let degraded = 0;
  let stale = 0;
  let error = 0;

  let actionNeeded: string | null = null;

  for (const integ of integrations) {
    switch (integ.status) {
      case 'healthy':  healthy++;  break;
      case 'degraded': degraded++; break;
      case 'stale':    stale++;    break;
      case 'error':    error++;    break;
      default: break;
    }

    // Build action_needed from the worst offender
    if (!actionNeeded) {
      if (integ.status === 'error') {
        actionNeeded = `${_cap(integ.source)} integration is failing — ${integ.error_message ?? 'check configuration'}`;
      } else if (integ.status === 'stale' && integ.data_freshness_hours !== null) {
        const days = Math.floor(integ.data_freshness_hours / 24);
        actionNeeded = `${_cap(integ.source)} integration hasn't synced in ${days > 0 ? `${days} day${days > 1 ? 's' : ''}` : 'over 24 hours'} — data may be stale`;
      }
    }
  }

  const worst_status =
    error > 0 ? 'error'
    : stale > 0 || degraded > 0 ? (degraded > 0 ? 'degraded' : 'stale')
    : healthy > 0 ? 'healthy'
    : 'unknown';

  return { healthy, degraded, stale, error, worst_status, action_needed: actionNeeded };
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function _computeStatus(
  failures: number,
  lastEventAt: string | null,
  _lastSuccess: string | null,
): string {
  if (failures > 3) return 'error';
  if (failures >= 1) return 'degraded';
  if (lastEventAt) {
    const hoursAgo = (Date.now() - new Date(lastEventAt).getTime()) / 3600000;
    if (hoursAgo > 24) return 'stale';
    return 'healthy';
  }
  return 'unknown';
}

function _buildStatusMessage(
  status: string,
  lastEventAt: string | null,
  lastSuccessfulSync: string | null,
  freshnessHours: number | null,
  failures: number,
  errorMessage: string | null,
): string {
  if (status === 'error' && lastSuccessfulSync === null && failures > 0) {
    // Failing and never once successful is a different message from failing
    // after having worked: the first is almost always the credentials.
    return `Failing · ${failures} consecutive error${failures > 1 ? 's' : ''} and never a successful sync`
      + `${errorMessage ? ` · ${errorMessage.slice(0, 80)}` : ''}`;
  }

  if (status === 'error') {
    return failures > 0
      ? `Failing · ${failures} consecutive error${failures > 1 ? 's' : ''}${errorMessage ? ` · ${errorMessage.slice(0, 80)}` : ''}`
      : 'Error — check configuration';
  }

  if (status === 'degraded') {
    return `Degraded · ${failures} failure${failures > 1 ? 's' : ''}${lastEventAt ? ` · Last ${_fmtAgo(lastEventAt)}` : ''}`;
  }

  if (status === 'stale') {
    // THE ONE PLACE THE DISTINCTION CHANGES WHAT SOMEBODY DOES. A stale
    // integration that has never once synced is misconfigured and the founder
    // should go and fix it; a stale one that synced this morning is a quiet
    // source and there is nothing to do. Both used to read "No data in 9 days".
    const quiet = lastSuccessfulSync !== null
      ? ` · Connection last worked ${_fmtAgo(lastSuccessfulSync)}`
      : ' · It has never completed a sync — check the connection';
    if (freshnessHours !== null) {
      const days = Math.floor(freshnessHours / 24);
      const hrs = Math.round(freshnessHours % 24);
      const label = days > 0 ? `${days}d ago` : `${hrs}h ago`;
      return `No data in ${days > 0 ? `${days} day${days > 1 ? 's' : ''}` : `${hrs} hours`} · Last ${label}${quiet}`;
    }
    return `No recent data${quiet}`;
  }

  if (status === 'healthy' && lastEventAt) {
    return `Receiving events · Last ${_fmtAgo(lastEventAt)}`;
  }

  return 'No data yet';
}

function _fmtAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function _cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
