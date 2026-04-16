// =============================================================================
// FOUNDRY — Audit Log Service
// Append-only event log for all significant system events.
// Based on migration 025 (agent_audit_log table).
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../db/client.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AuditEvent {
  product_id: string;
  actor_type: 'agent' | 'user' | 'system' | 'api';
  actor_id: string; // agent name, user id, 'system', or api_key_id
  action: string; // e.g. 'agent.run', 'decision.approve', 'integration.sync', 'user.login'
  resource_type?: string;
  resource_id?: string;
  details?: Record<string, unknown>;
  ip_address?: string;
}

// ─── logAudit ─────────────────────────────────────────────────────────────────

export async function logAudit(event: AuditEvent): Promise<void> {
  await query(
    `INSERT INTO agent_audit_log
       (id, product_id, event_type, actor_type, actor_id, target_type, target_id,
        description, metadata_json, ip_address)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      event.product_id,
      event.action,
      // The DB column is actor_type with values 'agent'|'founder'|'system'|'api'
      // We map 'user' -> 'founder' to match the DB CHECK constraint
      event.actor_type === 'user' ? 'founder' : event.actor_type,
      event.actor_id,
      event.resource_type ?? null,
      event.resource_id ?? null,
      event.action, // description mirrors action for simple events
      JSON.stringify(event.details ?? {}),
      event.ip_address ?? null,
    ]
  );
}

// ─── getAuditLog ──────────────────────────────────────────────────────────────

export async function getAuditLog(
  productId: string,
  opts?: {
    limit?: number;
    offset?: number;
    actor_type?: string;
    action?: string;
    since?: string; // ISO date
  }
): Promise<{ events: AuditEvent[]; total: number }> {
  const limit = opts?.limit ?? 50;
  const offset = opts?.offset ?? 0;

  const conditions: string[] = ['product_id = ?'];
  const args: unknown[] = [productId];

  if (opts?.actor_type) {
    const mapped = opts.actor_type === 'user' ? 'founder' : opts.actor_type;
    conditions.push('actor_type = ?');
    args.push(mapped);
  }

  if (opts?.action) {
    conditions.push('event_type = ?');
    args.push(opts.action);
  }

  if (opts?.since) {
    conditions.push('created_at >= ?');
    args.push(opts.since);
  }

  const where = conditions.join(' AND ');

  const countResult = await query(
    `SELECT COUNT(*) as total FROM agent_audit_log WHERE ${where}`,
    args
  );
  const total = ((countResult.rows[0] as Record<string, unknown>)?.total as number) ?? 0;

  const dataResult = await query(
    `SELECT * FROM agent_audit_log WHERE ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`,
    [...args, limit, offset]
  );

  const events: AuditEvent[] = dataResult.rows.map((row) => {
    const r = row as Record<string, unknown>;
    let details: Record<string, unknown> = {};
    try {
      details = JSON.parse((r.metadata_json as string) ?? '{}') as Record<string, unknown>;
    } catch {
      details = {};
    }
    const actor_type_raw = r.actor_type as string;
    return {
      product_id: r.product_id as string,
      actor_type: (actor_type_raw === 'founder' ? 'user' : actor_type_raw) as AuditEvent['actor_type'],
      actor_id: (r.actor_id as string) ?? '',
      action: r.event_type as string,
      resource_type: (r.target_type as string | null) ?? undefined,
      resource_id: (r.target_id as string | null) ?? undefined,
      details,
      ip_address: (r.ip_address as string | null) ?? undefined,
    };
  });

  return { events, total };
}
