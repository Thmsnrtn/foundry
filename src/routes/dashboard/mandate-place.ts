// =============================================================================
// FOUNDRY — the Mandate, where the owner reads and changes it.
//
// INSTITUTION_MODEL §7, §9 (30 September 2026). One card on Control, first:
// what Foundry believes the owner wants, each statement with its scope and how
// long it lasts, each one removable. The composer and the card's own controls
// write the same rows through the same writer; a sentence differs from a tap
// only in its source. After every change the page shows what changed and
// what did not, worked out from the rows before and after.
//
// A SENTENCE IS CONFIRMED AGAINST THE READING IT WAS SHOWN. The confirm path
// compiles the sentence again on the server and binds only if the reading's
// hash is the one on the page; the form carries the words and the hash,
// never the meaning.
// =============================================================================
import { Hono } from 'hono';
import { html } from 'hono/html';
import type { HtmlEscapedString } from 'hono/utils/html';
import { query } from '../../db/client.js';
import { requireInstitutionOwner } from '../../middleware/rbac.js';
import { page } from '../../views/owner/shell.js';
import {
  MANDATE_DIMENSION_WORDS, MandateRefused, diffOf, durationOf, mandateOf, phraseOf, stateMandate, subjectOf, withdrawMandate,
  type MandateDimension, type MandateReading, type MandateStatement,
} from '../../services/mandate/statements.js';
import type { IntentProposal } from '../../services/intent/compile.js';

export const mandateRoutes = new Hono();

async function founderOf(c: any): Promise<string | null> {
  const founder = c.get('founder') as { id?: string } | undefined;
  return founder?.id ? String(founder.id) : null;
}

/** One statement of the owner's, by id, whether live or not — for the diff. */
async function statementById(founderId: string, id: string): Promise<MandateStatement | null> {
  if (!/^ms_[\w-]{1,32}$/.test(id)) return null;
  const r = (await query(
    `SELECT id, dimension, subject, value_json, scope_kind, scope_ref, statement, source, until, review_at, said_at
       FROM mandate_statements WHERE id = ? AND founder_id = ?`, [id, founderId])).rows[0] as Record<string, unknown> | undefined;
  if (!r) return null;
  const value = JSON.parse(String(r.value_json ?? '{}')) as Record<string, unknown>;
  return {
    id: String(r.id), dimension: String(r.dimension) as MandateDimension, subject: String(r.subject),
    label: String(value.label ?? r.subject).replace(/_/g, ' '), value,
    scope: { kind: String(r.scope_kind) as 'portfolio' | 'domain', ref: r.scope_ref == null ? null : String(r.scope_ref) },
    statement: String(r.statement), until: r.until == null ? null : String(r.until), reviewAt: r.review_at == null ? null : String(r.review_at),
    understoodAs: '', source: String(r.source), saidAt: String(r.said_at),
  };
}

const back = (was: string | null, now: string | null): string =>
  `/foundry/controls?${new URLSearchParams({ ...(was ? { was } : {}), ...(now ? { now } : {}), mandate: '1' }).toString()}#mandate`;

/**
 * THE CARD, FIRST ON CONTROL. What is in force, then the change just made (if
 * one was), then the controls. `was` and `now` name rows; the diff is read
 * from them, so a crafted link can show only the owner's own statements.
 */
