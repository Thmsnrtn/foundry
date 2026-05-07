// =============================================================================
// FOUNDRY — SCP Provisioner
// Creates the 12 agent instances and constitution for a new company.
// =============================================================================

import { nanoid } from 'nanoid';
import { query, batch } from '../../db/client.js';
import { isBlocked } from '../discipline/freeze-periods.js';
import { queueProposal } from '../discipline/proposals-queue.js';
import type {
  AgentName,
  ProvisionResult,
} from './types.js';
import {
  ALL_AGENTS,
  AGENT_DISPLAY_NAMES,
  DEFAULT_AUTHORITY_LEVELS,
  DEFAULT_CADENCE_HOURS,
  DEFAULT_CONSTITUTION,
} from './types.js';

// ─── isProvisioned ────────────────────────────────────────────────────────────

export async function isProvisioned(productId: string): Promise<boolean> {
  const result = await query(
    'SELECT COUNT(*) as count FROM agent_instances WHERE product_id=?',
    [productId]
  );
  const count = ((result.rows[0] as Record<string, unknown>)?.count as number) ?? 0;
  return count >= ALL_AGENTS.length;
}

// ─── provisionSCP ─────────────────────────────────────────────────────────────

export async function provisionSCP(productId: string, ownerId: string): Promise<ProvisionResult> {
  // 1. Check if already provisioned
  const alreadyDone = await isProvisioned(productId);
  if (alreadyDone) {
    return {
      success: true,
      productId,
      agentsCreated: 0,
      constitutionCreated: false,
      error: 'Already provisioned',
    };
  }

  // V3.1 Layer A: architecture freeze gate — refuse new agent provisioning
  // when freeze is active. Queue the request for review at end of freeze.
  const freezeCheck = await isBlocked(productId, 'agent_provision');
  if (freezeCheck.blocked) {
    await queueProposal(productId, {
      source_type: 'agent_provision',
      source_id: productId,
      proposed_change: `Provision SCP for product ${productId}`,
      proposed_by: 'system',
      rationale: 'Initial SCP provisioning request',
      blocked_during_freeze_id: freezeCheck.freeze?.id ?? null,
    });
    return {
      success: false,
      productId,
      agentsCreated: 0,
      constitutionCreated: false,
      error: `architecture_freeze active (${freezeCheck.freeze?.reason ?? 'no reason'}); provisioning queued`,
    };
  }

  // Verify product belongs to owner
  const productResult = await query(
    'SELECT id, name, company_lifecycle_state FROM products WHERE id=? AND owner_id=?',
    [productId, ownerId]
  );
  if (productResult.rows.length === 0) {
    return {
      success: false,
      productId,
      agentsCreated: 0,
      constitutionCreated: false,
      error: 'Product not found or access denied',
    };
  }

  const prod = productResult.rows[0] as Record<string, unknown>;

  try {
    // Build all statements up-front, then execute as a single atomic batch transaction.
    // This ensures all-or-nothing: if any INSERT fails, the entire provision is rolled back.
    const statements: Array<{ sql: string; args: unknown[] }> = [];

    // 2. Insert scp_constitutions row
    const constitutionId = nanoid();
    statements.push({
      sql: `INSERT INTO scp_constitutions
         (id, product_id, version, core_values, operating_principles, authority_framework, evolution_policy)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(product_id) DO NOTHING`,
      args: [
        constitutionId,
        productId,
        DEFAULT_CONSTITUTION.version,
        JSON.stringify(DEFAULT_CONSTITUTION.core_values),
        JSON.stringify(DEFAULT_CONSTITUTION.operating_principles),
        JSON.stringify(DEFAULT_CONSTITUTION.authority_framework),
        JSON.stringify(DEFAULT_CONSTITUTION.evolution_policy),
      ],
    });

    // 3. Create agent instances (staggered: each index × 30min offset)
    let agentsCreated = 0;

    for (let i = 0; i < ALL_AGENTS.length; i++) {
      const agentName: AgentName = ALL_AGENTS[i];
      const cadenceHours = DEFAULT_CADENCE_HOURS[agentName];
      const staggerOffsetMs = i * 30 * 60 * 1000; // 30 min per agent index
      const nextRunAt = new Date(Date.now() + cadenceHours * 3600 * 1000 + staggerOffsetMs).toISOString();
      const instanceId = nanoid();

      statements.push({
        sql: `INSERT INTO agent_instances
           (id, product_id, agent_name, display_name, version, authority_level,
            activation_cadence_hours, status, total_sessions, successful_sessions,
            total_decisions_proposed, total_decisions_approved, total_evolution_cycles,
            domain_health_score, next_run_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'active', 0, 0, 0, 0, 0, 50, ?)
         ON CONFLICT(product_id, agent_name) DO NOTHING`,
        args: [
          instanceId,
          productId,
          agentName,
          AGENT_DISPLAY_NAMES[agentName],
          DEFAULT_AUTHORITY_LEVELS[agentName],
          cadenceHours,
          nextRunAt,
        ],
      });

      // Create initial evolution version row
      statements.push({
        sql: `INSERT INTO agent_evolution_versions
           (id, product_id, agent_name, version, change_type, change_description,
            trigger_session_id, previous_config, new_config, validation_score, validation_notes, promoted_at)
         VALUES (?, ?, ?, 1, 'initial_provision', ?, NULL, NULL, ?, NULL, 'Initial provisioning', CURRENT_TIMESTAMP)`,
        args: [
          nanoid(),
          productId,
          agentName,
          `Initial provision of ${AGENT_DISPLAY_NAMES[agentName]}`,
          JSON.stringify({
            agent_name: agentName,
            display_name: AGENT_DISPLAY_NAMES[agentName],
            authority_level: DEFAULT_AUTHORITY_LEVELS[agentName],
            activation_cadence_hours: cadenceHours,
            behavioral_constraints: [],
            version: 1,
          }),
        ],
      });

      agentsCreated++;
    }

    // 4. Determine lifecycle state
    // If the product already has DNA completed, move to 'learning'; otherwise keep 'setup'
    const currentState = (prod.company_lifecycle_state as string) ?? 'setup';
    const newLifecycleState = currentState === 'setup' ? 'learning' : currentState;

    statements.push({
      sql: `UPDATE products SET
         scp_status='active',
         company_lifecycle_state=?,
         scp_constitution_version=1,
         updated_at=CURRENT_TIMESTAMP
       WHERE id=?`,
      args: [newLifecycleState, productId],
    });

    // Execute all statements as a single atomic transaction
    await batch(statements);

    return {
      success: true,
      productId,
      agentsCreated,
      constitutionCreated: true,
    };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[provisioner] provisionSCP(${productId}) failed: ${error}`);
    return {
      success: false,
      productId,
      agentsCreated: 0,
      constitutionCreated: false,
      error,
    };
  }
}

// ─── ensureProvisioned ────────────────────────────────────────────────────────

export async function ensureProvisioned(productId: string, ownerId: string): Promise<void> {
  const done = await isProvisioned(productId);
  if (!done) {
    const result = await provisionSCP(productId, ownerId);
    if (!result.success) {
      throw new Error(`SCP provisioning failed for ${productId}: ${result.error}`);
    }
  }
}

// ─── deprovisionSCP ───────────────────────────────────────────────────────────

export async function deprovisionSCP(productId: string): Promise<void> {
  await query(
    `UPDATE products SET scp_status='archived', updated_at=CURRENT_TIMESTAMP WHERE id=?`,
    [productId]
  );
  await query(
    `UPDATE agent_instances SET status='paused', updated_at=CURRENT_TIMESTAMP WHERE product_id=?`,
    [productId]
  );
}
