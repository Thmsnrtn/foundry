// =============================================================================
// FOUNDRY — The Letter (Ascent B7 / Attention Law)
// One page. What ran without you, the one thing that needs you, what was
// learned, how trust moved. When it's quiet, it says so and lets you leave.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
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
import { requireCompanyCapability } from '../../middleware/rbac.js';

export const letterRoutes = new Hono<AuthEnv>();

// Connections (Hands Law) rides the autopilot module — Controls and
// Connections are one door (Attention Law: mounts may only shrink).
letterRoutes.route('/', connectionRoutes);

/** The three counts in one sentence of the founder's language. Written out
 *  rather than templated from a list so each number arrives with the word that
 *  says what it means — "2 unconfirmed" alone reads as a failure. */
const developmentRecordLine = (
  record: { confirmed: number; failed: number; unconfirmed: number },
): string => {
  const parts: string[] = [];
  if (record.confirmed) parts.push(`${record.confirmed} an independent check confirmed`);
  if (record.failed) parts.push(`${record.failed} where the check then failed`);
  if (record.unconfirmed) parts.push(`${record.unconfirmed} nothing has confirmed either way`);
  const total = record.confirmed + record.failed + record.unconfirmed;
  return `Across everything I have changed and recorded — ${total} in all — ${parts.join(', ')}.`;
};

const section = (label: string, items: string[]) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">${label}</div>
    ${items.map((i) => html`<div style="font-size:0.9rem;color:var(--text-primary);padding:0.35rem 0;border-top:1px solid rgba(255,255,255,0.05);">${i}</div>`)}
  </div>`;

// Why a thing needs the founder, in one line of their language. Coming back
// after a week, "this needs you" is not enough: "I'm still watching",
// "you turned my permission off", "it ran out", and "I did something and nobody
// knows if it worked" are four different situations with four different next
// actions, and only one of them is waiting on Foundry.
const NEEDS_YOU_REASON: Record<string, string> = {
  watching: "I'm still watching this — I haven't asked to help yet.",
  permission_withdrawn: "You turned off my permission here. I won't do anything until you turn it back on.",
  permission_expired: "My permission here ran out. I won't do anything until you renew it.",
  outcome_unresolved: "I did something here and nobody knows yet whether it actually worked.",
};

const responsibilitySection = (
  label: string,
  items: Array<{ responsibilityId: string; title: string; state: string; evidenceRef: string | null;
    needsYouBecause?: string }>,
  productId: string,
  disposition: 'active' | 'deliberately_not_done',
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">${label}</div>
    ${items.map((item) => html`
      <div style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${item.title} — ${item.state}</div>
        ${item.needsYouBecause && NEEDS_YOU_REASON[item.needsYouBecause] ? html`
          <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">${NEEDS_YOU_REASON[item.needsYouBecause]}</div>` : ''}
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
/** How Foundry's judgments about this company have held up. Three counts, never
 *  a rate: two borne out of three is not "67% accurate", and a percentage
 *  invites a confidence the evidence cannot carry. A company Foundry has never
 *  been observed on is told nothing, rather than shown a vacuous record. */
const judgmentRecordLine = (
  record: import('../../services/institution/institutional-judgment-disposition.js').JudgmentRecord,
): string => {
  const parts: string[] = [];
  if (record.borneOut) parts.push(`${record.borneOut} that what happened since bore out`);
  if (record.contradicted) parts.push(`${record.contradicted} that it contradicted`);
  if (record.unresolved) parts.push(`${record.unresolved} nothing has settled either way`);
  const total = record.borneOut + record.contradicted + record.unresolved;
  return `Of the ${total} judgment${total === 1 ? '' : 's'} I have made about your company and`
    + ` since checked — ${parts.join(', ')}.`;
};

const judgmentSection = (
  items: Array<import('../../services/institution/institutional-judgment-disposition.js').MaterialJudgment>,
  record: import('../../services/institution/institutional-judgment-disposition.js').JudgmentRecord | null,
) => items.length === 0 && record === null ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">${items.length ? 'Judgments that need your direction' : 'How my judgment has held up'}</div>
    ${record ? html`
      <div style="font-size:0.82rem;color:var(--text-muted);padding-bottom:0.5rem;">${judgmentRecordLine(record)}</div>` : ''}
    ${items.map((j) => html`
      <div style="padding:0.6rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${j.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">${j.description}</div>
        ${j.limit ? html`
          <div style="font-size:0.78rem;color:var(--text-primary);margin-top:0.35rem;">You have ${j.limit.available} ${j.limit.resource.replaceAll('_', ' ')}${j.limit.available === 1 ? '' : 's'}; these need ${j.limit.requested}.</div>` : ''}
        ${j.consequences.length ? html`
          <div style="font-size:0.75rem;color:var(--text-muted);margin-top:0.25rem;">
            ${j.consequences.map((c) => html`<div>If ${c.title} gives way: ${c.consequence}</div>`)}
          </div>` : ''}
        ${j.otherConstraints.length ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">Also weighed: ${j.otherConstraints.join('; ')}</div>` : ''}
        <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.25rem;">${
  j.economicOrdering === 'observed' ? 'I can order these on money, from figures I observed.'
    : j.economicOrdering === 'inferred_estimate' ? 'I can order these on money, but from an estimate rather than observed figures.'
      : j.economicOrdering === 'conflicting' ? 'I cannot tell you which costs more — the figures I have disagree.'
        : 'I cannot tell you which costs more. Nothing I have establishes it.'}</div>
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

// One question, when Foundry genuinely cannot learn a material fact any other
// way. It says which responsibility it is about and why it is asking, so the
// founder can judge whether answering is worth their time — and it never
// implies that answering lets Foundry act.
const evidenceQuestionSection = (
  q: import('../../services/institution/founder-evidence.js').FounderEvidenceQuestion | null,
) => q === null ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">One thing I still need to know</div>
    <div style="font-size:0.78rem;color:var(--text-muted);">${q.because}.</div>
    <div style="font-size:0.95rem;color:var(--text-primary);margin-top:0.5rem;">${q.question}</div>
    <form method="POST" action="/letter/evidence/${q.requestId}/answer"
      style="display:flex;gap:0.4rem;margin-top:0.5rem;align-items:center;flex-wrap:wrap;">
      ${q.answerShape === 'resource_amount' ? html`
        <input name="resource" required maxlength="60" placeholder="Of what? (e.g. days of my time)"
          style="flex:1;min-width:180px;" />
        <input name="amount" required type="number" min="0" step="any" placeholder="How much per week?"
          style="width:150px;" />` : ''}
      <input name="statement" required maxlength="1000" placeholder="In your own words"
        style="flex:1;min-width:220px;" />
      <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Tell me</button>
    </form>
    <form method="POST" action="/letter/evidence/${q.requestId}/defer" style="margin-top:0.35rem;">
      <button type="submit" class="btn btn-ghost" style="font-size:0.7rem;padding:0.2rem 0.45rem;">Skip this</button>
    </form>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">Answering tells me how your company works. It does not let me do anything on your behalf — that still needs a separate permission from you. If you skip, I'll leave it as something I don't know.</div>
  </div>`;

// Somebody who asked not to be contacted.
//
// The person an effect reaches is not represented by the founder's authority,
// and until now they had no subject position at all: the suppression list had
// no way in and the governed path never read it. This is the way in. Foundry
// does not infer it from a customer's reply — reading intent out of prose is
// how a person's wish becomes a model's guess — so the company states it.
const doNotContactSection = (
  items: Array<{ email: string; reason: string; recordedAt: string }>,
  labels: Record<string, string>,
) => html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Who I will not contact</div>
    ${items.length === 0 ? html`
      <div style="font-size:0.78rem;color:var(--text-muted);">Nobody yet. If someone tells you to stop, tell me and I will not write to them again — whatever else you have given me permission to do.</div>`
    : items.map((item) => html`
      <div style="padding:0.4rem 0;border-top:1px solid rgba(255,255,255,0.05);font-size:0.82rem;color:var(--text-primary);">
        ${item.email}
        <span style="color:var(--text-muted);font-size:0.75rem;"> — ${labels[item.reason] ?? item.reason}, since ${item.recordedAt.slice(0, 10)}</span>
      </div>`)}
    <form method="POST" action="/letter/do-not-contact"
      style="display:flex;gap:0.4rem;margin-top:0.6rem;align-items:center;flex-wrap:wrap;">
      <input name="email" required type="email" maxlength="320" placeholder="Their email address"
        style="flex:1;min-width:220px;" />
      <select name="reason" style="font-size:0.78rem;">
        <option value="they_asked">they asked me to stop</option>
        <option value="founder">I do not want them contacted</option>
        <option value="bounced">mail to them bounces</option>
      </select>
      <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Add</button>
    </form>
  </div>`;

