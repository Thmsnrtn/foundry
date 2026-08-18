// =============================================================================
// FOUNDRY — Multi-Modal Signal Dashboard
// Call transcripts, competitor job signals, and calendar time allocation.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { getLayoutContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import { requireCompanyCapability } from '../../middleware/rbac.js';
import {
  ingestTranscript,
  analyzeTranscript,
  getTranscriptSummaries,
  getCompetitorMentionTrends,
} from '../../services/integrations/transcripts.js';
import {
  addJobSignal,
  getJobSignalTrends,
  listJobSignals,
} from '../../services/integrations/job-signals.js';
import {
  recordWeekAllocation,
  getTimeAllocationTrends,
  analyzeTimeVsStrategy,
} from '../../services/integrations/calendar-intel.js';

export const multimodalSignals = new Hono<AuthEnv>();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function sentimentBadge(score: number | null): string {
  if (score === null) return '<span class="badge badge-neutral">—</span>';
  if (score > 0.3) return '<span class="badge badge-green">Positive</span>';
  if (score < -0.3) return '<span class="badge badge-red">Negative</span>';
  return '<span class="badge badge-yellow">Neutral</span>';
}

function severityColor(velocity: number): string {
  if (velocity >= 5) return '#ef4444';
  if (velocity >= 3) return '#f59e0b';
  return '#4ecca3';
}

// ─── GET /signals/multimodal ─────────────────────────────────────────────────

