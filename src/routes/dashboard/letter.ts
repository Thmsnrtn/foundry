// =============================================================================
// FOUNDRY — The Letter (Ascent B7 / Attention Law)
// One page. What ran without you, the one thing that needs you, what was
// learned, how trust moved. When it's quiet, it says so and lets you leave.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { composeLetter } from '../../services/letter/composer.js';
import {
  getAllPolicies, setPolicy, panicStop, getShadowStats,
  MODE_LABELS, PROMOTION_THRESHOLD, type AutopilotMode,
} from '../../services/autopilot/policy.js';
import { getFluency, gateLabel, explain, adviceFooter } from '../../services/ux/fluency.js';
import { html as _html } from 'hono/html';

/** The point-of-use advice disclaimer strip (LIABILITY-AUDIT.md). */
const adviceStrip = (f: Parameters<typeof adviceFooter>[0]) => _html`
  <p style="margin-top:1.5rem;padding-top:0.75rem;border-top:1px solid rgba(255,255,255,0.06);font-size:0.72rem;color:var(--text-muted);">
    ${adviceFooter(f)}
  </p>`;
import { connectionRoutes } from './connections.js';

export const letterRoutes = new Hono<AuthEnv>();

// Connections (Hands Law) rides the autopilot module — Controls and
// Connections are one door (Attention Law: mounts may only shrink).
letterRoutes.route('/', connectionRoutes);

const section = (label: string, items: string[]) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">${label}</div>
    ${items.map((i) => html`<div style="font-size:0.9rem;color:var(--text-primary);padding:0.35rem 0;border-top:1px solid rgba(255,255,255,0.05);">${i}</div>`)}
  </div>`;

const responsibilitySection = (
  label: string,
  items: Array<{ responsibilityId: string; title: string; state: string; evidenceRef: string | null }>,
  productId: string,
  disposition: 'active' | 'deliberately_not_done',
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">${label}</div>
    ${items.map((item) => html`
      <div style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${item.title} — ${item.state}</div>
        ${item.evidenceRef ? html`
          <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/disposition"
            style="display:flex;gap:0.4rem;margin-top:0.45rem;align-items:center;flex-wrap:wrap;">
            <input type="hidden" name="product_id" value="${productId}" />
            <input type="hidden" name="evidence_ref" value="${item.evidenceRef}" />
            <input type="hidden" name="disposition" value="${disposition}" />
            <input name="reason" required maxlength="500" placeholder="Why?"
              style="flex:1;min-width:180px;" />
            <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">
              ${disposition === 'active' ? 'Reopen' : 'Do not pursue'}
            </button>
          </form>` : html`<div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem;">No grounded evidence is available for an owner disposition.</div>`}
      </div>`)}
  </div>`;