// Questions the founder set aside.
//
// Skipping is a decision about being asked, not a decision to withhold the fact
// for good — but "Foundry does not ask again" had become "the founder can never
// tell it". The answer route resolved the request as `status='open'`, the
// database guard required the same, and nothing listed what had been skipped.
// One hurried click kept a responsibility out of Shadowing for good and Foundry
// never mentioned it again, by design.
//
// This does not re-ask. It is a quiet list, below the one live question, that
// the founder reaches by choosing to. Nothing here interrupts, and there is no
// second "skip" — it has already been skipped.
const setAsideSection = (
  items: Array<{ requestId: string; question: string; responsibilityTitle: string;
    answerShape: 'text' | 'resource_amount' }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Set aside</div>
    <div style="font-size:0.72rem;color:var(--text-muted);margin-bottom:0.5rem;">You skipped these. I have not asked again and I will not. They are here in case you want to answer one now.</div>
    ${items.map((item) => html`
      <div style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.72rem;color:var(--text-muted);">About ${item.responsibilityTitle}</div>
        <div style="font-size:0.88rem;color:var(--text-primary);margin-top:0.15rem;">${item.question}</div>
        <form method="POST" action="/letter/evidence/${item.requestId}/answer"
          style="display:flex;gap:0.4rem;margin-top:0.4rem;align-items:center;flex-wrap:wrap;">
          ${item.answerShape === 'resource_amount' ? html`
            <input name="resource" required maxlength="60" placeholder="Of what? (e.g. days of my time)"
              style="flex:1;min-width:180px;" />
            <input name="amount" required type="number" min="0" step="any" placeholder="How much per week?"
              style="width:150px;" />` : ''}
          <input name="statement" required maxlength="1000" placeholder="In your own words"
            style="flex:1;min-width:220px;" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Tell me now</button>
        </form>
      </div>`)}
  </div>`;

// The founder tells Foundry something the company has to handle. The kind is
// chosen explicitly rather than guessed from the words, so an ambiguous
// sentence never becomes company ontology by accident.
const reportObligationSection = (options: Array<[string, string]>) => html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Tell me something the company has to handle</div>
    <form method="POST" action="/letter/company/report"
      style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
      <select name="obligation_kind" style="font-size:0.78rem;">
        ${options.map(([value, label]) => html`<option value="${value}">${label}</option>`)}
      </select>
      <input name="what" required maxlength="200" placeholder="What is it, in your words?"
        style="flex:1;min-width:220px;" />
      <label style="font-size:0.72rem;color:var(--text-muted);display:flex;align-items:center;gap:0.3rem;">
        by
        <input name="due_at" type="date" style="font-size:0.78rem;" />
      </label>
      <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Add it</button>
    </form>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">I'll start keeping track of it. I won't do anything about it — I'd need to understand it first, and then you'd have to give me permission separately. A date is optional; without one I can't tell you when it's late.</div>
  </div>`;

// The one question only the founder can answer.
//
// Shown for effects that actually dispatched and that nobody has reported on.
// Asking about something already answered spends the one resource the
// institution exists to conserve.
const outcomeSection = (
  items: Array<{ effectId: string; title: string; preview: string }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Did that work?</div>
    ${items.map((item) => html`
      <form method="POST" action="/letter/effects/${item.effectId}/outcome"
        style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${item.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">${item.preview}</div>
        <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;margin-top:0.45rem;">
          <select name="verdict" style="font-size:0.78rem;">
            <option value="achieved">Yes — it did what it was for</option>
            <option value="failed">No — it did not</option>
          </select>
          <input name="detail" maxlength="300" placeholder="Anything worth remembering?" style="flex:1;min-width:180px;" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Tell me</button>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">I can see that it was sent. I can't see whether it worked — only you or something outside can tell me that.</div>
      </form>`)}
  </div>`;

// Telling someone something, about a responsibility Foundry is already helping
// with. The founder writes the words; Foundry carries them under the same
// governed boundary a support reply crosses.
//
// Only offered for responsibilities that are Assisting — anywhere else there is
// no authority to carry anything, and offering the form would imply otherwise.
// Customers who wrote in, and what Foundry may do about each.
//
// Three write routes existed — author a reply, plan it, send it — and nothing
// rendered the messages, so a founder could never obtain a message id to post
// to. The whole support vertical was reachable only from a test.
//
// The customer's own words are interpolated through `html`, which escapes
// them. That is the surface half of the promise the intake makes: a message
// containing a script tag is a message containing a script tag, in the
// database and on the page.
const customerMessageSection = (
  items: Array<{
    messageId: string; responsibilityTitle: string; contactEmail: string;
    subject: string | null; body: string; state: string;
    actionId: string | null; proposal: string | null; canSend: boolean;
  }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Someone wrote in</div>
    ${items.map((item) => html`
      <div style="padding:0.6rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.78rem;color:var(--text-muted);">
          ${item.contactEmail} — about ${item.responsibilityTitle}
        </div>
        ${item.subject ? html`<div style="font-size:0.88rem;color:var(--text-primary);margin-top:0.2rem;">${item.subject}</div>` : ''}
        <div style="font-size:0.85rem;color:var(--text-primary);margin-top:0.3rem;white-space:pre-wrap;">${item.body}</div>

        ${item.state === 'sent' ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">Your reply was sent. Whether it settled anything is a separate question, and still open.</div>
        ` : item.state === 'failed' ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">The send did not complete. Nothing was silently retried.</div>
        ` : item.state === 'refused' ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">I did not send this. Permission for this responsibility was withdrawn before it went out, so I closed it rather than carrying it anyway. Give permission again and write it once more if you still want it sent.</div>
        ` : item.state === 'sending' ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.4rem;">This one is mid-send and I do not yet know how it ended. I will not retry it behind your back.</div>
        ` : item.state === 'planned' ? html`
          <div style="font-size:0.78rem;color:var(--text-primary);margin-top:0.4rem;">Ready to send, in your words:</div>
          <div style="font-size:0.82rem;color:var(--text-muted);white-space:pre-wrap;">${item.proposal}</div>
          <form method="POST" action="/letter/replies/${item.actionId}/send" style="margin-top:0.35rem;">
            <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Send it</button>
          </form>
        ` : item.state === 'proposed' ? html`
          <div style="font-size:0.78rem;color:var(--text-primary);margin-top:0.4rem;">You wrote:</div>
          <div style="font-size:0.82rem;color:var(--text-muted);white-space:pre-wrap;">${item.proposal}</div>
          <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">Saved, not sent. ${item.canSend ? 'Ask me to carry it when you are ready.' : 'I cannot carry this yet — you have not given me permission for this responsibility.'}</div>
        ` : html`
          <form method="POST" action="/letter/messages/${item.messageId}/reply" style="margin-top:0.4rem;">
            <input name="reply" required maxlength="8000" placeholder="What would you like to say back? I send exactly this."
              style="width:100%;" />
            <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.35rem;">
              <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Save my reply</button>
              <span style="font-size:0.7rem;color:var(--text-muted);">I write nothing myself, and saving sends nothing.</span>
            </div>
          </form>`}
      </div>`)}
  </div>`;

// How customers reach you about a responsibility, and the URL that carries it.
//
// The registration route existed with no form pointing at it, and it discarded
// the intake key on redirect — so even a founder who found the endpoint could
// never obtain the URL their helpdesk needs. Registering a channel is the only
// way a customer message can ever arrive, which made the whole support vertical
// unreachable in production while being fully exercised in tests.
//
// The key is shown because it IS the credential: it establishes both tenant and
// channel, which is what lets a message be attributed without guessing from its
// text. Withdrawing one is immediate, and an unknown key and a withdrawn key
// are refused identically, so nobody learns which channels exist.
//
// THIS USED TO SAY "POINT YOUR HELPDESK OR MAILBOX AT THAT URL AND I WILL SEE
// WHAT PEOPLE SEND." A mailbox cannot POST JSON at all, and a helpdesk posts
// its OWN webhook shape, which this door's schema refuses as `fields_invalid`.
// The design record is explicit that "an adapter for a helpdesk, a mailbox, or
// a form is an ordinary caller" — and at the time no adapter existed, so the
// sentence described one that was never written. The founder would have found
// out by trying, and the refusal counter above would have told them afterwards:
// the system failing gracefully, not the system being honest.
//
// THERE IS ONE NOW, AND THE COPY NAMES IT RATHER THAN THE SHAPE ALONE. The
// Intercom adapter reads what customers wrote through the same door, so a
// founder who has connected Intercom ticks a box instead of building a bridge.
// What it can and cannot see is stated here in the same words the module states
// it in — seven days, first message, an email address, no replies — because a
// sense the founder misjudges the reach of is worse than one they know is
// narrow. The hand-POST paragraph stays: it is still the answer for every
// provider without an adapter, which is all of them but one.
const supportChannelSection = (
  candidates: Array<{ responsibilityId: string; title: string }>,
  existing: Array<{ id: string; label: string; intakeKey: string; responsibilityTitle: string;
    revoked: boolean; refusalCount: number; lastRefusalReason: string | null;
    fedBy: string | null }>,
  refusalLabels: Record<string, string>,
  appUrl: string,
) => candidates.length === 0 && existing.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">How customers reach you</div>
    ${existing.filter((c) => !c.revoked).map((c) => html`
      <div style="padding:0.4rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.84rem;color:var(--text-primary);">${c.label}
          <span style="color:var(--text-muted);font-size:0.72rem;"> — ${c.responsibilityTitle}</span>
        </div>
        <input type="text" readonly value="${appUrl}/ingest/customer-message/${c.intakeKey}"
          style="width:100%;font-size:0.72rem;font-family:monospace;margin-top:0.25rem;cursor:pointer;"
          onclick="this.select()" />
        <form method="POST" action="/letter/channels/${c.id}/feed" style="margin-top:0.3rem;">
          <input type="hidden" name="provider" value="${c.fedBy ? '' : 'intercom'}" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.7rem;padding:0.2rem 0.45rem;">
            ${c.fedBy
              ? `Stop reading from ${c.fedBy}`
              : 'Read what people write in Intercom'}
          </button>
          ${c.fedBy ? html`<span style="font-size:0.7rem;color:var(--text-muted);margin-left:0.4rem;">
            I read this from ${c.fedBy}.</span>` : ''}
        </form>
        ${c.refusalCount > 0 ? html`
        <div style="font-size:0.74rem;color:#ffb347;margin-top:0.25rem;">
          I have turned away ${String(c.refusalCount)} ${c.refusalCount === 1 ? 'message' : 'messages'} on this since one last got through — ${refusalLabels[c.lastRefusalReason ?? ''] ?? 'I could not use what was sent'}. Somebody wrote and I did not keep it.
        </div>` : ''}
        <form method="POST" action="/letter/channels/${c.id}/revoke" style="margin-top:0.25rem;">
          <button type="submit" class="btn btn-ghost" style="font-size:0.7rem;padding:0.2rem 0.45rem;">Stop using this</button>
        </form>
      </div>`)}
    ${candidates.map((item) => html`
      <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/channel"
        style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem;padding-top:0.4rem;border-top:1px solid rgba(255,255,255,0.05);">
        <span style="font-size:0.8rem;color:var(--text-muted);flex-basis:100%;">${item.title}</span>
        <input name="label" required maxlength="120" placeholder="What is it? (e.g. the quotes@ inbox)"
          style="flex:1;min-width:220px;" />
        <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Add it</button>
      </form>`)}
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.4rem;">
      <strong>If you have connected Intercom</strong>, tick it below and I will read what
      people write there — the conversations from the last seven days, their first
      message, from anyone who left an email address. I will not see replies, or
      anything your team wrote back.
      <br /><br />
      Otherwise: anything that can POST JSON to that URL can hand me a message.
      <strong>A mailbox cannot do that on its own</strong> — it needs something in
      between, and a helpdesk needs its webhook set to this shape rather than its own:
      <code style="display:block;margin:0.35rem 0;font-size:0.68rem;white-space:pre;overflow-x:auto;">{"external_message_id": "...", "contact_email": "...", "body": "..."}</code>
      <code style="font-size:0.68rem;">subject</code>, <code style="font-size:0.68rem;">conversation_ref</code>
      and <code style="font-size:0.68rem;">source_observed_at</code> are optional. Anything
      else is turned away and I will tell you above that it happened.
      Seeing a message lets me show it to you — nothing more.
    </div>
  </div>`;

// Two people looked at the same effect and said different things.
//
// Reconciliation preserves that deliberately: two witnesses who disagree are
// never resolved toward the convenient answer. But the founder was told only
// "business evidence conflicts; owner judgment may be needed" — asking a person
// to exercise judgment while withholding the thing they would exercise it on.
//
// This shows who said what, and nothing else. Foundry does not rank the
// reporters, suggest which to believe, or offer to settle it: it has no way of
// knowing, and pretending otherwise is the whole failure mode the outcome layer
// exists to avoid.
const disputedSection = (
  items: Array<{
    effectId: string; title: string; preview: string;
    reports: Array<{ reporter: string; verdict: string; detail: string | null }>;
  }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">People disagree about this</div>
    ${items.map((item) => html`
      <div style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${item.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">${item.preview}</div>
        ${item.reports.map((r) => html`
          <div style="font-size:0.8rem;color:var(--text-primary);margin-top:0.3rem;">
            <span style="color:var(--text-muted);">${r.reporter}</span>
            — ${r.verdict === 'achieved' ? 'it worked' : 'it did not work'}${r.detail ? html`: ${r.detail}` : ''}
          </div>`)}
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.35rem;">I have kept both. I have no way to tell which is right, so I am not going to pick one.</div>
      </div>`)}
  </div>`;

// CAN I LEAVE, AND FOR HOW LONG.
//
// The question `EXPERIENCE.md` names as the proof target, asked forwards. The
// seven-day summary answers what happened; this answers what is coming, and it
// is a FACT rather than a forecast: the soonest date the COMPANY stated, on a
// responsibility still active. Foundry does not estimate how long it can cope.
//
// THE CAVEATS ARE RENDERED IN THE SAME SENTENCE AS THE NUMBER, not beneath it,
// because a founder who reads "eleven days" and stops reading has been misled by
// a true number. Undated things that need them, things already late, and passes
// that have stopped are each capable of making the interval meaningless, and the
// last is the one that makes quiet untrustworthy rather than merely incomplete.
//
// No number at all is not permission to go. It means nothing carries a date —
// which is a fact about what the company has told Foundry, not about how safe
// the week is.
const stepAwaySection = (h: {
  daysUntilSoonestDue: number | null; soonestDueAt: string | null;
  soonestDueTitle: string | null; alreadyOverdue: number;
  needingYouWithoutDate: number; loopsStopped: number;
}) => {
  const caveats: string[] = [];
  if (h.alreadyOverdue > 0) {
    caveats.push(`${h.alreadyOverdue} ${h.alreadyOverdue === 1 ? 'thing is' : 'things are'} already past the date you gave`);
  }
  if (h.needingYouWithoutDate > 0) {
    caveats.push(`${h.needingYouWithoutDate} ${h.needingYouWithoutDate === 1 ? 'thing needs' : 'things need'} you and carry no date, so this does not speak for ${h.needingYouWithoutDate === 1 ? 'it' : 'them'}`);
  }
  if (h.loopsStopped > 0) {
    caveats.push('some of what would notice a problem is not running, so this quiet may be mine rather than the company\'s');
  }
  const headline = h.daysUntilSoonestDue === null
    ? 'Nothing you have given a date to is coming up.'
    : h.daysUntilSoonestDue === 0
      ? `${h.soonestDueTitle} is due today.`
      : `${h.daysUntilSoonestDue} ${h.daysUntilSoonestDue === 1 ? 'day' : 'days'} until ${h.soonestDueTitle} is due.`;
  if (h.daysUntilSoonestDue === null && caveats.length === 0) return '';
  return html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.4rem;">If you went away</div>
    <div style="font-size:0.95rem;color:var(--text-primary);">${headline}</div>
    ${caveats.length > 0 ? html`
      <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.35rem;">
        ${caveats.join('; ')}.
      </div>` : ''}
    ${h.daysUntilSoonestDue === null && caveats.length > 0 ? html`
      <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.3rem;">
        No date is not the same as nothing to do.
      </div>` : ''}
  </div>`;
};

// PART OF ME HAS STOPPED RUNNING, AND THIS PAGE IS THEREFORE OUT OF DATE.
//
// "Nothing happened" and "nothing ran" are different facts, and the letter said
// the first for both. Every scheduled job was wrapped in a try/catch that
// logged and moved on, so a week in which the reconciliation pass threw on
// every run looked exactly like a calm week: no new outcomes, no new
// judgments, nothing visibly wrong.
//
// This sits above everything rather than beneath it. A founder reading the rest
// of the page needs to know first that part of what fills it has stopped —
// telling them afterwards is telling them once they have already decided.
//
// It does not show the error. What went wrong is Foundry's problem, and the
// class name is kept for whoever operates it; what the founder needs is which
// of their things is not being kept current, and since when.
const loopsStoppedSection = (
  items: Array<{ label: string; consecutiveFailures: number; stoppedRunning: boolean;
    lastSuccessAt: string | null }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid #ffb34755;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffb347;margin-bottom:0.6rem;">Part of me has stopped</div>
    <div style="font-size:0.82rem;color:var(--text-primary);">Some of what I do runs on a schedule. Some of it is failing, so what you read below may be out of date — not because nothing happened, but because I have not been able to look.</div>
    ${items.map((item) => html`
      <div style="padding:0.45rem 0;border-top:1px solid rgba(255,255,255,0.05);font-size:0.8rem;color:var(--text-muted);">
        ${item.label} — ${item.stoppedRunning
    ? 'has not run when it should have'
    : `failed ${String(item.consecutiveFailures)} ${item.consecutiveFailures === 1 ? 'time' : 'times'} in a row`}${item.lastSuccessAt ? `, last worked ${item.lastSuccessAt.slice(0, 10)}` : ', and has never yet worked'}.
      </div>`)}
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.4rem;">This is mine to fix, not yours. It is here because you should not have to guess whether the rest of this page is current.</div>
  </div>`;

// Notices the founder wrote and did not send.
//
// Authoring and carrying are deliberately separate — writing something down is
// not permission to send it. But the form offered both and then rendered
// neither afterwards, so a notice saved without ticking the box simply
// vanished: the founder wrote something and had no way to find it, finish it,
// or send it later. `getResponsibilityNotices` had no route caller at all.
const uncarriedNoticeSection = (
  items: Array<{ id: string; recipient: string; subject: string; body: string;
    responsibilityTitle: string; canCarry: boolean }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Written, not sent</div>
    ${items.map((item) => html`
      <div style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.78rem;color:var(--text-muted);">To ${item.recipient} — about ${item.responsibilityTitle}</div>
        <div style="font-size:0.88rem;color:var(--text-primary);margin-top:0.15rem;">${item.subject}</div>
        <div style="font-size:0.82rem;color:var(--text-muted);white-space:pre-wrap;margin-top:0.2rem;">${item.body}</div>
        ${item.canCarry ? html`
        <form method="POST" action="/letter/notices/${item.id}/carry" style="margin-top:0.35rem;">
          <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Send it for me</button>
        </form>` : html`
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">I cannot carry this — you have not given me permission for this responsibility.</div>`}
      </div>`)}
  </div>`;

const noticeSection = (
  items: Array<{ responsibilityId: string; title: string; state: string }>,
) => {
  const assisting = items.filter((i) => i.state === 'assisting');
  return assisting.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Tell someone something</div>
    ${assisting.map((item) => html`
      <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/notice"
        style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);margin-bottom:0.35rem;">${item.title}</div>
        <div style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
          <input name="recipient" required maxlength="320" placeholder="Who? (email)" style="width:200px;" />
          <input name="subject" required maxlength="200" placeholder="About what?" style="flex:1;min-width:180px;" />
        </div>
        <input name="message" required maxlength="8000" placeholder="What do you want to say? I'll send exactly this."
          style="width:100%;margin-top:0.4rem;" />
        <div style="display:flex;gap:0.5rem;align-items:center;margin-top:0.4rem;">
          <label style="font-size:0.72rem;color:var(--text-muted);">
            <input type="checkbox" name="carry" value="yes" /> Send it for me
          </label>
          <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Save</button>
        </div>
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">I send your words exactly as written — I don't write anything myself. If you don't tick the box, I'll just keep it.</div>
      </form>`)}
  </div>`;
};

// What the owner would expect one of the company's own numbers to do.
//
// THE ROUTE EXISTED AND NO PAGE POINTED AT IT. `POST .../watch` has been live,
// `getShadowableResponsibilities` was written to populate exactly this form, and
// nothing rendered one — so the founder-facing path from Understood to
// Shadowing existed for development checks and not for the company's own
// numbers. Production reachable is not human reachable, and a rung of the
// ladder nobody can climb is not a rung.
//
// Offered only where it can be honest: the responsibility is Understood, not
// already being watched, and the channel has ALREADY produced a real reading.
// `getShadowableResponsibilities` enforces all three, which is why this renders
// whatever it returns and decides nothing itself.
// WHAT I CANNOT CARRY, AND WHY YOU ARE STILL WAITING.
//
// A founder can report "money owed to us that needs collecting", be asked to
// explain its failure conditions and its financial consequence, watch it reach
// Shadowing — and then wait forever for an offer that cannot come, because
// nothing Foundry may lawfully do would carry it. `getAssistingCandidates`
// filters those out and says nothing, so the silence reads as "not yet" when
// the truth is "there is no path".
//
// Those are different facts about Foundry, and the second is the one that
// decides whether the founder keeps waiting or goes and does it themselves. It
// is the same principle that makes an unobserved metric say so rather than
// report zero: an absence the founder is entitled to know about.
//
// No apology and no promise. Foundry does not know when or whether a hand for
// this will exist, and saying "soon" would be inventing a plan.
const cannotCarrySection = (
  items: Array<{ responsibilityId: string; title: string; capability: string; state: string }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">What I cannot carry</div>
    <div style="font-size:0.82rem;color:var(--text-primary);margin-bottom:0.6rem;">
      I am watching ${items.length === 1 ? 'this' : 'these'} and I understand ${items.length === 1 ? 'it' : 'them'},
      but there is nothing I can lawfully do that would carry
      ${items.length === 1 ? 'it' : 'them'} — so I will not be asking you for
      permission, and you should not wait for me to.
    </div>
    ${items.map((item) => html`
      <div style="padding:0.4rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.88rem;color:var(--text-primary);">${item.title}</div>
        <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.15rem;">
          I keep watching it and I will tell you what I see. Acting on it stays
          yours until a way for me to do it exists, and I cannot tell you when
          that will be.
        </div>
      </div>`)}
  </div>`;

// I UNDERSTAND THESE AND I CANNOT SEE ANY OF THEM.
//
// The offer below renders only when the company has an observation channel, and
// a channel exists only once a reading has actually arrived. So a company that
// has connected nothing and posted nothing gets no offer — correctly — and no
// reason for its absence. The founder reported an obligation, answered
// Foundry's questions about it, watched it reach Understood, and then nothing.
//
// That silence is the first rung of the ladder, and every new company starts
// below it. "Nothing is happening" and "I cannot see" are different facts; the
// founder can act on the second and can do nothing at all with the first.
//
// The remedy is named because it is theirs to take: connect something, or post
// a number to the ingest URL on Settings. Foundry does not offer to guess a
// number in the meantime.
const cannotWatchSection = (items: Array<{ responsibilityId: string; title: string }>) =>
  items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">What I cannot see yet</div>
    <div style="font-size:0.82rem;color:var(--text-primary);margin-bottom:0.5rem;">
      I understand ${items.length === 1 ? 'this' : 'these'}, and I have no way to
      watch ${items.length === 1 ? 'it' : 'them'}. Nothing has reported a number
      to me — not through an integration, and not through your ingest URL — so I
      have nothing to form an expectation against.
    </div>
    ${items.map((item) => html`
      <div style="padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);font-size:0.86rem;color:var(--text-primary);">${item.title}</div>`)}
    <div style="font-size:0.74rem;color:var(--text-muted);margin-top:0.5rem;">
      Connect a tool, or post a reading to the ingest URL on
      <a href="/settings" style="color:var(--text-muted);">Settings</a>, and I
      will ask you what you would expect to see. Until then I am recording what
      you tell me and nothing more — I am not going to guess a number.
    </div>
  </div>`;

const metricWatchSection = (
  items: Array<{ responsibilityId: string; title: string; channels: Array<{ field: string; label: string }> }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">What would you expect to see?</div>
    ${items.map((item) => html`
      <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/watch"
        style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
        <div style="font-size:0.9rem;color:var(--text-primary);width:100%;">${item.title}</div>
        <span style="font-size:0.78rem;color:var(--text-muted);">If this is being handled, I'd expect</span>
        <select name="field" style="font-size:0.78rem;">
          ${item.channels.map((ch) => html`<option value="${ch.field}">${ch.label}</option>`)}
        </select>
        <select name="direction" style="font-size:0.78rem;">
          <option value="fell">to go down</option>
          <option value="rose">to go up</option>
          <option value="held">to stay about the same</option>
        </select>
        <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Watch it</button>
      </form>`)}
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">I'll watch and tell you whether you were right. Watching doesn't let me change anything.</div>
  </div>`;

// Watches the founder ended by disconnecting the channel they ran on.
//
// Revoking a channel is honoured where it matters — no further reading for it
// is admitted — and everything that followed was silent. The expectation can
// never resolve, so the responsibility sits at Shadowing for good and nothing
// connected that to the button they pressed.
//
// This does not ask for the channel back. Foundry does not argue with a
// founder's decision; it says what stopped, which is the difference between
// honouring a choice and hiding what it cost.
const darkenedWatchSection = (
  items: Array<{ responsibilityId: string; title: string; channelLabel: string }>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">I have stopped watching</div>
    ${items.map((item) => html`
      <div style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${item.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">You disconnected ${item.channelLabel}, which is how I was watching this. I have stopped, and it will not go any further until you give me another way to see it.</div>
      </div>`)}
  </div>`;

// What the owner would expect a development check to report.
//
// The twin of the metric watch. Offered only for development responsibilities
// that are Understood, and only for checks that have ALREADY produced real
// results — watching a silent check would be a promise rather than proof.
const developmentWatchSection = (
  items: Array<{ responsibilityId: string; title: string }>,
  checks: string[],
) => items.length === 0 || checks.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">What would you expect to see?</div>
    ${items.map((item) => html`
      <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/watch-check"
        style="padding:0.55rem 0;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
        <div style="font-size:0.9rem;color:var(--text-primary);width:100%;">${item.title}</div>
        <span style="font-size:0.78rem;color:var(--text-muted);">If this is being handled, I'd expect</span>
        <select name="check" style="font-size:0.78rem;">
          ${checks.map((c) => html`<option value="${c}">${c.replaceAll('-', ' ')}</option>`)}
        </select>
        <select name="expected_result" style="font-size:0.78rem;">
          <option value="passed">to pass</option>
          <option value="failed">to fail</option>
        </select>
        <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Watch it</button>
      </form>`)}
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">I'll watch and tell you whether you were right. Watching doesn't let me change anything.</div>
  </div>`;

// What the company actually counts.
//
// Until a company tells Foundry what to listen for, the only readings it can
// admit are twelve SaaS metrics — so a boatyard or a dance school could be
// understood and then never watched. This asks for the founder's own words and
// a short key their tools can post under.
//
// Declaring something grants nothing. It says what may be observed, not what
// Foundry may do about it.
const observationChannelSection = (
  existing: Array<{ channelKey: string; label: string; unit: string | null; revoked: boolean }>,
) => html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Something you count</div>
    ${existing.filter((c) => !c.revoked).map((c) => html`
      <div style="font-size:0.82rem;color:var(--text-primary);padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);display:flex;gap:0.5rem;align-items:center;flex-wrap:wrap;">
        <span style="flex:1;min-width:200px;">${c.label}${c.unit ? html` <span style="color:var(--text-muted);">(${c.unit})</span>` : ''}
        <span style="color:var(--text-muted);font-size:0.72rem;"> — post as <code>${c.channelKey}</code></span></span>
        <!-- A DOOR OUT. The revoke function existed, exported, with no route:
             a founder could tell Foundry what to watch and had no way to tell
             it to stop, while the identical support-channel revoke had been
             there from the start. A withdrawal only ever lowers what Foundry
             may do, so it is never the half to leave unbuilt. -->
        <form method="POST" action="/letter/company/observation-channel/revoke" style="margin:0;">
          <input type="hidden" name="channel_key" value="${c.channelKey}" />
          <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Stop watching this</button>
        </form>
      </div>`)}
    <form method="POST" action="/letter/company/observation-channel"
      style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;margin-top:0.5rem;">
      <input name="label" required maxlength="80" placeholder="What do you count? (e.g. boats serviced this week)"
        style="flex:1;min-width:220px;" />
      <input name="unit" maxlength="24" placeholder="Of what? (optional)" style="width:130px;" />
      <input name="channel_key" required maxlength="40" placeholder="short_name_for_tools"
        style="width:170px;" />
      <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Track it</button>
    </form>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">Your tools can send me this number and I'll notice when it moves. Telling me what you count does not let me do anything about it.</div>
  </div>`;

// "Tell me something important." The founder-initiated half of the same
// elicitation path — the shapes offered are exactly the facts an institutional
// consumer is currently waiting on, never a list of fields that happen to
// exist. Choosing one and typing an answer shows the founder the exact sentence
// Foundry would remember, and nothing is remembered until they confirm it.
const tellMeSection = (
  opportunities: Array<import('../../services/institution/founder-evidence.js').FactOpportunity
    & { question: string; answerShape: 'text' | 'resource_amount' }>,
) => opportunities.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Tell me something important</div>
    <form method="POST" action="/letter/facts/preview"
      style="display:flex;gap:0.4rem;align-items:center;flex-wrap:wrap;">
      <select name="opportunity" style="font-size:0.78rem;max-width:100%;">
        ${opportunities.map((o, i) => html`<option value="${i}">${o.question}</option>`)}
      </select>
      <input name="resource" maxlength="60" placeholder="Of what? (only if I asked)"
        style="flex:1;min-width:150px;" />
      <input name="amount" type="number" min="0" step="any" placeholder="How much?"
        style="width:120px;" />
      <input name="statement" required maxlength="1000" placeholder="In your own words"
        style="flex:1;min-width:200px;" />
      <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Show me what you'd remember</button>
    </form>
    <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">You'll see exactly what I'd write down before anything is saved. Telling me something does not let me act on it.</div>
  </div>`;

// Foundry asks for permission on something it has actually watched. The copy
// states the exact effect it would be allowed to have, the things it still
// could not do, and that the founder can withdraw it — no autonomy vocabulary,
// no generic "let it run" switch.
const permissionSection = (
  items: Array<import('../../services/institution/assisting-admission.js').AssistingCandidate>,
) => items.length === 0 ? '' : html`
  <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
    <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">Things I could start helping with</div>
    ${items.map((item) => html`
      <div style="padding:0.6rem 0;border-top:1px solid rgba(255,255,255,0.05);">
        <div style="font-size:0.9rem;color:var(--text-primary);">${item.title}</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">I've been watching this and have ${item.comparisons === 1 ? 'one check' : `${item.comparisons} checks`} to show for it.${item.deviations > 0 ? ` I got ${item.deviations === 1 ? 'one of them' : `${item.deviations} of them`} wrong.` : ''}</div>
        ${item.verifiedFailures > 0 ? html`
        <div style="font-size:0.78rem;color:var(--danger, #ff6b6b);margin-top:0.15rem;">${item.lastVerifiedOutcome === 'verified_failure'
          ? `Last time I acted here it didn't work — ${item.verifiedFailures === 1 ? 'one attempt was' : `${item.verifiedFailures} attempts were`} checked afterwards and failed.`
          : `${item.verifiedFailures === 1 ? 'One attempt' : `${item.verifiedFailures} attempts`} here ${item.verifiedFailures === 1 ? 'was' : 'were'} checked afterwards and failed, though the most recent one worked.`} Worth knowing before you decide.</div>` : ''}
        <div style="font-size:0.78rem;color:var(--text-primary);margin-top:0.35rem;">If you allow it, I may ${item.may}.</div>
        <div style="font-size:0.78rem;color:var(--text-muted);margin-top:0.15rem;">I still may not ${item.mayNot}.</div>
        ${item.granted ? html`
          <div style="font-size:0.72rem;color:var(--text-muted);margin-top:0.35rem;">You've allowed this until ${new Date(item.grantExpiresAt as string).toDateString()}.</div>
          <!-- A LIVE GRANT AND ACTUALLY HELPING ARE DIFFERENT FACTS. The card
               showed only the first, so a grant the database refused to admit
               read exactly like one it accepted: the founder allowed something,
               saw the same words back, and Foundry was not helping. -->
          ${item.assisting ? '' : html`
          <div style="font-size:0.72rem;color:#ffb347;margin-top:0.2rem;">I have not been able to start on it yet, so your permission is recorded and unused. It stays yours — nothing here takes it back.</div>`}
          <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/permission/revoke" style="margin-top:0.35rem;">
            <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Stop allowing this</button>
          </form>` : html`
          <form method="POST" action="/letter/responsibilities/${item.responsibilityId}/permission/grant"
            style="display:flex;gap:0.4rem;margin-top:0.45rem;align-items:center;flex-wrap:wrap;">
            <select name="days" style="font-size:0.78rem;">
              <option value="30">for the next month</option>
              <option value="7">for the next week</option>
              <option value="90">for the next three months</option>
            </select>
            <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;">Allow it</button>
          </form>`}
        <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.3rem;">Allowing this does not send anything on its own. You can stop it at any time.</div>
      </div>`)}
  </div>`;

letterRoutes.get('/letter', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.redirect('/dashboard');

  const fluency = getFluency(founder);

  // A PORTFOLIO OPERATOR GETS ONE LETTER, AND THEN THE WHOLE OF ONE COMPANY.
  //
  // The fleet letter used to REPLACE the single-product letter: a founder with
  // two companies got a ranked needs-you list, system lines, and a bare title
  // per responsibility — and lost every surface where authority is granted or
  // seen. What Foundry is permitted to change, what it changed, the permission
  // asks, the evidence question, support channels, customer messages waiting
  // for a reply, judgments, the report-obligation form: none of them rendered,
  // and there was no way to reach them, because `/letter` took this branch
  // whatever the product switcher said.
  //
  // An authority a founder cannot see is one they cannot withdraw, so that was
  // a governance gap and not a layout preference.
  //
  // The fix is structural rather than twenty sections duplicated per company:
  // the cross-fleet ranking stays on top, and beneath it the ACTIVE company —
  // the one the switcher already selects — renders in full. Ranking across the
  // fleet, action within one company.
  let fleetChrome: HtmlEscapedString | Promise<HtmlEscapedString> | '' = '';
  let fleetHasItems = false;
  if (ctx.allProducts.length > 1) {
    const { composeFleetLetter } = await import('../../services/letter/fleet.js');
    const { verifyFleetLetter } = await import('../../services/letter/verifier.js');
    const { letter: fleet } = await verifyFleetLetter(await composeFleetLetter(founder.id, fluency));
    const intro2 = explain('letter', fluency);
    fleetHasItems = !fleet.quiet;

    fleetChrome = html`
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
              <div style="font-size:0.75rem;color:var(--text-muted);">${n.kind === 'decision'
    ? html`${n.productName} · ${gateLabel(n.gate, fluency)}${n.deadline ? html` · due ${n.deadline}` : ''}`
    // A responsibility says why in the founder's language, from the same map
    // the single-product letter uses. No ontology on screen either way.
    : n.kind === 'responsibility'
      ? html`${n.productName} · ${NEEDS_YOU_REASON[n.because] ?? NEEDS_YOU_REASON.watching}${n.dueAt ? html` (${n.dueAt.slice(0, 10)})` : ''}`
      : html`${n.productName} · ${n.evaluationState === 'contradicted'
        ? 'the date you gave passed and this is still unresolved'
        : 'I raised this and you have not said which way to go'}`}</div>
            </div>
            ${n.kind === 'decision' ? html`
            <a href="/decisions/${n.decisionId}" class="btn btn-primary" style="font-size:0.78rem;padding:0.3rem 0.7rem;"
              onclick="fetch('/letter/attention/${n.decisionId}',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({product_id:'${n.productId}',reaction:'acted'})})">Decide</a>
            <form method="POST" action="/letter/attention/${n.decisionId}" style="margin:0;">
              <input type="hidden" name="product_id" value="${n.productId}" />
              <input type="hidden" name="reaction" value="dismissed" />
              <button type="submit" class="btn btn-ghost" style="font-size:0.72rem;padding:0.25rem 0.5rem;" title="Not now — teaches the ranking">Later</button>
            </form>` : html`
            <!-- Acting on a responsibility means being IN that company: its
                 reason, its disposition form, its authority. So this switches
                 the active company and comes back to the letter, where the
                 full view below now renders it. -->
            <form method="POST" action="/switch-product" style="margin:0;">
              <input type="hidden" name="product_id" value="${n.productId}" />
              <button type="submit" class="btn btn-primary" style="font-size:0.78rem;padding:0.3rem 0.7rem;">Look at ${n.productName}</button>
            </form>`}
          </div>`)}
        </div>` : ''}

        ${fleet.system.length > 0 ? html`
        <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:0.9rem;border:1px solid rgba(255,179,71,0.35);">
          <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffb347;margin-bottom:0.4rem;">Your machine</div>
          ${fleet.system.map((s) => html`<div style="font-size:0.85rem;color:var(--text-primary);padding:0.3rem 0;border-top:1px solid rgba(255,255,255,0.05);">${s}</div>`)}
        </div>` : ''}

        <!-- The ACTIVE company is skipped here: it renders in full below, and
             showing its handled/learned lines in both places would make the
             page say the same thing twice — the defect this letter spent
             several commits removing from its own headline. -->
        ${fleet.products.filter((p) => p.productId !== ctx.productId)
    .map((p) => (p.letter.quiet && Object.values(p.responsibilities).every((items) => items.length === 0) ? '' : html`
        <div class="card" style="padding:1.1rem 1.25rem;margin-bottom:0.9rem;">
          <div style="display:flex;align-items:baseline;gap:0.5rem;margin-bottom:0.5rem;">
            <span style="font-weight:600;color:var(--text-primary);">${p.productName}</span>
            <span style="font-size:0.72rem;color:var(--text-muted);">${p.riskState}</span>
          </div>
          ${[...p.letter.handled.map((l) => ({ tag: 'handled', l })),
             ...p.letter.learned.map((l) => ({ tag: 'learned', l })),
             ...p.letter.noted.map((l) => ({ tag: 'noted', l })),
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
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin:1.5rem 0 0.6rem;">
        ${ctx.productName} — in full
      </div>
      <p style="color:var(--text-muted);font-size:0.78rem;margin:-0.3rem 0 1rem;">
        Everything below is this company. Switch companies at the top to act on another.
      </p>`;
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
  // THE BIGGEST FACT ABOUT A COMPANY BELONGS ON THE PAGE THE FOUNDER READS.
  //
  // A scheduled deletion was visible only on the privacy page. `consent.ts`
  // says why that matters, in the comment beside the cancel door it had to
  // build: "a founder who clicked by accident, or whose co-founder clicked,
  // could do nothing but watch, and nothing on the page even told them it was
  // coming. A grace period nobody can act in is a countdown." The door exists
  // now; this is the sign pointing at it, on the surface they open daily.
  const { pendingDeletion } = await import('../../services/privacy/consent.js');
  // No `.catch()`: `pendingDeletion` is total by construction, and swallowing
  // here is what hid a RangeError it used to throw on a malformed record.
  const deletion = await pendingDeletion(ctx.productId);

  // HAS FOUNDRY STOPPED? A founder whose card failed saw a letter that looked
  // exactly like a working one. The entitlement sweep writes
  // `entitlement_paused_at`, mails them once, and nothing on the daily surface
  // ever says the institution is no longer acting — while every section carries
  // on offering things that will be refused.
  //
  // `companyMayBeChanged` already names the axis, and its four are exactly the
  // four a founder needs told apart: a lapsed subscription, a pause they chose,
  // an archived record, and a scheduled erasure. The erasure has its own card
  // below, so this covers the other three.
  const { companyMayBeChanged } = await import('../../api/middleware/entitlement.js');
  const operating = await companyMayBeChanged(ctx.productId);
  const stopped = operating.allowed || operating.axis === 'erasure' ? null : operating;
  const { getJudgmentRecord, getMaterialJudgments } = await import('../../services/institution/institutional-judgment-disposition.js');
  const materialJudgments = await getMaterialJudgments(ctx.productId);
  // How Foundry's judgments about this company have held up. Read back from the
  // learning it had been recording and never once consulting.
  const judgmentRecord = await getJudgmentRecord(ctx.productId);
  const { getFounderDevelopmentActivity } = await import('../../services/institution/development-assisting.js');
  const development = await getFounderDevelopmentActivity(ctx.productId);
  const { selectFounderEvidenceQuestion } = await import('../../services/institution/founder-evidence.js');
  const evidenceQuestion = await selectFounderEvidenceQuestion(ctx.productId);
  const { getSetAsideQuestions } = await import('../../services/institution/founder-evidence.js');
  const setAsideQuestions = await getSetAsideQuestions(ctx.productId);
  const { CONTACT_CONSTRAINT_LABELS, getContactConstraints } = await import(
    '../../services/institution/contact-constraint.js');
  const contactConstraints = await getContactConstraints(ctx.productId);
  const { getAssistingCandidates } = await import('../../services/institution/assisting-admission.js');
  const assistingCandidates = await getAssistingCandidates(ctx.productId);
  const { listFounderFactOpportunities } = await import('../../services/institution/founder-evidence.js');
  const factOpportunities = await listFounderFactOpportunities(ctx.productId);
  const { REPORTABLE_OBLIGATIONS, OBLIGATION_LABELS } = await import('../../services/founder/company-report.js');
  const obligationOptions: Array<[string, string]> = REPORTABLE_OBLIGATIONS.map((k) => [k, OBLIGATION_LABELS[k]]);
  const { getObservationChannels } = await import('../../services/institution/company-observation.js');
  const observationChannels = await getObservationChannels(ctx.productId);
  const { getUnresolvedEffects, getDisputedEffects } = await import('../../services/institution/effect-outcome.js');
  const unresolvedEffects = await getUnresolvedEffects(ctx.productId);
  const disputedEffects = await getDisputedEffects(ctx.productId);
  const { getMessagesAwaitingReply } = await import('../../services/institution/support-reply.js');
  const customerMessages = await getMessagesAwaitingReply(ctx.productId);
  const { getUncarriedNotices } = await import('../../services/institution/responsibility-notice.js');
  const uncarriedNotices = await getUncarriedNotices(ctx.productId);
  const { CHANNEL_REFUSAL_LABELS, getSupportChannels } = await import('../../services/institution/customer-message-intake.js');
  const supportChannels = await getSupportChannels(ctx.productId);
  // Offered only where a message could actually be acted on, and only where one
  // is not already registered — a second channel for the same responsibility is
  // a real thing to want, but not the default the form should suggest.
  const channelCandidates = (await (await import('../../db/client.js')).query(
    `SELECT id,title FROM institutional_responsibilities
      WHERE product_id=? AND capability='customer_support' AND disposition='active'
        AND state IN ('understood','shadowing','assisting')
        AND id NOT IN (SELECT responsibility_id FROM support_channels
                        WHERE product_id=? AND revoked_at IS NULL)
      ORDER BY created_at`, [ctx.productId, ctx.productId],
  )).rows.map((r) => ({
    responsibilityId: String((r as Record<string, unknown>).id),
    title: String((r as Record<string, unknown>).title),
  }));
  const { getShadowableResponsibilities } = await import('../../services/institution/external-shadowing.js');
  const shadowable = await getShadowableResponsibilities(ctx.productId);
  const { getUnwatchableResponsibilities } = await import(
    '../../services/institution/external-shadowing.js');
  const unwatchable = await getUnwatchableResponsibilities(ctx.productId);
  const { getStepAwayHorizon } = await import(
    '../../services/institution/absence-summary.js');
  const stepAway = await getStepAwayHorizon(ctx.productId);
  const { getUncarriableResponsibilities } = await import(
    '../../services/institution/assisting-admission.js');
  const cannotCarry = await getUncarriableResponsibilities(ctx.productId);
  const { getDarkenedWatches } = await import('../../services/institution/external-shadowing.js');
  const darkenedWatches = await getDarkenedWatches(ctx.productId);
  const { availableDevelopmentChecks } = await import('../../services/institution/development-shadowing.js');
  const developmentChecks = await availableDevelopmentChecks(ctx.productId);
  const understoodDevelopment = (await (await import('../../db/client.js')).query(
    `SELECT id,title FROM institutional_responsibilities
      WHERE product_id=? AND state='understood' AND capability='development' AND disposition='active'
      ORDER BY created_at`, [ctx.productId],
  )).rows.map((r) => ({
    responsibilityId: String((r as Record<string, unknown>).id),
    title: String((r as Record<string, unknown>).title),
  }));
  // A day is not quiet if Foundry is blocked on something only the founder
  // knows. Hiding the question behind "nothing needs you" would be hiding
  // uncertainty, which founder UX may never do.
  const hasResponsibilitySummary = Object.values(responsibilitySummary).some((items) => items.length > 0)
    || materialJudgments.length > 0 || evidenceQuestion !== null;
  // `firstRun` means "a new founder, not an established one on a quiet day",
  // and it was checked BEFORE any of that. So a company whose customer had
  // written in was shown "Welcome — let's get your first signal" while somebody
  // sat waiting for an answer. The quiet branch has always been overridden by
  // real institutional state; first-run needs the same override for the same
  // reason. Founder UX may not hide uncertainty, and it may not hide a person.
  //
  // FOUNDRY HAVING TOUCHED THEIR SYSTEMS IS REAL INSTITUTIONAL STATE, and it was
  // one case short of that list. A company where Foundry had changed a file, or
  // where a check on a change it made had failed, was shown "It's empty because
  // there's no data yet". The two sections it hid are the two the founder most
  // needs: what Foundry changed, and what it is currently permitted to change.
  // An authority a founder cannot see is one they cannot withdraw.
  const hasDevelopmentActivity = development.changes.length > 0
    || development.permitted.length > 0 || development.record !== null;
  // Both short-circuit branches below replace the whole body, so both would
  // hide a person the company has been asked not to contact. Neither may: the
  // founder who recorded that constraint has to be able to see the list they
  // added to, and anyone reviewing what this company will not do has to be able
  // to read it on the page rather than in the database.
  const hasRecordedPerson = contactConstraints.length > 0;
  const needsYou = letter.needsYou
    ? letter.needsYou.replace(/^Gate-(\d+)/, (_, g: string) => gateLabel(Number(g), fluency))
    : null;
  const intro = explain('letter', fluency);
  // Whether the parts of Foundry that keep this page current are running. Read
  // last and rendered first: a founder needs to know the page may be stale
  // BEFORE they read it, not after they have acted on it.
  const { getFailingInstitutionLoops } = await import('../../services/institution/loop-health.js');
  const failingLoops = await getFailingInstitutionLoops();

  const content = html`
    <h1 style="margin-bottom:0.25rem;">The Letter</h1>
    ${fleetChrome ? fleetChrome : html`
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">${new Date().toDateString()} — from your team.</p>
    ${intro ? html`<p style="color:var(--text-muted);font-size:0.8rem;margin:-1rem 0 1.25rem;">${intro}</p>` : ''}`}

    ${loopsStoppedSection(failingLoops)}
    ${stepAwaySection(stepAway)}

    ${stopped ? html`
    <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid #ffb347;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:#ffb347;margin-bottom:0.4rem;">I have stopped</div>
      <div style="font-size:0.95rem;color:var(--text-primary);">${stopped.axis === 'entitlement'
    ? html`I am not doing anything for ${ctx.productName} at the moment — the subscription is not active.`
    : stopped.axis === 'paused'
      ? html`I am not doing anything for ${ctx.productName} at the moment — you paused it.`
      : html`I am not doing anything for ${ctx.productName} at the moment — its record is archived.`}</div>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem;">Nothing is lost. Everything below is what I know; I am simply not acting on it.</div>
      ${stopped.axis === 'archived' ? '' : html`
      <a href="/settings" class="btn btn-primary" style="margin-top:0.6rem;font-size:0.82rem;display:inline-block;">${stopped.axis === 'entitlement' ? 'Fix the subscription' : 'Start me again'}</a>`}
    </div>` : ''}
    ${deletion ? html`
    <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid var(--danger, #ff6b6b);">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--danger, #ff6b6b);margin-bottom:0.4rem;">This company is being deleted</div>
      <div style="font-size:0.95rem;color:var(--text-primary);">${ctx.productName} and everything in it will be removed on ${String(deletion.deletesOn).slice(0, 10)}.</div>
      <div style="font-size:0.8rem;color:var(--text-muted);margin-top:0.3rem;">You can stop this until then — it does not have to be you who asked for it.</div>
      <a href="/privacy" class="btn btn-primary" style="margin-top:0.6rem;font-size:0.82rem;display:inline-block;">Stop the deletion</a>
    </div>` : ''}
    ${letter.firstRun && !hasResponsibilitySummary && customerMessages.length === 0
      && supportChannels.length === 0 && !hasDevelopmentActivity && !fleetHasItems
          && !hasRecordedPerson
      && !stopped && !deletion ? html`
      <div class="card" style="padding:1.5rem;border:1px solid var(--accent);">
        <div style="font-size:1.05rem;color:var(--text-primary);font-weight:600;">Welcome — let's get your first signal.</div>
        <div style="font-size:0.88rem;color:var(--text-muted);margin-top:0.5rem;line-height:1.55;">
          This letter is where your AI team reports in each morning. It's empty because there's no data yet — that's expected on day one. Two things bring it to life:
        </div>
        <div style="margin-top:0.85rem;display:flex;flex-direction:column;gap:0.5rem;">
          <a href="/connections" class="btn btn-primary" style="font-size:0.85rem;align-self:flex-start;">Connect your tools → so Foundry can see your real numbers</a>
          <a href="/decisions" class="btn btn-secondary" style="font-size:0.85rem;align-self:flex-start;">Log your first decision → and the belief behind it, so Foundry can watch it</a>
        </div>
      </div>` : letter.quiet && !hasResponsibilitySummary && !hasDevelopmentActivity
      && !hasRecordedPerson ? html`
      <div class="card" style="padding:1.5rem;text-align:center;">
        <div style="font-size:1rem;color:var(--text-primary);">${fleetChrome
    ? html`Nothing needs you in ${ctx.productName}.`
    : 'Quiet day. Nothing needs you.'}</div>
        <div style="font-size:0.82rem;color:var(--text-muted);margin-top:0.4rem;">${fleetChrome
    ? 'Switch companies at the top to look at another.'
    : "That's the goal. Go build — or rest."}</div>
      </div>` : html`
      ${letter.needsYou ? html`
      <div class="card" style="padding:1.25rem;margin-bottom:1rem;border:1px solid var(--accent);">
        <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--accent);margin-bottom:0.4rem;">The one thing that needs you</div>
        <div style="font-size:0.95rem;color:var(--text-primary);">${needsYou}</div>
        <a href="${letter.needsYouHref}" class="btn btn-primary" style="margin-top:0.75rem;font-size:0.82rem;display:inline-block;">${letter.needsYouHref === '/decisions' ? 'Decide' : 'Look at it'}</a>
      </div>` : ''}
      ${section('Actions handled', letter.handled)}
      ${section('What I learned', letter.learned)}
      ${section('Noticed, and not worth interrupting you for', letter.noted)}
      ${section('What I handled', responsibilitySummary.HANDLED.map((i) => `${i.title} — outcome recorded`))}
      ${section('What changed', responsibilitySummary.CHANGED.map((i) => `${i.title} — ${i.state}`))}
      ${section('What differed while I watched', shadowingExceptions.map((item) =>
        `${item.title} — expected ${item.expectedEventType}; ${item.classification === 'unresolved'
          ? `the outcome remains unresolved (${item.observedSummary})`
          : `instead observed: ${item.observedSummary}`}. I am observing, not carrying this responsibility.`))}
      ${section('Bounded help', assistingActivity.map((item)=>`${item.title} — ${item.detail}`))}
      ${evidenceQuestionSection(evidenceQuestion)}
      ${setAsideSection(setAsideQuestions)}
      ${doNotContactSection(contactConstraints, CONTACT_CONSTRAINT_LABELS)}
      ${permissionSection(assistingCandidates)}
      ${darkenedWatchSection(darkenedWatches)}
      ${metricWatchSection(shadowable)}
      ${cannotWatchSection(unwatchable)}
      ${cannotCarrySection(cannotCarry)}
      ${developmentWatchSection(understoodDevelopment, developmentChecks)}
      ${supportChannelSection(channelCandidates, supportChannels, CHANNEL_REFUSAL_LABELS,
        process.env.APP_URL ?? 'http://localhost:8080')}
      ${customerMessageSection(customerMessages)}
      ${outcomeSection(unresolvedEffects)}
      ${disputedSection(disputedEffects)}
      ${noticeSection([...responsibilitySummary.NEEDS_YOU, ...responsibilitySummary.CHANGED,
        ...responsibilitySummary.HANDLED, ...responsibilitySummary.STILL_OPEN])}
      ${uncarriedNoticeSection(uncarriedNotices)}
      <!-- TELLING ME SOMETHING IS NOT SOMETHING NEEDING YOUR ATTENTION.
           These two were rendered unconditionally in the attention stream —
           the only sections on the page with no empty-state guard — so on a
           genuinely quiet day the founder still got two blank data-entry
           forms competing with real work. They are the founder's way IN, not
           Foundry's way of asking, and they must stay reachable: a capability
           a person cannot reach is the defect this codebase has repeatedly
           found. So they move behind one disclosure, after the things that do
           need reading. -->
      <details style="margin-bottom:1rem;">
        <summary style="cursor:pointer;font-size:0.72rem;letter-spacing:0.1em;text-transform:uppercase;color:var(--text-muted);padding:0.5rem 0;">Tell me something</summary>
        ${reportObligationSection(obligationOptions)}
        ${observationChannelSection(observationChannels)}
      </details>
      ${tellMeSection(factOpportunities)}
      ${judgmentSection(materialJudgments, judgmentRecord)}
      ${section('Changes I made to your systems', [
    ...development.changes.map((c) => `${c.what} — ${c.detail}`),
    // HOW THIS HAS HELD UP, not how well. The counts come from what Foundry
    // recorded about its own changes and had never once read back; a founder
    // deciding whether to keep letting it touch their systems is deciding on a
    // track record, not on one week of individual lines.
    //
    // Stated as three numbers because that is what the evidence is. A rate
    // would invite "75% reliable" from four observations, and unconfirmed is
    // neither a success nor a failure — it is nobody having checked.
    ...(development.record ? [developmentRecordLine(development.record)] : []),
  ])}
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
// Deliberately ungated: this records that the founder OPENED, acted on or
// dismissed a letter item. It is attention telemetry, spends nothing and
// changes nothing about the company — refusing an observer's "I read this"
// would be over-guarding, and its company arrives in the body, where a guard
// resolving the company from the path or the selection could not see it.
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

// THIS IS THE DIAL, AND RAISING IT TO 'act' RECORDS A CONSENT IN THE
// FOUNDER'S NAME. It is the single grant the whole autonomy stack reads,
// and it was reachable by anyone who could select the company. Lowering it
// is not separately gated — see /autopilot/panic below, which only ever
// reduces autonomy and must stay reachable by everyone who can see it.
letterRoutes.post('/autopilot/policy',
  requireCompanyCapability('can_manage_company'), async (c) => {
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

letterRoutes.post('/talk/message',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
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

// The founder answers one question about their own company. The authenticated
// session is the only identity source: the product, the responsibility, and the
// fact being answered are all resolved server-side from the request id plus real
// ownership, so a caller cannot answer another tenant's question, answer a
// question that was never asked, or replay one that is already resolved.
//
// An answer is evidence. It creates no consent, no capability, and no maturity —
// the database refuses a payload that even carries the shape of one.
letterRoutes.post('/letter/evidence/:requestId/answer', async (c) => {
  const founder = c.get('founder');
  const body = await c.req.parseBody();
  const statement = String(body.statement ?? '').trim();
  if (!statement) return c.text('An answer is required', 400);
  if (statement.length > 1000) return c.text('That is longer than I can take in one answer', 400);

  const { recordFounderEvidenceAnswer } = await import('../../services/institution/founder-evidence.js');
  const resource = String(body.resource ?? '').trim() || undefined;
  const rawAmount = String(body.amount ?? '').trim();
  const amount = rawAmount === '' ? undefined : Number(rawAmount);
  const recorded = await recordFounderEvidenceAnswer({
    requestId: c.req.param('requestId'), founderId: founder.id as string, statement,
    resource, amount,
  });
  // Do not reveal whether another tenant's question, or a resolved one, exists.
  if (!recorded) return c.text('Answer refused', 403);
  return c.redirect('/letter');
});

// A person told this company to stop. Recorded as a fact the company states —
// never inferred from what somebody wrote — and honoured at the governed
// boundary regardless of what the founder has otherwise authorised.
// Ordinary company management, not a brake anyone may pull. The list is
// append-only by design, so a member who could write to it could silently stop
// the company writing to its best customer and nobody could undo it here. The
// same capability that governs the sending address governs who it may reach.
letterRoutes.post('/letter/do-not-contact',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No company selected', 400);

  const body = await c.req.parseBody();
  const { recordContactConstraint } = await import(
    '../../services/institution/contact-constraint.js');
  const result = await recordContactConstraint({
    productId: ctx.productId, founderId: founder.id as string,
    email: String(body.email ?? ''),
    reason: String(body.reason ?? 'founder') as never,
  });
  if ('refused' in result) return c.text('I could not record that', 400);
  return c.redirect('/letter');
});

// Setting a question aside leaves the fact unknown. Silence is never recorded as
// a negative answer, and Foundry does not ask again.
letterRoutes.post('/letter/evidence/:requestId/defer', async (c) => {
  const founder = c.get('founder');
  const { deferFounderEvidenceRequest } = await import('../../services/institution/founder-evidence.js');
  const deferred = await deferFounderEvidenceRequest(c.req.param('requestId'), founder.id as string);
  if (!deferred) return c.text('Answer refused', 403);
  return c.redirect('/letter');
});

// The founder tells Foundry something their company has to handle. This is the
// institution's evidence intake: until it existed, nothing in production
// created a company signal at all, so nothing ever reached the first rung.
//
// The kind of obligation is chosen explicitly from a closed, generic set —
// never inferred from prose — so an ambiguous message stays a conversation
// instead of quietly becoming company ontology. Reporting is not permission:
// what it creates is a visible responsibility with everything still to learn.
letterRoutes.post('/letter/company/report',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const what = String(body.what ?? '').trim();
  const obligationKind = String(body.obligation_kind ?? '');
  if (!what) return c.text('Say what needs handling', 400);
  if (what.length > 200) return c.text('Keep it to a short description', 400);

  const { reportCompanyObligation } = await import('../../services/founder/company-report.js');
  // A `date` input gives a bare day. Read it as end of day in UTC so "by the
  // 1st" is not already late at one minute past midnight — and pass it through
  // unvalidated beyond that, because `statedDueDate` is the one place that
  // decides whether a stated date is usable.
  const rawDue = String(body.due_at ?? '').trim();
  const dueAt = /^\d{4}-\d{2}-\d{2}$/.test(rawDue) ? `${rawDue}T23:59:59.000Z` : undefined;
  const reported = await reportCompanyObligation({
    productId: ctx.productId, founderId: founder.id as string, obligationKind, what,
    ...(dueAt ? { dueAt } : {}),
  });
  if (!reported) return c.text('Report refused', 403);
  return c.redirect('/letter');
});

// The company says what it actually counts.
//
// Independent observation used to be admissible only for twelve SaaS metrics,
// so a company whose reality is boats serviced or classes taught could reach
// Understood and never reach Shadowing. This is how a company tells Foundry
// what to listen for, in its own words. Outside systems then post readings to
// the ordinary ingest endpoint under this key.
//
// Declaring something grants nothing. It says what may be observed, not what
// Foundry may do.
// "Did that work?"
//
// Foundry can act and, until migration 137, could never find out whether the
// acting achieved anything: nothing in production produced outcome evidence, so
// every effect stayed `unresolved` by construction rather than by fact. The
// owner usually knows, and their word is evidence — not proof, and recorded as
// their claim with their name on it.
//
// Foundry may not answer this question about itself. The database refuses any
// report attributed to the institution.
letterRoutes.post('/letter/effects/:effectId/outcome',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const { reportEffectOutcome } = await import('../../services/institution/effect-outcome.js');
  const reported = await reportEffectOutcome({
    productId: ctx.productId, effectId: c.req.param('effectId'),
    verdict: String(body.verdict ?? ''), reporter: `founder:${founder.id as string}`,
    detail: String(body.detail ?? ''),
  });
  if ('refused' in reported) return c.text(`Not recorded: ${reported.refused}`, 400);

  // Reconcile immediately so the founder sees their own answer reflected.
  const action = (await import('../../db/client.js')).query;
  const row = (await action(
    'SELECT id FROM outbound_actions WHERE product_id=? AND effect_id=?',
    [ctx.productId, c.req.param('effectId')])).rows[0] as Record<string, unknown> | undefined;
  if (row) {
    const { reconcileAssistedSupportEmail } = await import(
      '../../services/institution/responsibility-assisted-email.js');
    await reconcileAssistedSupportEmail(ctx.productId, String(row.id));
  }
  return c.redirect('/letter');
});

// A founder writes a notice about a responsibility, and — separately — asks
// Foundry to carry it.
//
// Two posts, deliberately. Writing records what the founder said; carrying binds
// it to exact current authority and revalidates again before dispatch. Merging
// them would make authoring imply sending, which is the separation the whole
// boundary exists to keep.
letterRoutes.post('/letter/responsibilities/:responsibilityId/notice',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const { proposeResponsibilityNotice, planResponsibilityNotice } = await import(
    '../../services/institution/responsibility-notice.js');

  const authored = await proposeResponsibilityNotice({
    productId: ctx.productId, founderId: founder.id as string,
    responsibilityId: c.req.param('responsibilityId'),
    recipient: String(body.recipient ?? ''), subject: String(body.subject ?? ''),
    body: String(body.message ?? ''),
  });
  if ('refused' in authored) return c.text(`Not written: ${authored.refused}`, 400);

  // Carrying it is a separate decision the founder makes on the same form. If
  // they only wrote it, it stays written and nothing is planned.
  if (String(body.carry ?? '') !== 'yes') return c.redirect('/letter');

  const planned = await planResponsibilityNotice({
    productId: ctx.productId, founderId: founder.id as string, noticeId: authored.notice.id,
  });
  if ('refused' in planned) return c.text(`Written, but not carried: ${planned.refused}`, 400);
  return c.redirect('/letter');
});

letterRoutes.post('/letter/company/observation-channel',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const label = String(body.label ?? '').trim();
  const channelKey = String(body.channel_key ?? '').trim();
  const unit = String(body.unit ?? '').trim() || undefined;
  if (!label) return c.text('Say what you count', 400);

  const { registerObservationChannel } = await import(
    '../../services/institution/company-observation.js');
  const channel = await registerObservationChannel({
    productId: ctx.productId, founderId: founder.id as string, channelKey, label, unit,
  });
  if (!channel) return c.text('That name will not work — use lower-case letters, numbers and underscores', 400);
  return c.redirect('/letter');
});

// AND THE WAY BACK OUT. `revokeObservationChannel` existed, exported, and had no
// route — so a founder could tell Foundry what to watch and had no way to tell
// it to stop, while the identical support-channel revoke had been there from
// the start. A withdrawal only ever lowers what Foundry may do, which is why it
// is never the half to leave unbuilt.
//
// Revoked rather than deleted: what was observed while the channel was live
// stays observed, and `isAdmissibleObservationField` simply stops admitting new
// readings for it.
letterRoutes.post('/letter/company/observation-channel/revoke',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const { revokeObservationChannel } = await import(
    '../../services/institution/company-observation.js');
  const revoked = await revokeObservationChannel({
    productId: ctx.productId, founderId: founder.id as string,
    channelKey: String(body.channel_key ?? '').trim(),
  });
  // The same answer for an unknown channel and another tenant's: saying which
  // would tell a stranger what a company counts.
  if (!revoked) return c.text('Refused', 403);
  return c.redirect('/letter');
});

// The founder says what they would expect to see from outside if a
// responsibility is being carried, and Foundry starts watching. The metric and
// the direction are chosen from what an outside system already reports — never
// parsed out of prose — so the expectation is the founder's, stated exactly.
//
// Watching is not permission. Being right while watching is still not
// permission.
// The owner says what they would expect a development CHECK to report.
//
// The twin of the metric watch below, and it exists for the same reason: until
// now nothing in production opened a development expectation, so independent
// check results arrived with nothing to resolve and `development-shadowing`
// sat dark. The choice is bounded — a check that already reports, and one of
// two results — never parsed out of prose.
//
// Watching is not permission.
letterRoutes.post('/letter/responsibilities/:responsibilityId/watch-check',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const check = String(body.check ?? '');
  const expectedResult = String(body.expected_result ?? '');
  if (!['passed', 'failed'].includes(expectedResult)) return c.text('Invalid expectation', 400);

  const { beginFounderDevelopmentShadowing } = await import(
    '../../services/institution/development-shadowing.js');
  const started = await beginFounderDevelopmentShadowing({
    productId: ctx.productId, responsibilityId: c.req.param('responsibilityId'),
    founderId: founder.id as string, check, expectedResult,
  });
  // Do not reveal whether another tenant's responsibility exists.
  if (!started) return c.text('Refused', 403);
  return c.redirect('/letter');
});

letterRoutes.post('/letter/responsibilities/:responsibilityId/watch',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const field = String(body.field ?? '');
  const direction = String(body.direction ?? '');
  if (!['rose', 'fell', 'held'].includes(direction)) return c.text('Invalid expectation', 400);

  const { beginExternalMetricShadowing } = await import('../../services/institution/external-shadowing.js');
  const started = await beginExternalMetricShadowing({
    productId: ctx.productId, responsibilityId: c.req.param('responsibilityId'),
    founderId: founder.id as string, field, direction: direction as 'rose' | 'fell' | 'held',
  });
  // Do not reveal whether another tenant's responsibility exists.
  if (!started) return c.text('Refused', 403);
  return c.redirect('/letter');
});

// Stage one of the founder-initiated fact path: show, do not store. This route
// writes nothing at all — it renders the exact sentence Foundry would remember
// and asks the founder to confirm it. Cancelling is simply not confirming.
letterRoutes.post('/letter/facts/preview',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const statement = String(body.statement ?? '').trim();
  if (!statement || statement.length > 1000) return c.text('Say it in a sentence or two', 400);

  const { listFounderFactOpportunities, previewFounderFact } = await import(
    '../../services/institution/founder-evidence.js'
  );
  const opportunities = await listFounderFactOpportunities(ctx.productId);
  const chosen = opportunities[Number(body.opportunity ?? -1)];
  if (!chosen) return c.text('That is not something I am waiting on', 400);

  const resource = String(body.resource ?? '').trim() || undefined;
  const rawAmount = String(body.amount ?? '').trim();
  const amount = rawAmount === '' ? undefined : Number(rawAmount);
  const preview = previewFounderFact({
    fact: chosen.fact, scope: chosen.scope, responsibilityTitle: chosen.responsibilityTitle,
    statement, resource, amount,
  });
  if (!preview) return c.text('I need both what it is and how much, as a number', 400);

  const content = html`
    <h1 style="margin-bottom:0.25rem;">Is this right?</h1>
    <p style="color:var(--text-dim);font-size:0.85rem;margin-bottom:1.5rem;">Nothing is saved yet.</p>
    <div class="card" style="padding:1.25rem;margin-bottom:1rem;">
      <div style="font-size:0.7rem;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;color:var(--text-muted);margin-bottom:0.6rem;">What I would remember</div>
      <div style="font-size:0.95rem;color:var(--text-primary);">${preview}</div>
      <form method="POST" action="/letter/facts/confirm" style="margin-top:0.75rem;display:flex;gap:0.5rem;flex-wrap:wrap;">
        <input type="hidden" name="fact" value="${chosen.fact}" />
        <input type="hidden" name="scope" value="${chosen.scope}" />
        <input type="hidden" name="responsibility_id" value="${chosen.responsibilityId}" />
        <input type="hidden" name="statement" value="${statement}" />
        <input type="hidden" name="resource" value="${resource ?? ''}" />
        <input type="hidden" name="amount" value="${rawAmount}" />
        <button type="submit" class="btn btn-primary" style="font-size:0.8rem;">Yes, remember that</button>
        <a href="/letter" class="btn btn-ghost" style="font-size:0.8rem;">No, cancel</a>
      </form>
      <div style="font-size:0.7rem;color:var(--text-muted);margin-top:0.5rem;">This tells me how your company works. It does not let me do anything on your behalf.</div>
    </div>`;
  return c.html(dashboardLayout(ctx, content));
});

// Stage two: explicit authenticated confirmation. The product, the fact, and
// its scope are all re-resolved server-side against what the institution is
// actually waiting on, so a replayed or hand-edited submission for a fact that
// is already grounded resolves to nothing.
letterRoutes.post('/letter/facts/confirm',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const rawAmount = String(body.amount ?? '').trim();

  const { submitFounderFact } = await import('../../services/institution/founder-evidence.js');
  const recorded = await submitFounderFact({
    productId: ctx.productId, founderId: founder.id as string,
    fact: String(body.fact ?? ''), scope: String(body.scope ?? ''),
    responsibilityId: String(body.responsibility_id ?? ''),
    statement: String(body.statement ?? ''),
    resource: String(body.resource ?? '').trim() || undefined,
    amount: rawAmount === '' ? undefined : Number(rawAmount),
  });
  if (!recorded) return c.text('I could not use that', 403);
  return c.redirect('/letter');
});

// The founder grants exact, bounded, revocable authority for one
// responsibility. The capability, scope, consequence boundary and expiry are
// all resolved server-side from the responsibility itself — nothing about the
// permission is caller-supplied except how long it lasts.
//
// Granting does not send anything. It makes admission possible; the database
// still requires real shadow evidence before the responsibility moves.
// Granting assisting authority for a period of days. The revoke route below
// deliberately stays open: withdrawal only ever lowers what Foundry may do.
letterRoutes.post('/letter/responsibilities/:responsibilityId/permission/grant',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const days = Number(String(body.days ?? '30'));

  const { grantAssistingAuthority } = await import('../../services/institution/assisting-admission.js');
  const granted = await grantAssistingAuthority({
    productId: ctx.productId, responsibilityId: c.req.param('responsibilityId'),
    founderId: founder.id as string, durationDays: Number.isFinite(days) ? days : 30,
  });
  // Do not reveal whether another tenant's responsibility exists.
  if (!granted) return c.text('Refused', 403);
  // A GRANT THAT COULD NOT BE USED IS NOT A SILENT SUCCESS. The refusal was
  // swallowed and this redirected either way, so a founder granted authority,
  // saw no difference, and was left with a live consent Foundry could not act
  // on. The permission stands — it is theirs, and Foundry does not take back
  // what an owner gave — but the page now says so instead of implying the
  // opposite. The reason is logged rather than shown: it names an internal
  // guard, and the founder needs the fact, not the vocabulary.
  if (!granted.admitted && granted.refusal) {
    const { log } = await import('../../lib/logger.js');
    log.warn('assisting admission refused after grant',
      { productId: ctx.productId, refusal: granted.refusal });
  }
  return c.redirect('/letter');
});

// Withdrawal is immediate and needs no reason. Authority is re-read at
// execution time, so a revoked grant stops authorising the next action.
letterRoutes.post('/letter/responsibilities/:responsibilityId/permission/revoke',
  requireCompanyCapability('can_manage_company'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const { revokeAssistingAuthority } = await import('../../services/institution/assisting-admission.js');
  const revoked = await revokeAssistingAuthority({
    productId: ctx.productId, responsibilityId: c.req.param('responsibilityId'),
    founderId: founder.id as string,
  });
  if (!revoked) return c.text('Refused', 403);
  return c.redirect('/letter');
});

// The founder writes the reply. Foundry carries it — nothing more. Recipient,
// responsibility, capability, consent and scope are all resolved server-side
// from the message and the channel that owns it, so the form has one field.
letterRoutes.post('/letter/messages/:messageId/reply',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const { proposeSupportReply } = await import('../../services/institution/support-reply.js');
  const proposed = await proposeSupportReply({
    productId: ctx.productId, founderId: founder.id as string,
    messageId: c.req.param('messageId'), body: String(body.reply ?? ''),
  });
  if ('refused' in proposed) return c.text('Reply refused', 403);
  return c.redirect('/letter');
});

// Planning binds the reply to exact current authority. It sends nothing — the
// send is a separate, separately revalidated step.
letterRoutes.post('/letter/replies/:proposalId/plan',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const { planProposedReply } = await import('../../services/institution/support-reply.js');
  const planned = await planProposedReply({
    productId: ctx.productId, founderId: founder.id as string, proposalId: c.req.param('proposalId'),
  });
  if ('refused' in planned) return c.text('Not ready to send', 403);
  return c.redirect('/letter');
});

