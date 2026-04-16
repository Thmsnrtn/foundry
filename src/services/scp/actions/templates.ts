// =============================================================================
// FOUNDRY — Action Templates
// Pre-built blueprints agents can reference when proposing outbound actions.
// =============================================================================

import { nanoid } from 'nanoid';
import { query } from '../../../db/client.js';
import type { ActionType, ActionPayload } from './executor.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActionTemplate {
  id: string;
  product_id: string;
  name: string;
  action_type: ActionType;
  integration: string;
  template_json: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

// ─── Default Template Definitions ────────────────────────────────────────────

interface TemplateDefinition {
  name: string;
  action_type: ActionType;
  integration: string;
  template_json: Record<string, unknown>;
}

const DEFAULT_TEMPLATES: TemplateDefinition[] = [
  {
    name: 'Customer Save Email',
    action_type: 'send_email',
    integration: 'resend',
    template_json: {
      subject: 'We noticed you might need some help — {{company_name}} here',
      body_template: `Hi {{customer_name}},

I wanted to personally reach out because I noticed you haven't been using {{product_name}} as much lately.

{{custom_message}}

Is there anything I can help you with? I'd love to hop on a quick call to make sure you're getting the most out of {{product_name}}.

Best,
{{founder_name}}
{{company_name}}`,
    },
  },
  {
    name: 'Bug Ticket',
    action_type: 'create_ticket',
    integration: 'linear',
    template_json: {
      title_template: '[BUG] {{issue_title}}',
      description_template: `## Bug Report

**Reported by:** {{reporter}}
**Severity:** {{severity}}

### Description
{{description}}

### Steps to Reproduce
{{steps}}

### Expected Behavior
{{expected}}

### Actual Behavior
{{actual}}

---
*Auto-created by Foundry agent {{agent_name}}*`,
      priority: 1,
      fields: ['issue_title', 'reporter', 'severity', 'description', 'steps', 'expected', 'actual', 'agent_name'],
    },
  },
  {
    name: 'Daily Alert',
    action_type: 'post_slack',
    integration: 'slack',
    template_json: {
      channel: '#alerts',
      text_template: ':rotating_light: *{{alert_type}}* | {{message}}',
      blocks: [
        {
          type: 'section',
          text: {
            type: 'mrkdwn',
            text: ':rotating_light: *{{alert_type}}*\n{{message}}',
          },
        },
        {
          type: 'context',
          elements: [
            {
              type: 'mrkdwn',
              text: 'Foundry Agent: {{agent_name}} | {{timestamp}}',
            },
          ],
        },
      ],
    },
  },
  {
    name: 'Expansion Outreach',
    action_type: 'send_email',
    integration: 'resend',
    template_json: {
      subject: '{{product_name}} — a feature that could help {{company_name}} scale',
      body_template: `Hi {{customer_name}},

I've been looking at how {{company_name}} uses {{product_name}}, and I think you're a great candidate for our {{plan_name}} plan.

Here's why: {{expansion_reason}}

This would give you {{key_benefit}}, which based on your current usage could be worth {{estimated_value}}.

Would you be open to a 15-minute call to explore this?

Best,
{{founder_name}}`,
    },
  },
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Creates the default action templates for a product if none exist yet.
 */
export async function seedDefaultTemplates(productId: string): Promise<void> {
  const existing = await query(
    `SELECT COUNT(*) as cnt FROM action_templates WHERE product_id=?`,
    [productId]
  );
  const count = (existing.rows[0] as Record<string, unknown>)?.cnt as number ?? 0;
  if (count > 0) return;

  for (const def of DEFAULT_TEMPLATES) {
    await query(
      `INSERT INTO action_templates (id, product_id, name, action_type, integration, template_json, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, datetime('now'))`,
      [
        nanoid(),
        productId,
        def.name,
        def.action_type,
        def.integration,
        JSON.stringify(def.template_json),
      ]
    );
  }
}

/**
 * Return all active templates for a given action type.
 */
export async function getTemplatesForActionType(
  productId: string,
  actionType: ActionType
): Promise<ActionTemplate[]> {
  const result = await query(
    `SELECT * FROM action_templates WHERE product_id=? AND action_type=? AND is_active=1 ORDER BY name ASC`,
    [productId, actionType]
  );
  return (result.rows as Array<Record<string, unknown>>).map(rowToTemplate);
}

/**
 * Return all templates for a product (for the management UI).
 */
export async function getAllTemplates(productId: string): Promise<ActionTemplate[]> {
  const result = await query(
    `SELECT * FROM action_templates WHERE product_id=? ORDER BY action_type, name ASC`,
    [productId]
  );
  return (result.rows as Array<Record<string, unknown>>).map(rowToTemplate);
}

/**
 * Insert a new template and return its ID.
 */
export async function createTemplate(
  productId: string,
  template: Omit<ActionTemplate, 'id' | 'created_at'>
): Promise<string> {
  const id = nanoid();
  await query(
    `INSERT INTO action_templates (id, product_id, name, action_type, integration, template_json, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    [
      id,
      productId,
      template.name,
      template.action_type,
      template.integration,
      JSON.stringify(template.template_json),
      template.is_active ? 1 : 0,
    ]
  );
  return id;
}

/**
 * Render a template by substituting {{variable_name}} placeholders with values.
 * Returns an ActionPayload ready for createExecution().
 */
export async function renderTemplate(
  template: ActionTemplate,
  variables: Record<string, string>
): Promise<ActionPayload> {
  // Serialize the template_json to string, replace all placeholders, then parse back
  let rendered = JSON.stringify(template.template_json);

  for (const [key, value] of Object.entries(variables)) {
    // Replace all occurrences of {{key}} with the value (JSON-safe)
    const placeholder = `{{${key}}}`;
    rendered = rendered.split(placeholder).join(value.replace(/\\/g, '\\\\').replace(/"/g, '\\"'));
  }

  let templateData: Record<string, unknown>;
  try {
    templateData = JSON.parse(rendered) as Record<string, unknown>;
  } catch {
    templateData = template.template_json;
  }

  const payload: ActionPayload = {
    action_type: template.action_type,
    integration: template.integration,
  };

  // Map template fields to payload fields based on action_type
  switch (template.action_type) {
    case 'send_email':
      payload.subject = templateData.subject as string | undefined;
      payload.body = (templateData.body_template ?? templateData.body) as string | undefined;
      if (variables.to_email) payload.to_email = variables.to_email;
      break;

    case 'create_ticket':
      payload.ticket_title = (templateData.title_template ?? templateData.ticket_title) as string | undefined;
      payload.ticket_description = (templateData.description_template ?? templateData.ticket_description) as string | undefined;
      if (templateData.priority !== undefined) payload.priority = templateData.priority as number;
      if (variables.team_id) payload.team_id = variables.team_id;
      break;

    case 'post_slack':
      payload.channel = (templateData.channel ?? variables.channel) as string | undefined;
      payload.text = (templateData.text_template ?? templateData.text) as string | undefined;
      if (templateData.blocks) payload.blocks = templateData.blocks as unknown[];
      break;

    case 'custom_webhook':
      payload.webhook_url = templateData.webhook_url as string | undefined;
      payload.webhook_payload = templateData.webhook_payload as Record<string, unknown> | undefined;
      break;

    default:
      break;
  }

  return payload;
}

// ─── Internal helpers ─────────────────────────────────────────────────────────

function rowToTemplate(row: Record<string, unknown>): ActionTemplate {
  return {
    id: row.id as string,
    product_id: row.product_id as string,
    name: row.name as string,
    action_type: row.action_type as ActionType,
    integration: row.integration as string,
    template_json: (() => {
      try { return JSON.parse(row.template_json as string || '{}') as Record<string, unknown>; } catch { return {}; }
    })(),
    is_active: (row.is_active as number) === 1,
    created_at: row.created_at as string,
  };
}