// Direction is not permission. The owner tells Foundry which way to go; the
// separate, exact, responsibility-bound grant is what would let Foundry act.
// The copy says so on every judgment rather than relying on the founder to know.
const judgmentSection = (
  items: Array<import('../../services/institution/institutional-judgment-disposition.js').MaterialJudgment>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Judgments that need your direction</div>
    ${items.map((j) => html`
      <div style="padding:0.6rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${j.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">${j.description}</div>
        ${j.uncertainties.length ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem;">Still uncertain: ${j.uncertainties.join('; ')}</div>` : ''}
        ${j.evaluationState === 'contradicted' || j.evaluationState === 'conflicting' ? html`
          <div style="font-size:0.72rem;color:#ffb347;margin-top:0.3rem;">What happened since ${j.evaluationState === 'contradicted' ? 'contradicts this' : 'conflicts with this'}.</div>` : ''}
        ${j.disposition ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.3rem;">Your current direction: ${j.disposition.replaceAll('_', ' ')}${j.selectedAlternative ? html` — ${j.selectedAlternative}` : ''}. You can change it below.</div>` : ''}
        <form method="POST" action="/letter/judgments/${j.id}/disposition"
          style="display:flex;gap:0.4rem;margin-top:0.45rem;align-items:center;flex-wrap:wrap;">
          <select name="direction" style="font-size:0.78rem;">
            <option value="accepted">Go this way</option>
            ${j.alternatives.map((alt, i) => html`<option value="alternative:${i}">Instead: ${alt}</option>`)}
            <option value="deferred">Not yet — decide later</option>
            <option value="rejected">Do not go this way</option>
          </select>
          <input name="reason" required maxlength="500" placeholder="Why?" style="flex:1;min-width:180px;" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Set direction</button>
        </form>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">Setting a direction does not let Foundry carry this out — that still needs a separate permission from you.</div>
      </div>`)}
  </div>`;

letterRoutes.get('/letter', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const fluency = getFluency(founder);

  // Jarvis slice 1: a portfolio operator gets ONE letter across the fleet —
  // composed, then independently VERIFIED before it renders. Single-product
  // founders keep the classic letter (same facts, no fleet chrome).
  if (ctx.allProducts.length > 1) {
    const { composeFleetLetter } = await import('../../services/letter/fleet.js');
    const { verifyFleetLetter } = await import('../../services/letter/verifier.js');
    const { letter: fleet } = await verifyFleetLetter(await composeFleetLetter(founder.id, fluency));
    const intro2 = explain('letter', fluency);

    const content = html`
      <h1 style="margin-bottom:0.25rem;">The Letter</h1>
      <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">${new Date().toDateString()} — one letter, your whole fleet. Every line verified against the ledgers before you see it.</p>
      ${intro2 ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:-1rem 0 1.25rem;">${intro2}</p>` : ''}

      ${fleet.quiet ? html`
        <div class="card" style="padding:1.5rem;text-align:center;">
          <div style="font-size:1rem;color:var(--text-primary);">Quiet day across all ${fleet.products.length} companies. Nothing needs you.</div>
          <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.4rem;">That's the goal. Go build — or rest.</div>
        </div>` : html`
        ${fleet.needsYou.length > 0 ? html`
        <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid var(--accent);">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);margin-bottom:0.4rem;">What needs you — ranked across the fleet</div>
          ${fleet.needsYou.map((n, i) => html`
          <div style="display:flex;align-items:center;gap:0.6rem;padding:0.45rem 0;${i > 0 ? 'border-top:1px solid rgba(255,255,255,0.05);' : ''}flex-wrap:wrap;">
            <span style="font-size:0.72rem;color:var(--text-muted);min-width:1.2rem;">${i + 1}.</span>
            <div style="flex:1;min-width:200px;">
              <div style="font-size:0.92rem;color:var(--text-primary);">${n.what}</div>
              <div style="font-size:0.75rem;color:var(--text-muted);">${n.productName} · ${gateLabel(n.gate, fluency)}${n.deadline ? html` · due ${n.deadline}` : ''}</div>
            </div>
            <a href="/decisions/${n.decisionId}" class="btn btn-primary" style="font-size:0.78rem;padding:0.3rem 0.7rem;"
              onclick="fetch('/letter/attention/${n.decisionId}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product_id:'${n.productId}',reaction:'acted'})})">Decide</a>
            <form method="POST" action="/letter/attention/${n.decisionId}" style="margin:0;">
              <input type="hidden" name="product_id" value="${n.productId}" />
              <input type="hidden" name="reaction" value="dismissed" />
              <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;" title="Not now — teaches the ranking">Later</button>
            </form>
          </div>`)}
        </div>` : ''}

        ${fleet.system.length > 0 ? html`
        <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:0.9rem;border:1px solid rgba(255,179,71,0.35);">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffb347;margin-bottom:0.4rem;">Your machine</div>
          ${fleet.system.map((s) => html`<div style="font-size:0.85rem;color:var(--text-primary);padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);">${s}</div>`)}
        </div>` : ''}

        ${fleet.products.map((p) => (p.letter.quiet && Object.values(p.responsibilities).every((items) => items.length === 0) ? '' : html`
        <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:0.9rem;">
          <div style="display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.5rem;">
            <span style="font-weight:600;color:var(--text-primary);">${p.productName}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${p.riskState}</span>
          </div>
          ${[...p.letter.handled.map((l) => ({ tag: 'handled', l })),
             ...p.letter.learned.map((l) => ({ tag: 'learned', l })),
             ...p.letter.trust.map((l) => ({ tag: 'trust', l }))].map((row) => html`
            <div style="font-size:0.85rem;color:var(--text-primary);padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);">
              <span style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-right:0.5rem;">${row.tag}</span>${row.l}
            </div>`)}
          ${Object.entries(p.responsibilities).flatMap(([classification, items]) => items.map((item) => html`
            <div style="font-size:0.85rem;color:var(--text-primary);padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);">
              <span style="font-size:0.68rem;text-transform:uppercase;letter-spacing:0.08em;color:var(--text-muted);margin-right:0.5rem;">${classification.replaceAll('_', ' ')}</span>${item.title}
            </div>`))}
        </div>`))}
      `}
      ${adviceStrip(fluency)}
    `;
    return c.html(dashboardLayout(ctx, content));
  }

  const letter = await composeLetter(ctx.productId, fluency);
  const { getSevenDayResponsibilitySummary } = await import('../../services/institution/absence-summary.js');
  const responsibilitySummary = await getSevenDayResponsibilitySummary(ctx.productId);
  const { getPendingResponsibilityCandidates } = await import('../../services/institution/responsibility-candidate.js');
  const responsibilityCandidates = await getPendingResponsibilityCandidates(ctx.productId);
  const { getMaterialShadowingExceptions } = await import('../../services/institution/responsibility-shadowing.js');
  const shadowingExceptions = await getMaterialShadowingExceptions(ctx.productId);
  const { getFounderAssistingActivity } = await import('../../services/institution/responsibility-assisted-email.js');
  const assistingActivity = await getFounderAssistingActivity(ctx.productId);
  const { getMaterialJudgments } = await import('../../services/institution/institutional-judgment-disposition.js');
  const materialJudgments = await getMaterialJudgments(ctx.productId);
  const { getFounderDevelopmentActivity } = await import('../../services/institution/development-assisting.js');
  const development = await getFounderDevelopmentActivity(ctx.productId);
  const hasResponsibilitySummary = Object.values(responsibilitySummary).some((items) => items.length > 0)
    || materialJudgments.length > 0;
  const needsYou = letter.needsYou
    ? letter.needsYou.replace(/^Gate-(\d+)/, (_, g: string) => gateLabel(Number(g), fluency))
    : null;
  const intro = explain('letter', fluency);

  const content = html`
    <h1 style="margin-bottom:0.25rem;">The Letter</h1>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">${new Date().toDateString()} — from your team.</p>
    ${intro ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:-1rem 0 1.25rem;">${intro}</p>` : ''}

    ${letter.firstRun ? html`
      <div class="card" style="padding:1.5rem;border:1px solid var(--accent);">
        <div style="font-size:1.05rem;color:var(--text-primary);font-weight:600;">Welcome — let's get your first signal.</div>
        <div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.5rem;line-height:1.55;">
          This letter is where your AI team reports in each morning. It's empty because there's no data yet — that's expected on day one. Two things bring it to life:
        </div>
        <div style="margin-top:0.85rem;display:flex;flex-direction:column;gap:0.5rem;">
          <a href="/connections" class="btn btn-primary" style="font-size:0.85rem;align-self:flex-start;">Connect your tools → so Foundry can see your real numbers</a>
          <a href="/decisions" class="btn btn-secondary" style="font-size:0.85rem;align-self:flex-start;">Log your first decision → and the belief behind it, so Foundry can watch it</a>
        </div>
      </div>` : letter.quiet && !hasResponsibilitySummary ? html`
      <div class="card" style="padding:1.5rem;text-align:center;">
        <div style="font-size:1rem;color:var(--text-primary);">Quiet day. Nothing needs you.</div>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.4rem;">That's the goal. Go build — or rest.</div>
      </div>` : html`
      ${letter.needsYou ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid var(--accent);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);margin-bottom:0.4rem;">The one thing that needs you</div>
        <div style="font-size:0.95rem;color:var(--text-primary);">${needsYou}</div>
        <a href="/decisions" class="btn btn-primary" style="margin-top:0.75rem;font-size:0.82rem;display:inline-block;">Decide</a>
      </div>` : ''}
      ${section('Actions handled', letter.handled)}
      ${section('What I learned', letter.learned)}
      ${section('What I handled', responsibilitySummary.HANDLED.map((i) => `${i.title} — outcome recorded`))}
      ${section('What changed', responsibilitySummary.CHANGED.map((i) => `${i.title} — ${i.state}`))}
      ${section('What differed while I watched', shadowingExceptions.map((item) =>
        `${item.title} — expected ${item.expectedEventType}; ${item.classification === 'unresolved'
          ? `the outcome remains unresolved (${item.observedSummary})`
          : `instead observed: ${item.observedSummary}`}. I am observing, not carrying this responsibility.`))}
      ${section('Bounded help', assistingActivity.map((item)=>`${item.title} — ${item.detail}`))}
      ${judgmentSection(materialJudgments)}
      ${section('Changes I made to your systems', development.changes.map((c) => `${c.what} — ${c.detail}`))}
      ${development.permitted.length ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">What I'm allowed to change right now</div>
        ${development.permitted.map((p) => html`
          <div style="font-size:0.85rem;color:var(--text-primary);padding:0.35rem 0;border-top:1px solid rgba(255,255,255,0.05);">
            I may ${p.what}, only under ${p.where.join(', ')}, until ${p.until}.
          </div>`)}
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">You can withdraw this at any time in Controls.</div>
      </div>` : ''}
      ${responsibilityCandidates.length ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Possible responsibilities requiring your judgment</div>
        ${responsibilityCandidates.map((candidate)=>html`
          <form method="POST" action="/letter/responsibility-candidates/${candidate.id}/promote"
            style="padding:0.5rem 0;border-top:1px solid rgba(255,255,255,0.05);">
            <div style="font-size:0.9rem;color:var(--text-primary);">${candidate.proposedResponsibility}</div>
            <div style="font-size:0.72rem;color:var(--text-muted);">${candidate.epistemicStatus} evidence · confirming recognizes the responsibility but grants no authority</div>
            <button type="submit" class="btn btn-ghost" style="margin-top:0.35rem;font-size:0.72rem;padding:0.25rem 0.5rem;">Recognize responsibility</button>
          </form>
          <form method="POST" action="/letter/responsibility-candidates/${candidate.id}/reject">
            <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Not a responsibility</button>
          </form>`)}
      </div>`:''}
      ${responsibilitySection('Responsibility that needs you', responsibilitySummary.NEEDS_YOU, ctx.productId, 'deliberately_not_done')}
      ${responsibilitySection('Deliberately not done', responsibilitySummary.DELIBERATELY_NOT_DONE, ctx.productId, 'active')}
      ${responsibilitySection('Still open', responsibilitySummary.STILL_OPEN, ctx.productId, 'deliberately_not_done')}
      ${section('How trust moved', letter.trust)}
    `}
    ${adviceStrip(fluency)}
  `;
  return c.html(dashboardLayout(ctx, content));
});

letterRoutes.post('/letter/responsibility-candidates/:candidateId/promote',async(c)=>{
  const founder=c.get('founder');
  // Product is resolved server-side from candidate + authenticated owner. No
  // hidden field or caller actor can establish the grounding identity.
  const { query }=await import('../../db/client.js');
  const result=await query(`SELECT c.product_id FROM responsibility_candidates c JOIN products p ON p.id=c.product_id
    WHERE c.id=? AND p.owner_id=?`,[c.req.param('candidateId'),founder.id]);
  if (!result.rows.length) return c.text('Candidate decision refused',403);
  const productId=String((result.rows[0] as Record<string,unknown>).product_id);
  const { promoteResponsibilityCandidate }=await import('../../services/institution/responsibility-candidate.js');
  try {
    await promoteResponsibilityCandidate({productId,candidateId:c.req.param('candidateId'),mechanism:'authenticated_owner',ownerId:founder.id as string});
  } catch { return c.text('Candidate decision refused',403); }
  return c.redirect('/letter');
});

letterRoutes.post('/letter/responsibility-candidates/:candidateId/reject',async(c)=>{
  const founder=c.get('founder');
  const { query }=await import('../../db/client.js');
  const result=await query(`SELECT c.product_id FROM responsibility_candidates c JOIN products p ON p.id=c.product_id
    WHERE c.id=? AND p.owner_id=?`,[c.req.param('candidateId'),founder.id]);
  if (!result.rows.length) return c.text('Candidate decision refused',403);
  const { decideResponsibilityCandidate }=await import('../../services/institution/responsibility-candidate.js');
  try {
    await decideResponsibilityCandidate({productId:String((result.rows[0] as Record<string,unknown>).product_id),
      candidateId:c.req.param('candidateId'),decision:'rejected',ownerId:founder.id as string,
      reason:'Authenticated owner does not recognize this as a responsibility'});
  } catch { return c.text('Candidate decision refused',403); }
  return c.redirect('/letter');
});

// The authenticated session is the authority source. Product and responsibility
// fields locate the object only; the disposition trigger independently verifies
// that the session founder owns that product and that the evidence is tenant-bound.
letterRoutes.post('/letter/responsibilities/:responsibilityId/disposition', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody();
  const disposition = String(body.disposition ?? '');
  if (disposition !== 'active' && disposition !== 'deliberately_not_done') {
    return c.text('Invalid disposition', 400);
  }
  const reason = String(body.reason ?? '').trim();
  const productId = String(body.product_id ?? '');
  const evidenceRef = String(body.evidence_ref ?? '');
  if (!reason || !productId || !evidenceRef) return c.text('Reason and grounded evidence are required', 400);
  const { setResponsibilityDisposition } = await import('../../services/institution/responsibility.js');
  try {
    await setResponsibilityDisposition({
      productId, responsibilityId: c.req.param('responsibilityId'), ownerId: founder.id as string,
      disposition, reason, evidenceRef,
    });
  } catch {
    // Do not reveal whether a cross-tenant responsibility or evidence identifier exists.
    return c.text('Disposition refused', 403);
  }
  return c.redirect('/letter');
});

// Owner direction on an institutional judgment. The authenticated session is
// the only actor source; the product is resolved server-side from the judgment
// plus real ownership, and a chosen alternative is located by position in the
// canonical judgment row rather than accepted as caller-supplied text. This
// records direction only — it creates no consent, action, or authority.
letterRoutes.post('/letter/judgments/:judgmentId/disposition', async (c) => {
  const founder = c.get('founder');
  const judgmentId = c.req.param('judgmentId');
  const body = await c.req.parseBody();
  const reason = String(body.reason ?? '').trim();
  const direction = String(body.direction ?? '');
  if (!reason) return c.text('A reason is required', 400);

  const { query } = await import('../../db/client.js');
  const owned = await query(
    `SELECT j.product_id FROM strategic_decisions_log j JOIN products p ON p.id=j.product_id
     WHERE j.id=? AND p.owner_id=? AND j.responsibility_refs_json IS NOT NULL`,
    [judgmentId, founder.id],
  );
  // Do not reveal whether another tenant's judgment exists.
  if (!owned.rows.length) return c.text('Direction refused', 403);
  const productId = String((owned.rows[0] as Record<string, unknown>).product_id);

  const {
    recordJudgmentDisposition, resolveRepresentedAlternative,
  } = await import('../../services/institution/institutional-judgment-disposition.js');

  let disposition: 'accepted' | 'rejected' | 'deferred' | 'alternative_selected';
  let selectedAlternative: string | undefined;
  if (direction.startsWith('alternative:')) {
    const resolved = await resolveRepresentedAlternative(
      productId, judgmentId, Number(direction.slice('alternative:'.length)),
    );
    if (resolved === null) return c.text('Direction refused', 403);
    disposition = 'alternative_selected';
    selectedAlternative = resolved;
  } else if (direction === 'accepted' || direction === 'rejected' || direction === 'deferred') {
    disposition = direction;
  } else {
    return c.text('Invalid direction', 400);
  }

  try {
    await recordJudgmentDisposition({
      productId, judgmentId, ownerId: founder.id as string, disposition, reason, selectedAlternative,
    });
  } catch { return c.text('Direction refused', 403); }
  return c.redirect('/letter');
});

// Attention memory capture — the founder's explicit reaction to a surfaced
// item (Jarvis slice 1). Accepts form posts (Later button) and JSON beacons
// (Decide click). Admission control lives in recordAttention.
letterRoutes.post('/letter/attention/:decisionId', async (c) => {
  const founder = c.get('founder');
  const decisionId = c.req.param('decisionId');
  let productId = '', reaction = '';
  const ct = c.req.header('content-type') ?? '';
  if (ct.includes('application/json')) {
    const body = await c.req.json().catch(() => ({})) as Record<string, string>;
    productId = String(body.product_id ?? '');
    reaction = String(body.reaction ?? '');
  } else {
    const body = await c.req.parseBody();
    productId = String(body.product_id ?? '');
    reaction = String(body.reaction ?? '');
  }
  if (['opened', 'acted', 'dismissed'].includes(reaction) && productId) {
    const { recordAttention } = await import('../../services/letter/fleet.js');
    await recordAttention(founder.id as string, productId, decisionId, reaction as 'opened' | 'acted' | 'dismissed');
  }
  return ct.includes('application/json') ? c.json({ ok: true }) : c.redirect('/letter');
});

// ─── Controls (Ascent B6 / Trust Law) — the autopilot's cockpit ───────────────
// Per-category dials in plain language, the evidence behind each level, and the
// big red button. Granting 'act' is the founder's explicit consent moment.

letterRoutes.get('/autopilot', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'autopilot', 'Controls', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const { getAllCalibrations } = await import('../../services/autopilot/calibration.js');
  const { platformCap, isCappedBelow } = await import('../../services/autopilot/platform-cap.js');
  const { DISCLOSURE_TEXT } = await import('../../services/autopilot/consent.js');
  const [policies, shadow, calibrations] = await Promise.all([
    getAllPolicies(ctx.productId),
    getShadowStats(ctx.productId),
    getAllCalibrations(ctx.productId),
  ]);
  const shadowByCat = new Map(shadow.map((s) => [s.category, s]));
  const calByCat = new Map(calibrations.map((c) => [c.category, c]));

  const rows = policies.map((p) => {
    const s = shadowByCat.get(p.category);
    const cal = calByCat.get(p.category);
    const agreement = s?.agreementRate != null ? `${Math.round(s.agreementRate * 100)}% agreement (${s.agreed}/${s.sampled})` : 'not enough shadow data yet';
    const calLine = cal && cal.score != null
      ? `Calibration: ${Math.round(cal.score * 100)}% of its acts/beliefs held — ${cal.verdict === 'overconfident' ? 'overconfident, promotion held' : 'well-calibrated'}`
      : null;
    return html`
      <div class="card" style="padding:1rem 1.25rem;margin-bottom:0.75rem;">
        <div style="display:flex;align-items:center;gap:0.75rem;flex-wrap:wrap;">
          <div style="flex:1;min-width:180px;">
            <div style="font-weight:600;color:var(--text-primary);text-transform:capitalize;">${p.category}</div>
            <div style="font-size:0.8rem;color:var(--accent);">${MODE_LABELS[p.mode as AutopilotMode]}</div>
            <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">
              Shadow record: ${agreement} · ${p.clean_cycles}/${PROMOTION_THRESHOLD} clean cycles banked
              ${calLine ? html`<br/><span style="color:${cal!.verdict === 'overconfident' ? '#ffb347' : 'var(--text-muted)'};">${calLine}</span>` : ''}
              ${p.last_demotion_reason ? html`<br/>Last pulled back: ${p.last_demotion_reason}` : ''}
            </div>
          </div>
          <div style="display:flex;gap:0.4rem;flex-shrink:0;">
            ${(() => {
              const nextMode = p.mode === 'shadow' ? 'suggest' : 'act';
              const cap = platformCap(p.category);
              // The platform ceiling can't be exceeded — show it instead of an
              // ungrantable button (autonomy = min(setting, cap, trust)).
              if (isCappedBelow(nextMode as never, p.category)) {
                return html`<span style="font-size:0.72rem;color:#ffb347;align-self:center;" title="Operator-set ceiling for this capability">Platform cap: ${cap}</span>`;
              }
              const grantingAct = nextMode === 'act';
              return p.mode !== 'act' ? html`
              <form method="POST" action="/autopilot/policy"
                ${grantingAct ? html`onsubmit="return confirm(${JSON.stringify(DISCLOSURE_TEXT + '\n\nGrant this?')})"` : ''}>
                <input type="hidden" name="category" value="${p.category}" />
                <input type="hidden" name="mode" value="${nextMode}" />
                <button type="submit" class="btn btn-secondary" style="font-size:0.78rem;padding:0.3rem 0.75rem;">
                  Grant ${nextMode}
                </button>
              </form>` : '';
            })()}
            ${p.mode !== 'shadow' ? html`
            <form method="POST" action="/autopilot/policy">
              <input type="hidden" name="category" value="${p.category}" />
              <input type="hidden" name="mode" value="shadow" />
              <button type="submit" class="btn btn-ghost" style="font-size:0.78rem;padding:0.3rem 0.75rem;">Pause</button>
            </form>` : ''}
          </div>
        </div>
      </div>`;
  });

  const content = html`
    <div style="display:flex;align-items:baseline;justify-content:space-between;margin-bottom:0.5rem;flex-wrap:wrap;gap:0.5rem;">
      <h1 style="margin:0;">Controls</h1>
      <form method="POST" action="/autopilot/panic"
        onsubmit="return confirm('Stop the autopilot everywhere? All categories return to Watching only. Trust records are kept.')">
        <button type="submit" class="btn" style="font-size:0.8rem;background:#c0392b;color:#fff;border:none;padding:0.45rem 1rem;border-radius:6px;">■ Stop the autopilot</button>
      </form>
    </div>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">
      ${explain('controls', getFluency(founder)) || 'Autonomy is earned, never assumed. Watch → suggest → act (your explicit grant); every act undoable and logged; an undo pulls the category back.'}
    </p>
    ${policies.length === 0 ? html`
      <div class="card" style="padding:1.25rem;color:var(--text-muted);">No decision categories yet — the ladder starts with your first decision.</div>
    ` : rows}
    <p style="font-size:0.72rem;color:var(--text-muted);margin-top:1rem;">
      Ladder: Watching only → Suggests (earned at ${PROMOTION_THRESHOLD} clean cycles, quality-held) → Acts (your explicit grant, gate-≤1 only, ${12}h grace, 24h undo).
    </p>`;
  return c.html(dashboardLayout(ctx, content));
});

letterRoutes.post('/autopilot/policy', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'autopilot', 'Controls', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  const body = await c.req.parseBody();
  const category = (body.category as string)?.trim();
  const mode = (body.mode as string)?.trim() as AutopilotMode;
  if (category && ['shadow', 'suggest', 'act'].includes(mode)) {
    await setPolicy(ctx.productId, category, mode, founder.id as string);
  }
  return c.redirect('/autopilot');
});