// The only consequential step. Authority is revalidated immediately before
// dispatch, so a permission withdrawn since planning stops the send here.
// Sends. The one-off approval on the actions page asks can_trigger_actions;
// this door reached the same kind of consequence and asked nothing.
letterRoutes.post('/letter/replies/:actionId/send',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const { query } = await import('../../db/client.js');
  // Server-side ownership check; the action id alone proves nothing.
  const owned = await query(
    `SELECT 1 FROM outbound_actions a JOIN products p ON p.id=a.product_id
      WHERE a.id=? AND a.product_id=? AND p.owner_id=?`,
    [c.req.param('actionId'), ctx.productId, founder.id],
  );
  if (!owned.rows.length) return c.text('Refused', 403);
  const { executeAssistedSupportEmail } = await import(
    '../../services/institution/responsibility-assisted-email.js'
  );
  await executeAssistedSupportEmail(c.req.param('actionId'));
  return c.redirect('/letter');
});

// Carrying a notice the founder wrote earlier. The other half of the
// separation: authoring records what they said, and this binds it to exact
// current authority. Planning re-resolves the grant from scratch and refuses
// when it is absent, so a notice written before permission was given cannot be
// carried by having been written.
letterRoutes.post('/letter/notices/:noticeId/carry',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const { planResponsibilityNotice } = await import(
    '../../services/institution/responsibility-notice.js');
  const planned = await planResponsibilityNotice({
    productId: ctx.productId, founderId: founder.id as string,
    noticeId: c.req.param('noticeId'),
  });
  if ('refused' in planned) return c.text(`Not carried: ${planned.refused}`, 400);
  return c.redirect('/letter');
});

