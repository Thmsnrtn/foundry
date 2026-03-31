// =============================================================================
// FOUNDRY — SCP Evolution Engine v2: Typed Agent Config System
// Manages per-agent typed configuration sections with history.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ConfigType =
  | 'persona'
  | 'domain_knowledge'
  | 'task_patterns'
  | 'tool_preferences'
  | 'error_recovery'
  | 'shared_knowledge';

export const CONFIG_TYPES: ConfigType[] = [
  'persona',
  'domain_knowledge',
  'task_patterns',
  'tool_preferences',
  'error_recovery',
  'shared_knowledge',
];

export interface ConfigHistoryEntry {
  id: string;
  product_id: string;
  agent_name: string;
  config_type: string;
  version: number;
  content: string;
  changed_at: string;
  changed_by: string;
  rationale: string | null;
  session_id: string | null;
  gate_scores: Record<string, number> | null;
}

// ─── 12 SCP Agents ───────────────────────────────────────────────────────────

const AGENT_NAMES = [
  'Atlas',       // CTO — code quality, architecture, security, dependencies, deployments
  'Meridian',    // CPO — product strategy, roadmap, feature prioritization
  'Beacon',      // CMO — marketing strategy, positioning, content
  'Forge',       // COO — operations, processes, efficiency
  'Nexus',       // CFO — financial modeling, pricing, revenue optimization
  'Catalyst',    // CRO — sales, conversion, revenue growth
  'Compass',     // CHRO — culture, hiring, team dynamics
  'Oracle',      // Chief Data Officer — analytics, metrics, insights
  'Sentinel',    // Chief Security Officer — security, compliance, risk
  'Vanguard',    // Chief Strategy Officer — competitive analysis, market positioning
  'Echo',        // Chief Customer Officer — support, success, retention
  'Prism',       // Chief Design Officer — UX, design, accessibility
];

// ─── Starter content generators ───────────────────────────────────────────────

function getStarterContent(agentName: string, configType: ConfigType): string {
  const role = getAgentRole(agentName);

  switch (configType) {
    case 'persona':
      return `${agentName} is the ${role} of this company. ${agentName} is analytical, direct, and focused on high-impact decisions. ${agentName} provides actionable recommendations backed by data and clear reasoning.`;

    case 'domain_knowledge':
      return getDomainKnowledge(agentName, role);

    case 'task_patterns':
      return `${agentName} prioritizes tasks by business impact. ${agentName} breaks complex problems into actionable steps. ${agentName} escalates decisions with high uncertainty to human review.`;

    case 'tool_preferences':
      return `${agentName} prefers structured data formats for analysis. ${agentName} uses concise summaries for communication. ${agentName} documents reasoning for all significant decisions.`;

    case 'error_recovery':
      return `When ${agentName} encounters ambiguous data, it requests clarification before proceeding. When ${agentName} hits a failure, it logs the error, applies the most conservative fallback, and flags for human review.`;

    case 'shared_knowledge':
      return `${agentName} shares relevant findings with other agents through structured summaries. ${agentName} avoids duplicating analysis already performed by peer agents.`;

    default:
      return '';
  }
}

function getAgentRole(agentName: string): string {
  const roles: Record<string, string> = {
    Atlas: 'CTO',
    Meridian: 'CPO',
    Beacon: 'CMO',
    Forge: 'COO',
    Nexus: 'CFO',
    Catalyst: 'CRO',
    Compass: 'CHRO',
    Oracle: 'Chief Data Officer',
    Sentinel: 'Chief Security Officer',
    Vanguard: 'Chief Strategy Officer',
    Echo: 'Chief Customer Officer',
    Prism: 'Chief Design Officer',
  };
  return roles[agentName] ?? 'Senior Advisor';
}

