// =============================================================================
// FOUNDRY — Founder Voice Profile
// Teach Foundry how you communicate, think, and make decisions.
// This makes every AI-generated draft sound like YOU, not a chatbot.
// =============================================================================

import { Hono } from 'hono';
import { html } from 'hono/html';
import type { AuthEnv } from '../../middleware/auth.js';
import { query } from '../../db/client.js';
import { dashboardLayout } from '../../views/layout.js';
import { getLayoutContext } from './_shared.js';
import { parseRequestBody } from '../../lib/request.js';

export const voiceRoutes = new Hono<AuthEnv>();

voiceRoutes.get('/settings/voice', async (c) => {
  const founder = c.get('founder');
  const ctx = await getLayoutContext(founder, 'settings', 'Your Voice', undefined, c);
  const saved = c.req.query('saved') === '1';

  const result = await query('SELECT * FROM founder_voice WHERE founder_id = ?', [founder.id]);
  const voice = (result.rows[0] as Record<string, unknown>) ?? {};

  const content = html`
    <h1>Your Voice</h1>
    ${saved ? html`<div class="feedback-banner feedback-success"><span class="feedback-icon">&#10003;</span><span>Voice profile saved. Foundry will use this to calibrate all AI-generated content.</span></div>` : ''}

    <p style="color:var(--color-text-muted);margin-bottom:1.5rem;">
      This is about <strong>you</strong>, not your product. When Foundry drafts an email, writes a competitive response,
      or recommends a decision — it should sound like you wrote it. Fill in as much as feels right. Everything is optional.
    </p>

    <form method="POST" action="/settings/voice">

      <div class="card">
        <h3>Communication Style</h3>
        <div class="form-group">
          <label for="writing_tone">How do you naturally write?</label>
          <select name="writing_tone" id="writing_tone">
            <option value="" ${!voice.writing_tone ? 'selected' : ''}>Not set</option>
            <option value="casual" ${voice.writing_tone === 'casual' ? 'selected' : ''}>Casual — like texting a friend</option>
            <option value="friendly" ${voice.writing_tone === 'friendly' ? 'selected' : ''}>Friendly — warm but professional</option>
            <option value="direct" ${voice.writing_tone === 'direct' ? 'selected' : ''}>Direct — get to the point</option>
            <option value="technical" ${voice.writing_tone === 'technical' ? 'selected' : ''}>Technical — precise and detailed</option>
            <option value="formal" ${voice.writing_tone === 'formal' ? 'selected' : ''}>Formal — polished and structured</option>
          </select>
        </div>
        <div class="form-group">
          <label for="formality_level">Formality level</label>
          <div style="display:flex;align-items:center;gap:1rem;">
            <span style="font-size:var(--text-sm);color:var(--color-text-muted);">Casual</span>
            <input type="range" name="formality_level" id="formality_level" min="1" max="10" value="${voice.formality_level ?? 5}" style="flex:1;accent-color:var(--color-primary);" />
            <span style="font-size:var(--text-sm);color:var(--color-text-muted);">Formal</span>
          </div>
        </div>
        <div class="form-group">
          <label for="detail_preference">When Foundry reports to you, how much detail?</label>
          <select name="detail_preference" id="detail_preference">
            <option value="minimal" ${voice.detail_preference === 'minimal' ? 'selected' : ''}>Minimal — headline + action only</option>
            <option value="standard" ${voice.detail_preference === 'standard' ? 'selected' : ''}>Standard — headline, context, action</option>
            <option value="comprehensive" ${voice.detail_preference === 'comprehensive' ? 'selected' : ''}>Comprehensive — full analysis with data</option>
          </select>
        </div>
      </div>

      <div class="card">
        <h3>Decision-Making Style</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:1rem;">
          Foundry learns this from your decision history too, but you can set the baseline.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label for="risk_tolerance">Risk tolerance</label>
            <select name="risk_tolerance" id="risk_tolerance">
              <option value="conservative" ${voice.risk_tolerance === 'conservative' ? 'selected' : ''}>Conservative — minimize downside</option>
              <option value="moderate" ${voice.risk_tolerance === 'moderate' ? 'selected' : ''}>Moderate — balanced risk/reward</option>
              <option value="aggressive" ${voice.risk_tolerance === 'aggressive' ? 'selected' : ''}>Aggressive — maximize upside</option>
            </select>
          </div>
          <div class="form-group">
            <label for="decision_speed">Decision speed</label>
            <select name="decision_speed" id="decision_speed">
              <option value="fast" ${voice.decision_speed === 'fast' ? 'selected' : ''}>Fast — decide and iterate</option>
              <option value="thoughtful" ${voice.decision_speed === 'thoughtful' ? 'selected' : ''}>Thoughtful — gather data, then decide</option>
              <option value="deliberate" ${voice.decision_speed === 'deliberate' ? 'selected' : ''}>Deliberate — sleep on it, consider deeply</option>
            </select>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Business Philosophy</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:1rem;">
          These shape how Foundry recommends strategy. There are no wrong answers.
        </p>
        <div class="form-group">
          <label for="growth_philosophy">How do you think about growth?</label>
          <textarea name="growth_philosophy" id="growth_philosophy" rows="2"
            placeholder="Example: I prefer organic growth through content and community. Paid acquisition is a last resort.">${voice.growth_philosophy ?? ''}</textarea>
        </div>
        <div class="form-group">
          <label for="pricing_philosophy">How do you think about pricing?</label>
          <textarea name="pricing_philosophy" id="pricing_philosophy" rows="2"
            placeholder="Example: I price based on value delivered, not cost. I'd rather charge more and serve fewer, happier customers.">${voice.pricing_philosophy ?? ''}</textarea>
        </div>
        <div class="form-group">
          <label for="customer_philosophy">How do you think about customers?</label>
          <textarea name="customer_philosophy" id="customer_philosophy" rows="2"
            placeholder="Example: I want customers who are partners, not just users. I'd rather have 100 deeply engaged customers than 10,000 free signups.">${voice.customer_philosophy ?? ''}</textarea>
        </div>
      </div>

      <div class="card">
        <h3>Personal Context</h3>
        <p style="font-size:var(--text-sm);color:var(--color-text-muted);margin-bottom:1rem;">
          Helps Foundry time its actions and tailor its advice to your reality.
        </p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:1rem;">
          <div class="form-group">
            <label for="working_hours">When do you typically work?</label>
            <input type="text" name="working_hours" id="working_hours" value="${voice.working_hours ?? ''}"
              placeholder="9am-5pm ET, or 'async'" />
          </div>
          <div class="form-group">
            <label for="energy_pattern">Energy pattern</label>
            <select name="energy_pattern" id="energy_pattern">
              <option value="" ${!voice.energy_pattern ? 'selected' : ''}>Not set</option>
              <option value="morning" ${voice.energy_pattern === 'morning' ? 'selected' : ''}>Morning person — best thinking before noon</option>
              <option value="afternoon" ${voice.energy_pattern === 'afternoon' ? 'selected' : ''}>Afternoon — hit stride after lunch</option>
              <option value="night" ${voice.energy_pattern === 'night' ? 'selected' : ''}>Night owl — most productive late</option>
              <option value="varies" ${voice.energy_pattern === 'varies' ? 'selected' : ''}>Varies — no consistent pattern</option>
            </select>
          </div>
          <div class="form-group">
            <label for="biggest_strength">Your biggest strength as a founder</label>
            <input type="text" name="biggest_strength" id="biggest_strength" value="${voice.biggest_strength ?? ''}"
              placeholder="Example: technical execution, customer empathy, speed" />
          </div>
          <div class="form-group">
            <label for="biggest_gap">Where you need the most help</label>
            <input type="text" name="biggest_gap" id="biggest_gap" value="${voice.biggest_gap ?? ''}"
              placeholder="Example: marketing, finance, operations, hiring" />
          </div>
        </div>
      </div>

      <button type="submit" class="btn btn-primary">Save Voice Profile</button>
    </form>
  `;

  return c.html(dashboardLayout(ctx, content));
});

voiceRoutes.post('/settings/voice', async (c) => {
  const founder = c.get('founder');
  const raw = await parseRequestBody(c) as Record<string, string>;

  await query(
    `INSERT INTO founder_voice (founder_id, writing_tone, formality_level, detail_preference, risk_tolerance, decision_speed,
       growth_philosophy, pricing_philosophy, customer_philosophy, working_hours, energy_pattern, biggest_strength, biggest_gap, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (founder_id) DO UPDATE SET
       writing_tone = excluded.writing_tone, formality_level = excluded.formality_level,
       detail_preference = excluded.detail_preference, risk_tolerance = excluded.risk_tolerance,
       decision_speed = excluded.decision_speed, growth_philosophy = excluded.growth_philosophy,
       pricing_philosophy = excluded.pricing_philosophy, customer_philosophy = excluded.customer_philosophy,
       working_hours = excluded.working_hours, energy_pattern = excluded.energy_pattern,
       biggest_strength = excluded.biggest_strength, biggest_gap = excluded.biggest_gap,
       updated_at = CURRENT_TIMESTAMP`,
    [founder.id, raw.writing_tone || null, parseInt(raw.formality_level ?? '5', 10),
     raw.detail_preference || 'standard', raw.risk_tolerance || 'moderate',
     raw.decision_speed || 'thoughtful', raw.growth_philosophy || null,
     raw.pricing_philosophy || null, raw.customer_philosophy || null,
     raw.working_hours || null, raw.energy_pattern || null,
     raw.biggest_strength || null, raw.biggest_gap || null]
  );

  return c.redirect('/settings/voice?saved=1');
});
