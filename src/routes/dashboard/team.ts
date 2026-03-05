// =============================================================================
// FOUNDRY — Team / Co-Founder Dashboard
// Invite co-founders, manage roles, view alignment score, co-vote decisions.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { buildSharedContext } from './_shared.js';
import { dashboardLayout } from '../../views/layout.js';
import {
  getTeamMembers,
  getPendingInvitations,
  inviteTeamMember,
  acceptInvitation,
  computeAlignmentScore,
  getDecisionVotes,
  submitDecisionVote,
} from '../../services/team/members.js';
import { query } from '../../db/client.js';

export const teamRoutes = new Hono<AuthEnv>();

// ─── GET /team ────────────────────────────────────────────────────────────────

teamRoutes.get('/team', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const [members, invitations, latestAlignment] = await Promise.all([
    getTeamMembers(ctx.product.id),
    getPendingInvitations(ctx.product.id),
    query(
      `SELECT alignment_score, divergence_areas, priority_consensus, snapshot_date
       FROM alignment_snapshots WHERE product_id = ? ORDER BY snapshot_date DESC LIMIT 1`,
      [ctx.product.id],
    ),
  ]);

  const alignment = latestAlignment.rows[0] as Record<string, unknown> | undefined;
  const alignmentScore = alignment?.alignment_score as number | undefined;
  const divergences = alignment?.divergence_areas
    ? JSON.parse(alignment.divergence_areas as string) as string[]
    : [];

  const content = html`
    <div class="page-header">
      <h1>Team</h1>
      <p class="page-subtitle">Co-founders and collaborators with access to this product.</p>
    </div>

    ${alignmentScore !== undefined ? html`
      <div class="alignment-card card">
        <div class="alignment-score-display">
          <span class="alignment-number ${alignmentScore >= 80 ? 'high' : alignmentScore >= 60 ? 'mid' : 'low'}">${alignmentScore}</span>
          <div class="alignment-label">
            <strong>Alignment Score</strong>
            <span>${alignment?.snapshot_date as string}</span>
          </div>
        </div>
        ${divergences.length > 0 ? html`
          <div class="alignment-divergences">
            <p><strong>Divergent decisions:</strong></p>
            <ul>${divergences.map((d) => html`<li>${d}</li>`)}</ul>
          </div>
        ` : html`<p class="alignment-note">Full consensus on all recent decisions.</p>`}
      </div>
    ` : ''}

    <div class="team-section">
      <h2>Team Members</h2>
      <div class="team-list">
        ${members.map((m) => html`
          <div class="team-member-row">
            <div class="member-info">
              <strong>${(m as unknown as Record<string, string>).founder_name ?? 'Unknown'}</strong>
              <span class="member-email">${(m as unknown as Record<string, string>).founder_email ?? ''}</span>
            </div>
            <span class="role-badge role-${m.role}">${m.role.replace('_', ' ')}</span>
            ${m.founder_id !== founder.id ? html`
              <form method="POST" action="/team/remove/${m.id}">
                <button type="submit" class="btn btn-ghost btn-sm">Remove</button>
              </form>
            ` : html`<span class="you-badge">you</span>`}
          </div>
        `)}
      </div>

      <form method="POST" action="/team/invite" class="invite-form card">
        <h3>Invite Co-Founder</h3>
        <div class="form-row">
          <div class="form-group flex-1">
            <label for="email">Email address</label>
            <input type="email" id="email" name="email" required placeholder="cofounder@example.com" />
          </div>
          <div class="form-group">
            <label for="role">Role</label>
            <select id="role" name="role">
              <option value="co_founder">Co-founder</option>
              <option value="advisor">Advisor</option>
              <option value="investor_observer">Investor observer</option>
            </select>
          </div>
        </div>
        <div class="form-group">
          <label for="message">Personal note (optional)</label>
          <input type="text" id="message" name="message" placeholder="Joining us on [product name]..." />
        </div>
        <button type="submit" class="btn btn-primary">Send Invitation</button>
      </form>
    </div>

    ${invitations.length > 0 ? html`
      <div class="team-section">
        <h2>Pending Invitations</h2>
        <div class="team-list">
          ${invitations.map((inv) => html`
            <div class="team-member-row">
              <div class="member-info">
                <strong>${inv.email}</strong>
                <span class="member-email">${inv.role.replace('_', ' ')} · expires ${new Date(inv.expires_at).toLocaleDateString()}</span>
              </div>
              <form method="POST" action="/team/revoke-invitation/${inv.id}">
                <button type="submit" class="btn btn-ghost btn-sm">Revoke</button>
              </form>
            </div>
          `)}
        </div>
      </div>
    ` : ''}
  `;

  return c.html(dashboardLayout(ctx, String(content), 'Team'));
});