export async function mandateCard(founderId: string, q: Record<string, string | undefined>): Promise<HtmlEscapedString> {
  const live = await mandateOf(founderId);
  const was = q.was ? await statementById(founderId, q.was) : null;
  const now = q.now ? await statementById(founderId, q.now) : null;
  const diff = q.mandate === '1' && (was || now) ? diffOf(was, now) : null;
  const error = q.mandate_error ? String(q.mandate_error).slice(0, 200) : null;
  return html`<section class="card mandate" id="mandate" aria-labelledby="mandate-h">
    <h2 id="mandate-h">What you want</h2>
    <p class="quiet">What Foundry aims for, in your words. None of it lets Foundry do, spend or send anything more.</p>
    ${diff ? html`<div class="diff" role="status"><p><b>Changed:</b> ${diff.changed}</p><p class="quiet">${diff.unchanged}</p>
      <form method="POST" action="/foundry/mandate/undo" class="inline">
        ${was ? html`<input type="hidden" name="was" value="${was.id}" />` : ''}${now ? html`<input type="hidden" name="now" value="${now.id}" />` : ''}
        <button class="btn btn-sm" type="submit">Undo</button></form></div>` : ''}
    ${error ? html`<p class="noticed" role="alert">${error}</p>` : ''}
    ${live.length ? html`<ul class="mandate-list">${live.map((s) => html`<li>
        <span class="mandate-what"><b>${MANDATE_DIMENSION_WORDS[s.dimension]}:</b> ${s.label}${s.scope.kind === 'domain' ? html` <span class="dim">(${String(s.scope.ref).replace(/_/g, ' ')})</span>` : ''}</span>
        <span class="mandate-when dim">${s.until ? `until ${s.until}` : s.reviewAt ? `I will ask again ${s.reviewAt}` : 'until you change it'} · you said “${s.statement}”</span>
        <form method="POST" action="/foundry/mandate/${s.id}/withdraw" class="inline"><button class="btn btn-sm" type="submit" aria-label="Take back: ${phraseOf(s)}">Take back</button></form>
      </li>`)}</ul>`
      : html`<p>Nothing yet. Say it in the box below — “No SaaS for now”, “Prioritize cash flow”, “Spend less this month” — or add it here.</p>`}
    <details class="fold"><summary><h3>Add one</h3></summary>
      <form method="POST" action="/foundry/mandate" class="limits">
        <label>What kind<select name="dimension" aria-label="What kind">
          <option value="avoid">Leave alone</option><option value="interest">Look harder at</option><option value="optimize">Favour</option>
        </select></label>
        <label>What<input type="text" name="subject" aria-label="What" maxlength="40" required placeholder="SaaS, digital downloads, cash flow" /></label>
        <label>For how long<select name="lasting" aria-label="For how long">
          <option value="">Until I change it</option><option value="for now">For now (ask me again in 30 days)</option><option value="this month">This month</option>
        </select></label>
        <button class="btn go" type="submit">Add</button>
      </form>
    </details>
  </section>`;
}

/**
 * THE CONFIRMATION, FROM THE COMPOSER. What was understood, what it would
 * replace, and the line that says what it does not touch — then one tap.
 */
export async function mandateConfirmation(founderId: string, p: IntentProposal): Promise<HtmlEscapedString> {
  const m = p.mandate!;
  const live = await mandateOf(founderId);
  const replaces = live.find((s) => s.scope.kind === m.scope.kind && s.scope.ref === m.scope.ref
    && (s.dimension === m.dimension || ([s.dimension, m.dimension].every((d) => d === 'interest' || d === 'avoid') ))
    && (s.subject === m.subject || (s.dimension === 'posture' && m.dimension === 'posture' && m.scope.kind === 'portfolio'))) ?? null;
  const shown = { ...m, id: '', source: '', saidAt: '' } as MandateStatement;
  return page('What you want', html`
    <h1>Change what you want?</h1>
    <p class="lede">You said: <strong>${p.said}</strong></p>
    <p>I understood that ${m.understoodAs}.</p>
    <dl class="six">
      <dt>Before</dt><dd>${phraseOf(replaces)}</dd>
      <dt>After</dt><dd>${phraseOf(shown)}</dd>
      <dt>Unchanged</dt><dd>What Foundry may do, spend or send. This is steering, not permission.</dd>
    </dl>
    <form method="POST" action="/foundry/mandate/confirm" class="say">
      <input type="hidden" name="said" value="${p.said}" />
      <input type="hidden" name="hash" value="${p.hash}" />
      ${p.scope.kind === 'company' && p.scope.id ? html`<input type="hidden" name="scope" value="company:${p.scope.id}" />` : ''}
      <button class="btn go" type="submit">Yes, that is what I want</button>
    </form>
    <p><a class="btn" href="/foundry">Not now</a> <span class="quiet">You can change or take it back on Control at any time.</span></p>`, 'controls') as HtmlEscapedString;
}