letterRoutes.post('/autopilot/panic', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'autopilot', 'Controls', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  await panicStop(ctx.productId, founder.id as string);
  return c.redirect('/autopilot');
});

// ─── Talk to the company (Trust Plane phase 3) ────────────────────────────────
// Conversation IS capture: decisions and beliefs stated here land in the ledger
// with their premises monitored. The reply cites the trust record.

letterRoutes.get('/talk', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'talk', 'Talk to the company', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');
  const content = html`
    <h1 style="margin-bottom:0.25rem;">Talk to the company</h1>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.25rem;">
      ${explain('talk', getFluency(founder)) || 'State a decision or a belief and it lands in the ledger, monitored. Ask anything — answers come from your real ledgers and carry the trust record.'}
    </p>
    <div id="talk-log" style="min-height:180px;margin-bottom:1rem;"></div>
    <div style="display:flex;gap:0.5rem;">
      <input id="talk-input" type="text" placeholder="State a decision or ask anything…"
        style="flex:1;padding:0.6rem 0.85rem;background:rgba(255,255,255,0.06);border:1px solid rgba(255,255,255,0.12);border-radius:6px;color:var(--text-primary);font-size:0.9rem;" />
      <button class="btn btn-primary" onclick="sendTalk()" style="font-size:0.85rem;">Send</button>
    </div>
    <script>
      let talkThread = null;
      function addMsg(role, text) {
        const log = document.getElementById('talk-log');
        const div = document.createElement('div');
        div.style.cssText = 'padding:0.6rem 0.9rem;margin-bottom:0.5rem;border-radius:8px;font-size:0.88rem;line-height:1.5;' +
          (role === 'you' ? 'background:rgba(78,204,163,0.08);border:1px solid rgba(78,204,163,0.2);' : 'background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);');
        div.textContent = (role === 'you' ? 'You: ' : 'Foundry: ') + text;
        log.appendChild(div);
      }
      async function sendTalk() {
        const input = document.getElementById('talk-input');
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        addMsg('you', text);
        try {
          const res = await fetch('/talk/message', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ text, thread_id: talkThread }),
          });
          const data = await res.json();
          if (data.error) { addMsg('foundry', 'Error: ' + data.error); return; }
          talkThread = data.threadId;
          addMsg('foundry', data.reply + (data.captured ? ' 📒' : ''));
        } catch { addMsg('foundry', 'The company is unreachable right now.'); }
      }
      document.getElementById('talk-input').addEventListener('keydown', (e) => { if (e.key === 'Enter') sendTalk(); });
    </script>
    ${adviceStrip(getFluency(founder))}`;
  return c.html(dashboardLayout(ctx, content));
});

letterRoutes.post('/talk/message', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'talk', 'Talk to the company', undefined, c);
  if (!ctx.productId) return c.json({ error: 'No product' }, 400);
  const body = await c.req.json().catch(() => null) as { text?: string; thread_id?: string } | null;
  if (!body) return c.json({ error: 'Invalid JSON body' }, 400);
  const text = body.text?.trim();
  if (!text || text.length > 2000) return c.json({ error: 'Say something (under 2000 chars)' }, 400);
  try {
    const { handleUtterance } = await import('../../services/chat/institution.js');
    const turn = await handleUtterance(ctx.productId, founder.id as string, text, body.thread_id);
    return c.json(turn);
  } catch {
    return c.json({ error: 'The company could not respond (AI unavailable)' }, 503);
  }
});