function getDomainKnowledge(agentName: string, role: string): string {
  const domains: Record<string, string> = {
    Atlas: `${agentName} is the ${role} of this company. Domain: code quality, architecture, security, dependencies, deployments. ${agentName} evaluates technical debt, infrastructure costs, and engineering velocity.`,
    Meridian: `${agentName} is the ${role} of this company. Domain: product strategy, roadmap prioritization, feature development, user research, product-market fit. ${agentName} balances user needs with business goals.`,
    Beacon: `${agentName} is the ${role} of this company. Domain: marketing strategy, brand positioning, content marketing, SEO, paid acquisition, messaging. ${agentName} focuses on sustainable growth channels.`,
    Forge: `${agentName} is the ${role} of this company. Domain: operations efficiency, process design, vendor management, tooling, team coordination. ${agentName} eliminates waste and scales operations.`,
    Nexus: `${agentName} is the ${role} of this company. Domain: financial modeling, unit economics, pricing strategy, revenue forecasting, cash flow, fundraising. ${agentName} optimizes for long-term financial health.`,
    Catalyst: `${agentName} is the ${role} of this company. Domain: sales strategy, pipeline management, conversion optimization, partnerships, revenue expansion. ${agentName} accelerates revenue growth.`,
    Compass: `${agentName} is the ${role} of this company. Domain: hiring strategy, culture development, performance management, compensation, team dynamics. ${agentName} builds high-performing teams.`,
    Oracle: `${agentName} is the ${role} of this company. Domain: data analytics, KPI tracking, cohort analysis, experimentation, business intelligence. ${agentName} surfaces actionable insights from data.`,
    Sentinel: `${agentName} is the ${role} of this company. Domain: security posture, compliance frameworks, risk assessment, incident response, data privacy. ${agentName} protects the business from threats.`,
    Vanguard: `${agentName} is the ${role} of this company. Domain: competitive analysis, market positioning, strategic planning, opportunity identification. ${agentName} shapes long-term direction.`,
    Echo: `${agentName} is the ${role} of this company. Domain: customer support, success programs, churn prevention, NPS, onboarding, retention. ${agentName} maximizes customer lifetime value.`,
    Prism: `${agentName} is the ${role} of this company. Domain: UX design, design systems, accessibility, user research, conversion design, brand identity. ${agentName} creates intuitive, delightful experiences.`,
  };
  return domains[agentName] ?? `${agentName} is the ${role} of this company. Domain: general business operations and strategic decision-making.`;
}

// ─── Core Functions ───────────────────────────────────────────────────────────

/**
 * Get all config sections for an agent (returns {} if not yet seeded)
 */
export async function getAgentConfig(
  productId: string,
  agentName: string
): Promise<Record<string, string>> {
  const result = await query(
    'SELECT config_type, content FROM agent_configs WHERE product_id = ? AND agent_name = ?',
    [productId, agentName]
  );

  const config: Record<string, string> = {};
  for (const row of result.rows) {
    const r = row as Record<string, unknown>;
    config[r.config_type as string] = r.content as string;
  }
  return config;
}

/**
 * Get a specific config section
 */
export async function getConfigSection(
  productId: string,
  agentName: string,
  configType: string
): Promise<string> {
  const result = await query(
    'SELECT content FROM agent_configs WHERE product_id = ? AND agent_name = ? AND config_type = ?',
    [productId, agentName, configType]
  );

  if (result.rows.length === 0) return '';
  const row = result.rows[0] as Record<string, unknown>;
  return (row.content as string) ?? '';
}

/**
 * Apply a validated config change (writes to agent_configs + agent_config_history)
 */
export async function applyConfigChange(params: {
  productId: string;
  agentName: string;
  configType: string;
  newContent: string;
  rationale: string;
  sessionId?: string;
  gateScores?: Record<string, number>;
  changedBy?: string;
}): Promise<void> {
  const {
    productId,
    agentName,
    configType,
    newContent,
    rationale,
    sessionId,
    gateScores,
    changedBy = 'evolution_engine',
  } = params;

  const lineCount = newContent.split('\n').filter(l => l.trim().length > 0).length;
  const wordCount = newContent.split(/\s+/).filter(w => w.length > 0).length;
  const now = new Date().toISOString();

  // Get current version
  const existing = await query(
    'SELECT id, version FROM agent_configs WHERE product_id = ? AND agent_name = ? AND config_type = ?',
    [productId, agentName, configType]
  );

  let newVersion: number;
  let parentVersion: number | null = null;

  if (existing.rows.length === 0) {
    newVersion = 1;
    // Insert new config
    await query(
      `INSERT INTO agent_configs (id, product_id, agent_name, config_type, content, version, parent_version, line_count, word_count, updated_at, updated_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [nanoid(), productId, agentName, configType, newContent, 1, null, lineCount, wordCount, now, changedBy]
    );
  } else {
    const row = existing.rows[0] as Record<string, unknown>;
    parentVersion = (row.version as number) ?? 1;
    newVersion = parentVersion + 1;

    // Update existing config
    await query(
      `UPDATE agent_configs
       SET content = ?, version = ?, parent_version = ?, line_count = ?, word_count = ?, updated_at = ?, updated_by = ?
       WHERE product_id = ? AND agent_name = ? AND config_type = ?`,
      [newContent, newVersion, parentVersion, lineCount, wordCount, now, changedBy, productId, agentName, configType]
    );
  }

  // Write to history (immutable)
  await query(
    `INSERT INTO agent_config_history (id, product_id, agent_name, config_type, version, content, changed_at, changed_by, rationale, session_id, gate_scores)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(),
      productId,
      agentName,
      configType,
      newVersion,
      newContent,
      now,
      changedBy,
      rationale,
      sessionId ?? null,
      gateScores ? JSON.stringify(gateScores) : null,
    ]
  );
}