// ─── POST /team/invite ────────────────────────────────────────────────────────

teamRoutes.post('/team/invite', async (c) => {
  const founder = c.get('founder');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  const body = await c.req.parseBody() as Record<string, string>;
  const { email, role, message } = body;

  if (!email) return c.redirect('/team?error=email_required');

  try {
    await inviteTeamMember(
      ctx.product.id,
      founder.id,
      email,
      (role ?? 'co_founder') as 'co_founder' | 'advisor' | 'investor_observer',
      message,
    );
    return c.redirect('/team?invited=1');
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invitation failed';
    return c.redirect(`/team?error=${encodeURIComponent(msg)}`);
  }
});

// ─── GET /team/accept/:token — Accept invitation ──────────────────────────────

teamRoutes.get('/team/accept/:token', async (c) => {
  const founder = c.get('founder');
  const token = c.req.param('token');

  try {
    const result = await acceptInvitation(token, founder.id);
    return c.redirect(`/dashboard?product=${result.product_id}&joined=1`);
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Invalid invitation';
    return c.redirect(`/?error=${encodeURIComponent(msg)}`);
  }
});

// ─── POST /team/remove/:id ────────────────────────────────────────────────────

teamRoutes.post('/team/remove/:id', async (c) => {
  const founder = c.get('founder');
  const memberId = c.req.param('id');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  // Only product owner can remove members
  await query(
    `UPDATE team_members SET status = 'removed'
     WHERE id = ? AND product_id = ? AND founder_id != ?`,
    [memberId, ctx.product.id, founder.id],
  );

  return c.redirect('/team');
});

// ─── POST /team/revoke-invitation/:id ────────────────────────────────────────

teamRoutes.post('/team/revoke-invitation/:id', async (c) => {
  const founder = c.get('founder');
  const invId = c.req.param('id');
  const ctx = await buildSharedContext(c);
  if (!ctx.product) return c.redirect('/products');

  await query(
    `DELETE FROM team_invitations WHERE id = ? AND product_id = ? AND invited_by = ?`,
    [invId, ctx.product.id, founder.id],
  );

  return c.redirect('/team');
});

// ─── POST /api/decisions/:id/vote ─────────────────────────────────────────────

teamRoutes.post('/api/decisions/:id/vote', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');
  const body = await c.req.json() as {
    vote: 'approve' | 'reject' | 'abstain' | 'needs_more_info';
    preferred_option?: string;
    rationale?: string;
    concerns?: string[];
  };

  // Verify the decision belongs to a product the founder can access
  const result = await query(
    `SELECT product_id FROM decisions WHERE id = ?`,
    [decisionId],
  );
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (result.rows[0] as Record<string, string>).product_id;

  // Verify access (owner or team member)
  const { hasProductAccess } = await import('../../services/team/members.js');
  const hasAccess = await hasProductAccess(productId, founder.id);
  if (!hasAccess) return c.json({ error: 'Not found' }, 404);

  await submitDecisionVote(
    decisionId,
    productId,
    founder.id,
    body.vote,
    body.preferred_option,
    body.rationale,
    body.concerns,
  );

  return c.json({ ok: true });
});

// ─── GET /api/decisions/:id/votes ────────────────────────────────────────────

teamRoutes.get('/api/decisions/:id/votes', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('id');

  const result = await query(`SELECT product_id FROM decisions WHERE id = ?`, [decisionId]);
  if (result.rows.length === 0) return c.json({ error: 'Not found' }, 404);
  const productId = (result.rows[0] as Record<string, string>).product_id;

  const { hasProductAccess } = await import('../../services/team/members.js');
  if (!(await hasProductAccess(productId, founder.id))) return c.json({ error: 'Not found' }, 404);

  const votes = await getDecisionVotes(decisionId);
  return c.json({ votes });
});