// ─── Confirm a sentence ──────────────────────────────────────────────────────
mandateRoutes.post('/foundry/mandate/confirm', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const said = String(form.said ?? '').trim().slice(0, 800);
  const hash = String(form.hash ?? '');
  const scopeRaw = String(form.scope ?? '');
  const scopeId = /^company:[A-Za-z0-9_-]{1,64}$/.test(scopeRaw) ? scopeRaw.slice('company:'.length) : null;
  // The scope is the owner's only if the company is: anybody else's is ignored.
  const scoped = scopeId ? (await query(`SELECT id, name FROM products WHERE id = ? AND owner_id = ? AND deleted_at IS NULL`, [scopeId, founderId])).rows[0] as Record<string, unknown> | undefined : undefined;
  const { compileIntent } = await import('../../services/intent/compile.js');
  const { currentMandate } = await import('../../services/venture/mandate.js');
  const p = compileIntent(said, {
    searching: await currentMandate(founderId) !== null,
    scope: scoped ? { kind: 'company', id: String(scoped.id), name: String(scoped.name) } : { kind: 'none', id: null, name: null },
  });
  // THE READING CONFIRMED IS THE READING SHOWN, or nothing binds and the
  // owner sees what it reads as now.
  if (p.destination !== 'mandate' || !p.mandate || p.hash !== hash) {
    if (p.destination === 'mandate' && p.mandate) return c.html(await mandateConfirmation(founderId, p), 409);
    return c.redirect(back(null, null).replace('mandate=1', `mandate_error=${encodeURIComponent('That no longer reads as something you want, so nothing changed.')}`));
  }
  const { intentShown, recordConfirmed } = await import('../../services/intent/record.js');
  const shownId = await intentShown(founderId, p.hash);
  const { before, after } = await stateMandate(founderId, p.mandate, shownId ? `intent:${shownId}` : 'direct');
  await recordConfirmed(founderId, said);
  return c.redirect(back(before?.id ?? null, after.id));
});

// ─── The card's own controls ─────────────────────────────────────────────────
const DIRECT: MandateDimension[] = ['avoid', 'interest', 'optimize'];

/** A tap, as the same typed reading a sentence would produce. */
export function directReading(dimension: string, subjectText: string, lasting: string, now: Date = new Date()): MandateReading | null {
  if (!DIRECT.includes(dimension as MandateDimension)) return null;
  const s = subjectOf(subjectText);
  if (!s) return null;
  const words = lasting === 'for now' || lasting === 'this month' ? lasting : '';
  const { until, reviewAt } = durationOf(`x ${words}`, now);
  const verb = { avoid: 'Leave alone', interest: 'Look harder at', optimize: 'Favour' }[dimension as 'avoid' | 'interest' | 'optimize'];
  return {
    dimension: dimension as MandateDimension, subject: s.subject, label: s.label,
    value: dimension === 'avoid' ? { level: 'avoid' } : dimension === 'interest' ? { level: 'focus' } : { weight: 'high' },
    scope: { kind: 'portfolio', ref: null }, statement: `${verb}: ${s.label}${words ? ` (${words})` : ''}`,
    until, reviewAt, understoodAs: `${verb.toLowerCase()} ${s.label}`,
  };
}

mandateRoutes.post('/foundry/mandate', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const r = directReading(String(form.dimension ?? ''), String(form.subject ?? ''), String(form.lasting ?? ''));
  if (!r) return c.redirect(`/foundry/controls?mandate_error=${encodeURIComponent('Say what, in a few words: SaaS, digital downloads, cash flow. Nothing changed.')}#mandate`);
  const { before, after } = await stateMandate(founderId, r, 'direct');
  return c.redirect(back(before?.id ?? null, after.id));
});

mandateRoutes.post('/foundry/mandate/:id/withdraw', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const gone = await withdrawMandate(founderId, String(c.req.param('id')));
  if (!gone) return c.notFound();
  return c.redirect(back(gone.id, null));
});

/**
 * UNDO: the change just made, taken back. The newer statement is withdrawn and
 * the one it replaced is said again, as a new row that says it was an undo —
 * nothing is edited, so the record shows the change and its reversal.
 */
mandateRoutes.post('/foundry/mandate/undo', requireInstitutionOwner(), async (c: any) => {
  const founderId = await founderOf(c);
  if (!founderId) return c.redirect('/onboarding');
  const form = await c.req.parseBody();
  const nowId = String(form.now ?? '');
  const wasId = String(form.was ?? '');
  const newer = nowId ? await statementById(founderId, nowId) : null;
  const older = wasId ? await statementById(founderId, wasId) : null;
  if (!newer && !older) return c.notFound();
  if (newer) await withdrawMandate(founderId, newer.id);
  let restored: MandateStatement | null = null;
  if (older && !(await mandateOf(founderId)).some((s) => s.id === older.id)) {
    try {
      restored = (await stateMandate(founderId, { ...older, understoodAs: '' }, `undo:${newer?.id ?? older.id}`)).after;
    } catch (e) { if (!(e instanceof MandateRefused)) throw e; }
  }
  return c.redirect(back(newer?.id ?? null, restored?.id ?? null));
});