multimodalSignals.get('/signals/multimodal', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Multi-Modal Signals', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const activeTab = c.req.query('tab') ?? 'transcripts';

  const [transcripts, competitorTrends, jobTrends, timeTrends] = await Promise.all([
    getTranscriptSummaries(ctx.productId, 20).catch(() => []),
    getCompetitorMentionTrends(ctx.productId).catch(() => []),
    getJobSignalTrends(ctx.productId).catch(() => []),
    getTimeAllocationTrends(ctx.productId, 8).catch(() => []),
  ]);

  const content = html`
    <div class="page-header">
      <h1>Multi-Modal Signals</h1>
      <p class="text-muted">Call transcripts, competitor hiring intelligence, and time allocation analysis.</p>
    </div>

    <div class="tab-bar">
      <a href="?tab=transcripts" class="tab ${activeTab === 'transcripts' ? 'active' : ''}">Transcripts</a>
      <a href="?tab=jobs" class="tab ${activeTab === 'jobs' ? 'active' : ''}">Job Signals</a>
      <a href="?tab=calendar" class="tab ${activeTab === 'calendar' ? 'active' : ''}">Calendar</a>
    </div>

    ${activeTab === 'transcripts' ? html`
      <div class="section">
        <div class="section-header">
          <h2>Call Transcripts</h2>
          <a href="/signals/multimodal/transcript/new" class="btn btn-primary btn-sm">+ Add Transcript</a>
        </div>
        ${competitorTrends.length > 0 ? html`
          <div class="insight-bar">
            <strong>Competitor mentions:</strong>
            ${competitorTrends.map(t => html`
              <span class="competitor-chip" style="color: ${t.avg_sentiment > 0 ? '#4ecca3' : t.avg_sentiment < 0 ? '#ef4444' : '#94a3b8'}">
                ${t.competitor} (${t.mention_count})
              </span>
            `)}
          </div>
        ` : ''}
        ${transcripts.length === 0 ? html`
          <div class="empty-state">
            <p>No transcripts yet. Add your first call transcript to start extracting customer intelligence.</p>
          </div>
        ` : html`
          <table class="data-table">
            <thead><tr><th>Date</th><th>Type</th><th>Sentiment</th><th>Competitors</th><th>Objections</th><th>Summary</th></tr></thead>
            <tbody>
              ${transcripts.map(t => html`
                <tr>
                  <td><a href="/signals/multimodal/transcript/${t.id}">${t.call_date}</a></td>
                  <td><span class="badge badge-neutral">${t.call_type}</span></td>
                  <td>${sentimentBadge(t.sentiment_score)}</td>
                  <td>${t.competitor_count}</td>
                  <td>${t.objection_count}</td>
                  <td class="text-muted text-sm">${t.summary ? String(t.summary).slice(0, 80) + '…' : '—'}</td>
                </tr>
              `)}
            </tbody>
          </table>
        `}
      </div>
    ` : activeTab === 'jobs' ? html`
      <div class="section">
        <div class="section-header">
          <h2>Competitor Job Signals</h2>
          <a href="/signals/multimodal/job-signal/new" class="btn btn-primary btn-sm">+ Add Signal</a>
        </div>
        ${jobTrends.length === 0 ? html`
          <div class="empty-state">
            <p>No job signals yet. Track competitor hiring to understand their strategic direction.</p>
          </div>
        ` : html`
          <div class="card-grid">
            ${jobTrends.map(trend => html`
              <div class="card">
                <div class="card-header">
                  <h3>${trend.competitor}</h3>
                  <span class="badge" style="background:${severityColor(trend.hiring_velocity)}20;color:${severityColor(trend.hiring_velocity)}">
                    ${trend.hiring_velocity} hires/30d
                  </span>
                </div>
                <p class="text-muted text-sm">${trend.strategic_direction}</p>
                <div class="signal-list">
                  ${trend.recent_signals.slice(0, 3).map((s: { title: string; department: string; interpretation: string; posted_at: string }) => html`
                    <div class="signal-item">
                      <span class="signal-title">${s.title}</span>
                      <span class="badge badge-neutral">${s.department ?? '—'}</span>
                      <p class="text-xs text-muted">${s.interpretation ?? ''}</p>
                    </div>
                  `)}
                </div>
              </div>
            `)}
          </div>
        `}
      </div>
    ` : html`
      <div class="section">
        <div class="section-header">
          <h2>Time Allocation</h2>
          <a href="/signals/multimodal/calendar/new" class="btn btn-primary btn-sm">+ Log Week</a>
        </div>
        ${timeTrends.length === 0 ? html`
          <div class="empty-state">
            <p>No time logs yet. Track how you spend your time to surface misalignments with strategy.</p>
          </div>
        ` : html`
          <table class="data-table">
            <thead>
              <tr>
                <th>Week</th>
                <th>Customer</th><th>Sales</th><th>Engineering</th>
                <th>Strategy</th><th>Admin</th><th>Recruiting</th><th>Total hrs</th>
              </tr>
            </thead>
            <tbody>
              ${timeTrends.map(week => {
                const byCategory = Object.fromEntries(week.allocations.map((a: { category: string; hours: number }) => [a.category, a.hours]));
                return html`
                  <tr>
                    <td>${week.week_start}</td>
                    <td>${(byCategory['customer'] ?? 0).toFixed(1)}</td>
                    <td>${(byCategory['sales'] ?? 0).toFixed(1)}</td>
                    <td>${(byCategory['engineering'] ?? 0).toFixed(1)}</td>
                    <td>${(byCategory['strategy'] ?? 0).toFixed(1)}</td>
                    <td>${(byCategory['admin'] ?? 0).toFixed(1)}</td>
                    <td>${(byCategory['recruiting'] ?? 0).toFixed(1)}</td>
                    <td><strong>${week.total_hours.toFixed(1)}</strong></td>
                  </tr>
                `;
              })}
            </tbody>
          </table>
          <div class="section-actions">
            <form method="POST" action="/signals/multimodal/calendar/analyze">
              <button type="submit" class="btn btn-secondary">Analyze Time vs Strategy</button>
            </form>
          </div>
        `}
      </div>
    `}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /signals/multimodal/transcript/new ───────────────────────────────────

multimodalSignals.get('/signals/multimodal/transcript/new', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Add Transcript', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const content = html`
    <div class="page-header">
      <a href="/signals/multimodal?tab=transcripts" class="back-link">← Transcripts</a>
      <h1>Add Call Transcript</h1>
    </div>
    <div class="form-card" style="max-width:700px">
      <form method="POST" action="/signals/multimodal/transcript">
        <div class="form-group">
          <label>Call Type</label>
          <select name="call_type" class="form-control">
            <option value="customer">Customer</option>
            <option value="prospect">Prospect</option>
            <option value="internal">Internal</option>
            <option value="investor">Investor</option>
          </select>
        </div>
        <div class="form-group">
          <label>Source</label>
          <select name="source" class="form-control">
            <option value="fathom">Fathom</option>
            <option value="fireflies">Fireflies</option>
            <option value="gong">Gong</option>
            <option value="zoom">Zoom</option>
            <option value="manual">Manual</option>
          </select>
        </div>
        <div class="form-group">
          <label>Call Date</label>
          <input type="date" name="call_date" class="form-control" required />
        </div>
        <div class="form-group">
          <label>Participant Emails (comma-separated)</label>
          <input type="text" name="participant_emails" class="form-control" placeholder="alice@example.com, bob@example.com" />
        </div>
        <div class="form-group">
          <label>Duration (minutes)</label>
          <input type="number" name="duration_minutes" class="form-control" placeholder="30" />
        </div>
        <div class="form-group">
          <label>Transcript</label>
          <textarea name="transcript_text" class="form-control" rows="12" required placeholder="Paste the full transcript here..."></textarea>
        </div>
        <button type="submit" class="btn btn-primary">Ingest &amp; Analyze</button>
      </form>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /signals/multimodal/transcript ──────────────────────────────────────

multimodalSignals.post('/signals/multimodal/transcript',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Add Transcript', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const body = await c.req.parseBody();
  const id = await ingestTranscript(ctx.productId, {
    source: String(body['source'] ?? 'manual'),
    call_type: String(body['call_type'] ?? 'customer'),
    participant_emails: body['participant_emails'] ? String(body['participant_emails']) : undefined,
    duration_minutes: body['duration_minutes'] ? parseInt(String(body['duration_minutes'])) : undefined,
    transcript_text: String(body['transcript_text'] ?? ''),
    call_date: String(body['call_date'] ?? new Date().toISOString().slice(0, 10)),
  });

  // Fire-and-forget analysis
  analyzeTranscript(id).catch(() => {});

  return c.redirect(`/signals/multimodal/transcript/${id}`);
});