// Withdrawing a channel. Immediate, and it needs no reason: intake reads
// `revoked_at IS NULL` on every message, so the next one is simply refused —
// identically to an unknown key, so nobody learns which channels exist.
letterRoutes.post('/letter/channels/:channelId/revoke', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const { revokeSupportChannel } = await import(
    '../../services/institution/customer-message-intake.js'
  );
  const revoked = await revokeSupportChannel({
    productId: ctx.productId, channelId: c.req.param('channelId'),
    founderId: founder.id as string,
  });
  if (!revoked) return c.text('Refused', 403);
  return c.redirect('/letter');
});

// WHICH PROVIDER FEEDS THIS CHANNEL — the founder's statement, never Foundry's
// inference. A product can hold several channels bound to different
// responsibilities, so an adapter that chose one would be deciding which
// responsibility a customer's message belongs to. The refusals are surfaced
// rather than swallowed: `provider_taken` in particular is a real thing a
// founder needs to see, because it means another channel already claims that
// provider and they are about to wonder why nothing arrives.
letterRoutes.post('/letter/channels/:channelId/feed',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const provider = String(body.provider ?? '').trim() || null;
  const { setChannelFeed } = await import(
    '../../services/institution/customer-message-intake.js'
  );
  const result = await setChannelFeed({
    productId: ctx.productId, channelId: c.req.param('channelId'), provider,
  });
  if ('refused' in result) {
    const said: Record<string, string> = {
      unknown_provider: 'I have no adapter for that, so nothing would arrive.',
      unknown_channel: 'That is not a channel of yours.',
      provider_taken: 'Another of your channels already receives from there. '
        + 'Two would mean I had to choose which responsibility a message belongs '
        + 'to, and I will not guess that.',
    };
    return c.text(said[result.refused] ?? result.refused, 400);
  }
  return c.redirect('/letter');
});

// The founder tells Foundry which way customers reach them about a
// responsibility, and receives the key that channel authenticates with. The
// binding is what lets a message be attributed without guessing from its text.
letterRoutes.post('/letter/responsibilities/:responsibilityId/channel',
  requireCompanyCapability('can_trigger_actions'), async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'letter', 'The Letter', undefined, c);
  if (!ctx.productId) return c.text('No product', 400);
  const body = await c.req.parseBody();
  const { registerSupportChannel } = await import(
    '../../services/institution/customer-message-intake.js'
  );
  const channel = await registerSupportChannel({
    productId: ctx.productId, responsibilityId: c.req.param('responsibilityId'),
    founderId: founder.id as string, label: String(body.label ?? ''),
  });
  if (!channel) return c.text('Refused', 403);
  return c.redirect('/letter');
});
