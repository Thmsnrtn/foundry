// =============================================================================
// FOUNDRY — Agent Message Bus Dashboard
// Inter-agent communication log, insights feed, unread messages.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import type { HtmlContent } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import {
  getMessageInbox,
  getMessageSummary,
  markAsRead,
  type AgentMessage,
} from '../../services/scp/messages.js';
import { ALL_AGENTS } from '../../services/scp/types.js';

export const agentMessageRoutes = new Hono<AuthEnv>();

// ─── Helpers ──────────────────────────────────────────────────────────────────

function priorityColor(p: string): string {
  if (p === 'critical') return '#ef4444';
  if (p === 'high') return '#f59e0b';
  if (p === 'medium') return '#3b82f6';
  return '#9ca3af';
}

function typeBadge(type: string): string {
  const map: Record<string, string> = {
    insight: '#8b5cf6', request: '#3b82f6', alert: '#ef4444',
    handoff: '#f59e0b', question: '#06b6d4', report: '#22c55e',
  };
  const color = map[type] ?? '#6b7280';
  return `<span style="background:${color}22;color:${color};padding:2px 6px;border-radius:4px;font-size:10px;font-weight:700;text-transform:uppercase">${type}</span>`;
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const h = Math.floor(mins / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function agentInitials(name: string): string {
  return name.slice(0, 2).toUpperCase();
}

const AGENT_COLORS: Record<string, string> = {
  atlas: '#3b82f6', compass: '#8b5cf6', prism: '#ec4899',
  beacon: '#f59e0b', scribe: '#06b6d4', forge: '#22c55e',
  harbor: '#14b8a6', sentinel: '#f97316', ledger: '#84cc16',
  shield: '#6366f1', oracle: '#a855f7', crucible: '#ef4444',
};

function agentAvatar(name: string): string {
  const color = AGENT_COLORS[name] ?? '#6b7280';
  return `<div style="width:32px;height:32px;border-radius:50%;background:${color}22;color:${color};display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;flex-shrink:0">${agentInitials(name)}</div>`;
}

// ─── GET /agents/messages ─────────────────────────────────────────────────────

agentMessageRoutes.get('/agents/messages', async (c) => {
  const founder = c.get('founder');
  const filterAgent = c.req.query('agent') ?? 'all';

  const ctx = await getLayoutContext(founder, 'agents-messages', 'Agent Messages');
  if (!ctx.productId) return c.redirect('/dashboard');
  const productId = ctx.productId;

  // Load messages for the selected agent filter (or 'broadcast' for all)
  const agentToFetch = filterAgent === 'all' ? 'broadcast' : filterAgent;

  const [allMessages, summary] = await Promise.all([
    filterAgent === 'all'
      ? (async () => {
          // Gather from all agents
          const msgs: AgentMessage[] = [];
          for (const agent of ALL_AGENTS) {
            const inbox = await getMessageInbox(productId, agent, 10);
            msgs.push(...inbox);
          }
          // Deduplicate by id and sort by created_at desc
          const seen = new Set<string>();
          const deduped: AgentMessage[] = [];
          for (const m of msgs) {
            if (!seen.has(m.id)) { seen.add(m.id); deduped.push(m); }
          }
          deduped.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
          return deduped.slice(0, 50);
        })()
      : getMessageInbox(productId, agentToFetch, 50),
    getMessageSummary(productId, 48),
  ]);

  // Auto-mark as read (silent, non-blocking)
  const unreadIds = allMessages.filter(m => !m.read_at).map(m => m.id);
  if (unreadIds.length > 0) {
    markAsRead(unreadIds).catch(() => {});
  }

  const criticalMessages = allMessages.filter(m => m.priority === 'critical');
  const highMessages = allMessages.filter(m => m.priority === 'high');

  const body = html`
    <div style="max-width:1000px;margin:0 auto;padding:24px 16px">

      <!-- Header -->
      <div style="margin-bottom:24px">
        <h1 style="font-size:22px;font-weight:700;color:#111;margin:0">Agent Communication</h1>
        <p style="color:#6b7280;margin:4px 0 0;font-size:14px">Inter-agent insights, alerts, and coordination messages</p>
      </div>

      <!-- Stats row -->
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px">
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
          <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Last 48h</div>
          <div style="font-size:24px;font-weight:700;color:#111;margin-top:2px">${summary.total_messages}</div>
        </div>
        <div style="background:#fff;border:1px solid ${summary.critical_count > 0 ? '#fca5a5' : '#e5e7eb'};border-radius:8px;padding:14px">
          <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Critical</div>
          <div style="font-size:24px;font-weight:700;color:${summary.critical_count > 0 ? '#ef4444' : '#111'};margin-top:2px">${summary.critical_count}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
          <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Unanswered</div>
          <div style="font-size:24px;font-weight:700;color:#111;margin-top:2px">${summary.unresponded_count}</div>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;padding:14px">
          <div style="font-size:11px;color:#6b7280;font-weight:600;text-transform:uppercase">Most Active</div>
          <div style="font-size:13px;font-weight:700;color:#111;margin-top:4px">${summary.most_active_agents[0] ?? '—'}</div>
        </div>
      </div>

      <!-- Critical alerts -->
      ${criticalMessages.length > 0 ? html`
      <div style="background:#fef2f2;border:1px solid #fca5a5;border-radius:8px;padding:16px;margin-bottom:16px">
        <div style="font-size:13px;font-weight:700;color:#dc2626;margin-bottom:10px">🚨 Critical Alerts</div>
        ${criticalMessages.map((m: AgentMessage) => html`
        <div style="display:flex;gap:10px;padding:8px 0;border-bottom:1px solid #fecaca;last-child:border-bottom:none">
          ${agentAvatar(m.from_agent)}
          <div>
            <div style="font-size:13px;font-weight:700;color:#111">${m.subject}</div>
            <div style="font-size:12px;color:#6b7280;margin-top:2px">${m.from_agent} → ${m.to_agent} · ${timeAgo(m.created_at)}</div>
            <div style="font-size:12px;color:#374151;margin-top:4px">${m.body.slice(0, 200)}${m.body.length > 200 ? '…' : ''}</div>
          </div>
        </div>`)}
      </div>` : ''}

      <!-- Agent filter tabs -->
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <a href="/agents/messages?agent=all" style="padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;background:${filterAgent === 'all' ? '#111' : '#f3f4f6'};color:${filterAgent === 'all' ? '#fff' : '#374151'}">All</a>
        ${ALL_AGENTS.map(agent => html`
        <a href="/agents/messages?agent=${agent}" style="padding:6px 12px;border-radius:6px;font-size:12px;font-weight:600;text-decoration:none;background:${filterAgent === agent ? '#111' : '#f3f4f6'};color:${filterAgent === agent ? '#fff' : '#374151'}">${agent.charAt(0).toUpperCase() + agent.slice(1)}</a>`)}
      </div>

      <!-- Message list -->
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:8px;overflow:hidden">
        ${allMessages.length === 0 ? html`
          <div style="padding:40px;text-align:center;color:#9ca3af">
            <div style="font-size:32px;margin-bottom:8px">📭</div>
            <div>No messages yet. Agents will communicate here as they collaborate.</div>
          </div>` : html`
          ${allMessages.map((m: AgentMessage, i: number) => html`
          <div style="display:flex;gap:12px;padding:14px 16px;border-bottom:${i < allMessages.length - 1 ? '1px solid #f3f4f6' : 'none'};background:${!m.read_at ? '#fafaf9' : '#fff'}">
            ${agentAvatar(m.from_agent)}
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
                <span style="font-weight:700;color:#111;font-size:13px">${m.from_agent}</span>
                <span style="color:#9ca3af;font-size:12px">→ ${m.to_agent === 'broadcast' ? '📢 all agents' : m.to_agent}</span>
                ${typeBadge(m.type)}
                <span style="width:8px;height:8px;border-radius:50%;background:${priorityColor(m.priority)};display:inline-block"></span>
                <span style="color:#9ca3af;font-size:11px;margin-left:auto">${timeAgo(m.created_at)}</span>
              </div>
              <div style="font-weight:600;color:#374151;font-size:13px;margin-top:4px">${m.subject}</div>
              <div style="color:#6b7280;font-size:12px;margin-top:3px;line-height:1.5">${m.body.slice(0, 240)}${m.body.length > 240 ? '…' : ''}</div>
              ${m.requires_response && !m.responded_at ? html`
              <div style="margin-top:6px;font-size:11px;color:#f59e0b;font-weight:600">⏳ Response requested</div>` : ''}
            </div>
          </div>`)}
        `}
      </div>

    </div>`;

  return c.html(dashboardLayout(ctx, body as unknown as HtmlContent));
});