// ─── GET /signals/multimodal/transcript/:id ───────────────────────────────────

multimodalSignals.get('/signals/multimodal/transcript/:id', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Transcript Detail', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const { query } = await import('../../db/client.js');
  const rows = await query(
    `SELECT * FROM call_transcripts WHERE id = ? AND product_id = ?`,
    [c.req.param('id'), ctx.productId],
  );
  const t = rows.rows[0] as Record<string, unknown> | undefined;
  if (!t) return c.redirect('/signals/multimodal?tab=transcripts');

  const keyTopics: string[] = t['key_topics_json'] ? JSON.parse(String(t['key_topics_json'])) : [];
  const competitors: Array<{ name: string; context: string; sentiment: string }> =
    t['competitor_mentions_json'] ? JSON.parse(String(t['competitor_mentions_json'])) : [];
  const objections: string[] = t['objections_json'] ? JSON.parse(String(t['objections_json'])) : [];
  const commitments: string[] = t['commitments_json'] ? JSON.parse(String(t['commitments_json'])) : [];

  const content = html`
    <div class="page-header">
      <a href="/signals/multimodal?tab=transcripts" class="back-link">← Transcripts</a>
      <h1>${String(t['call_type'])} call — ${String(t['call_date'])}</h1>
    </div>
    <div class="detail-grid">
      <div class="detail-main">
        ${t['summary'] ? html`<div class="insight-card"><h3>Summary</h3><p>${String(t['summary'])}</p></div>` : ''}
        ${objections.length > 0 ? html`
          <div class="insight-card">
            <h3>Objections</h3>
            <ul>${objections.map(o => html`<li>${o}</li>`)}</ul>
          </div>
        ` : ''}
        ${commitments.length > 0 ? html`
          <div class="insight-card">
            <h3>Next Steps / Commitments</h3>
            <ul>${commitments.map(c => html`<li>${c}</li>`)}</ul>
          </div>
        ` : ''}
        ${t['transcript_text'] ? html`
          <details class="transcript-full">
            <summary>Full Transcript</summary>
            <pre style="white-space:pre-wrap;font-size:0.85rem">${String(t['transcript_text'])}</pre>
          </details>
        ` : ''}
      </div>
      <div class="detail-sidebar">
        <div class="meta-card">
          <div class="meta-row"><span>Sentiment</span>${sentimentBadge(t['sentiment_score'] as number | null)}</div>
          <div class="meta-row"><span>Source</span><span>${String(t['source'])}</span></div>
          <div class="meta-row"><span>Duration</span><span>${t['duration_minutes'] ? String(t['duration_minutes']) + ' min' : '—'}</span></div>
        </div>
        ${keyTopics.length > 0 ? html`
          <div class="meta-card">
            <h4>Topics</h4>
            <div class="tag-list">${keyTopics.map(topic => html`<span class="tag">${topic}</span>`)}</div>
          </div>
        ` : ''}
        ${competitors.length > 0 ? html`
          <div class="meta-card">
            <h4>Competitor Mentions</h4>
            ${competitors.map(cm => html`
              <div class="competitor-mention">
                <strong>${cm.name}</strong>
                <span class="badge badge-neutral">${cm.sentiment}</span>
                <p class="text-xs text-muted">${cm.context}</p>
              </div>
            `)}
          </div>
        ` : ''}
      </div>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /signals/multimodal/job-signal/new ───────────────────────────────────

multimodalSignals.get('/signals/multimodal/job-signal/new', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Add Job Signal', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const content = html`
    <div class="page-header">
      <a href="/signals/multimodal?tab=jobs" class="back-link">← Job Signals</a>
      <h1>Add Competitor Job Signal</h1>
    </div>
    <div class="form-card" style="max-width:600px">
      <form method="POST" action="/signals/multimodal/job-signal">
        <div class="form-group">
          <label>Competitor Name</label>
          <input type="text" name="competitor_name" class="form-control" required placeholder="Acme Corp" />
        </div>
        <div class="form-group">
          <label>Job Title</label>
          <input type="text" name="job_title" class="form-control" required placeholder="Senior ML Engineer" />
        </div>
        <div class="form-group">
          <label>Department</label>
          <select name="department" class="form-control">
            <option value="">Unknown</option>
            <option value="engineering">Engineering</option>
            <option value="product">Product</option>
            <option value="sales">Sales</option>
            <option value="marketing">Marketing</option>
            <option value="support">Support</option>
          </select>
        </div>
        <div class="form-group">
          <label>Seniority</label>
          <select name="seniority" class="form-control">
            <option value="">Unknown</option>
            <option value="junior">Junior</option>
            <option value="mid">Mid</option>
            <option value="senior">Senior</option>
            <option value="lead">Lead</option>
            <option value="executive">Executive</option>
          </select>
        </div>
        <div class="form-group">
          <label>Job URL (optional)</label>
          <input type="url" name="job_url" class="form-control" placeholder="https://jobs.example.com/..." />
        </div>
        <div class="form-group">
          <label>Description Excerpt</label>
          <textarea name="description_excerpt" class="form-control" rows="4" placeholder="Paste key parts of the job description..."></textarea>
        </div>
        <div class="form-group">
          <label>Posted Date</label>
          <input type="date" name="posted_at" class="form-control" required />
        </div>
        <button type="submit" class="btn btn-primary">Add &amp; Interpret</button>
      </form>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /signals/multimodal/job-signal ──────────────────────────────────────

multimodalSignals.post('/signals/multimodal/job-signal',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Add Job Signal', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const body = await c.req.parseBody();
  await addJobSignal(ctx.productId, {
    competitor_name: String(body['competitor_name'] ?? ''),
    job_title: String(body['job_title'] ?? ''),
    department: body['department'] ? String(body['department']) : undefined,
    seniority: body['seniority'] ? String(body['seniority']) : undefined,
    job_url: body['job_url'] ? String(body['job_url']) : undefined,
    description_excerpt: body['description_excerpt'] ? String(body['description_excerpt']) : undefined,
    posted_at: String(body['posted_at'] ?? new Date().toISOString().slice(0, 10)),
  });

  return c.redirect('/signals/multimodal?tab=jobs');
});