/**
 * Get config history for an agent
 */
export async function getConfigHistory(
  productId: string,
  agentName: string,
  limit: number = 50
): Promise<ConfigHistoryEntry[]> {
  const result = await query(
    `SELECT * FROM agent_config_history
     WHERE product_id = ? AND agent_name = ?
     ORDER BY changed_at DESC LIMIT ?`,
    [productId, agentName, limit]
  );

  return result.rows.map(row => {
    const r = row as Record<string, unknown>;
    return {
      id: r.id as string,
      product_id: r.product_id as string,
      agent_name: r.agent_name as string,
      config_type: r.config_type as string,
      version: r.version as number,
      content: r.content as string,
      changed_at: r.changed_at as string,
      changed_by: r.changed_by as string,
      rationale: r.rationale as string | null,
      session_id: r.session_id as string | null,
      gate_scores: r.gate_scores ? JSON.parse(r.gate_scores as string) as Record<string, number> : null,
    };
  });
}

/**
 * Seed initial config stubs for all 12 agents for a product
 */
export async function seedAgentConfigs(productId: string): Promise<void> {
  const now = new Date().toISOString();

  for (const agentName of AGENT_NAMES) {
    for (const configType of CONFIG_TYPES) {
      // Check if already exists
      const existing = await query(
        'SELECT id FROM agent_configs WHERE product_id = ? AND agent_name = ? AND config_type = ?',
        [productId, agentName, configType]
      );

      if (existing.rows.length > 0) continue;

      const content = getStarterContent(agentName, configType);
      const lineCount = content.split('\n').filter(l => l.trim().length > 0).length;
      const wordCount = content.split(/\s+/).filter(w => w.length > 0).length;
      const configId = nanoid();

      // Insert initial config
      await query(
        `INSERT INTO agent_configs (id, product_id, agent_name, config_type, content, version, parent_version, line_count, word_count, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, 1, NULL, ?, ?, ?, 'system')`,
        [configId, productId, agentName, configType, content, lineCount, wordCount, now]
      );

      // Write to history as version 1
      await query(
        `INSERT INTO agent_config_history (id, product_id, agent_name, config_type, version, content, changed_at, changed_by, rationale, session_id, gate_scores)
         VALUES (?, ?, ?, ?, 1, ?, ?, 'system', 'Initial seed', NULL, NULL)`,
        [nanoid(), productId, agentName, configType, content, now]
      );
    }
  }
}

/**
 * Get the original (version 1) content for a config type (for drift detection)
 */
export async function getOriginalConfig(
  productId: string,
  agentName: string,
  configType: string
): Promise<string | null> {
  const result = await query(
    `SELECT content FROM agent_config_history
     WHERE product_id = ? AND agent_name = ? AND config_type = ? AND version = 1
     ORDER BY changed_at ASC LIMIT 1`,
    [productId, agentName, configType]
  );

  if (result.rows.length === 0) return null;
  const row = result.rows[0] as Record<string, unknown>;
  return row.content as string;
}

/**
 * Rollback a config to a previous version
 */
export async function rollbackConfig(
  productId: string,
  agentName: string,
  configType: string,
  toVersion: number
): Promise<void> {
  // Find the target version in history
  const historyResult = await query(
    `SELECT content FROM agent_config_history
     WHERE product_id = ? AND agent_name = ? AND config_type = ? AND version = ?
     LIMIT 1`,
    [productId, agentName, configType, toVersion]
  );

  if (historyResult.rows.length === 0) {
    throw new Error(`Version ${toVersion} not found for ${agentName}/${configType}`);
  }

  const row = historyResult.rows[0] as Record<string, unknown>;
  const targetContent = row.content as string;

  // Apply rollback as a new config change
  await applyConfigChange({
    productId,
    agentName,
    configType,
    newContent: targetContent,
    rationale: `Rollback to version ${toVersion}`,
    changedBy: 'rollback_system',
  });
}