// ─── GET /signals/multimodal/calendar/new ─────────────────────────────────────

multimodalSignals.get('/signals/multimodal/calendar/new', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Log Week', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const categories = ['customer', 'sales', 'engineering', 'product', 'strategy', 'admin', 'recruiting', 'investors', 'other'];

  const content = html`
    <div class="page-header">
      <a href="/signals/multimodal?tab=calendar" class="back-link">← Calendar</a>
      <h1>Log Weekly Time Allocation</h1>
    </div>
    <div class="form-card" style="max-width:500px">
      <form method="POST" action="/signals/multimodal/calendar">
        <div class="form-group">
          <label>Week Start (Monday)</label>
          <input type="date" name="week_start" class="form-control" required />
        </div>
        ${categories.map(cat => html`
          <div class="form-row">
            <label style="width:140px;text-transform:capitalize">${cat}</label>
            <input type="number" name="hours_${cat}" class="form-control" min="0" max="80" step="0.5" placeholder="0" style="width:100px" />
            <span class="text-muted text-sm" style="margin-left:8px">hrs</span>
          </div>
        `)}
        <button type="submit" class="btn btn-primary" style="margin-top:16px">Save Week</button>
      </form>
    </div>
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── POST /signals/multimodal/calendar ────────────────────────────────────────

multimodalSignals.post('/signals/multimodal/calendar',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Log Week', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const body = await c.req.parseBody();
  const categories = ['customer', 'sales', 'engineering', 'product', 'strategy', 'admin', 'recruiting', 'investors', 'other'];
  const weekStart = String(body['week_start'] ?? '');

  const allocations = categories
    .map(cat => ({
      category: cat,
      hours: parseFloat(String(body[`hours_${cat}`] ?? '0')) || 0,
    }))
    .filter(a => a.hours > 0);

  if (weekStart && allocations.length > 0) {
    await recordWeekAllocation(ctx.productId, weekStart, allocations);
  }

  return c.redirect('/signals/multimodal?tab=calendar');
});

// ─── POST /signals/multimodal/calendar/analyze ───────────────────────────────

multimodalSignals.post('/signals/multimodal/calendar/analyze',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Time Analysis', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const analysis = await analyzeTimeVsStrategy(ctx.productId).catch(() => ({
    analysis: 'Unable to analyze time allocation — not enough data.',
    misalignments: [],
  }));

  const content = html`
    <div class="page-header">
      <a href="/signals/multimodal?tab=calendar" class="back-link">← Calendar</a>
      <h1>Time vs Strategy Analysis</h1>
    </div>
    <div class="insight-card" style="max-width:700px">
      <p>${analysis.analysis}</p>
    </div>
    ${analysis.misalignments.length > 0 ? html`
      <div class="section" style="max-width:700px">
        <h2>Misalignments</h2>
        <table class="data-table">
          <thead><tr><th>Area</th><th>Your Time</th><th>Recommended</th><th>Gap</th></tr></thead>
          <tbody>
            ${analysis.misalignments.map(m => html`
              <tr>
                <td style="text-transform:capitalize">${m.area}</td>
                <td>${m.time_pct.toFixed(0)}%</td>
                <td>${m.recommended_pct.toFixed(0)}%</td>
                <td class="text-muted text-sm">${m.gap}</td>
              </tr>
            `)}
          </tbody>
        </table>
      </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, content));
});

// ─── GET /signals/multimodal/competitors ─────────────────────────────────────

multimodalSignals.get('/signals/multimodal/competitors', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'signals-multimodal', 'Competitor Intelligence', undefined, c);
  if (!ctx.productId) return c.redirect('/products');

  const [jobTrends, mentionTrends] = await Promise.all([
    getJobSignalTrends(ctx.productId).catch(() => []),
    getCompetitorMentionTrends(ctx.productId).catch(() => []),
  ]);

  // Merge by competitor name
  const competitorMap = new Map<string, { hiring_velocity: number; hiring_direction: string; mention_count: number; avg_sentiment: number; contexts: string[] }>();
  for (const t of jobTrends) {
    competitorMap.set(t.competitor, { hiring_velocity: t.hiring_velocity, hiring_direction: t.strategic_direction, mention_count: 0, avg_sentiment: 0, contexts: [] });
  }
  for (const m of mentionTrends) {
    const existing = competitorMap.get(m.competitor) ?? { hiring_velocity: 0, hiring_direction: '', mention_count: 0, avg_sentiment: 0, contexts: [] };
    existing.mention_count = m.mention_count;
    existing.avg_sentiment = m.avg_sentiment;
    existing.contexts = m.recent_contexts;
    competitorMap.set(m.competitor, existing);
  }

  const content = html`
    <div class="page-header">
      <a href="/signals/multimodal" class="back-link">← Signals</a>
      <h1>Competitor Intelligence</h1>
      <p class="text-muted">Aggregated from job postings and call transcript mentions.</p>
    </div>
    ${competitorMap.size === 0 ? html`
      <div class="empty-state"><p>No competitor data yet. Add job signals or transcript mentions to build intelligence.</p></div>
    ` : html`
      <div class="card-grid">
        ${Array.from(competitorMap.entries()).map(([name, data]) => html`
          <div class="card">
            <h3>${name}</h3>
            <div class="meta-row">
              <span>Hiring velocity</span>
              <span style="color:${severityColor(data.hiring_velocity)}">${data.hiring_velocity}/30d</span>
            </div>
            <div class="meta-row">
              <span>Call mentions</span>
              <span>${data.mention_count}</span>
            </div>
            ${data.hiring_direction ? html`<p class="text-sm text-muted" style="margin-top:8px">${data.hiring_direction}</p>` : ''}
            ${data.contexts.length > 0 ? html`
              <div style="margin-top:8px">
                ${data.contexts.slice(0, 2).map(ctx => html`<p class="text-xs text-muted">"${ctx}"</p>`)}
              </div>
            ` : ''}
          </div>
        `)}
      </div>
    `}
  `;

  return c.html(dashboardLayout(ctx, content));
});
