// =============================================================================
// FOUNDRY — Psychology-Aware AI Calibration
// Adapts tone, length, framing, and jargon level of all AI outputs
// based on founder's psychology profile, experience, and communication style.
// =============================================================================

import { query } from '../../db/client.js';
import { nanoid } from 'nanoid';

export interface FounderAIProfile {
  communication_style: 'concise' | 'standard' | 'detailed';
  preferred_length: 'short' | 'medium' | 'long';
  jargon_level: 'none' | 'low' | 'moderate' | 'high';
  encouragement_level: 'minimal' | 'balanced' | 'high';
  directness_level: 'gentle' | 'moderate' | 'direct' | 'blunt';
  data_density: 'low' | 'moderate' | 'high';
  decision_framing: 'options_first' | 'balanced' | 'recommendation_first';
  experience_level: 'first_time' | 'experienced' | 'serial';
  active_psychology_patterns: string[];
  custom_instructions: string | null;
}

const DEFAULT_PROFILE: FounderAIProfile = {
  communication_style: 'standard',
  preferred_length: 'medium',
  jargon_level: 'moderate',
  encouragement_level: 'balanced',
  directness_level: 'moderate',
  data_density: 'moderate',
  decision_framing: 'balanced',
  experience_level: 'experienced',
  active_psychology_patterns: [],
  custom_instructions: null,
};

/**
 * Get the AI profile for a founder. Auto-calibrates from signals if no explicit profile.
 */
export async function getFounderAIProfile(founderId: string): Promise<FounderAIProfile> {
  const result = await query('SELECT * FROM founder_ai_profile WHERE founder_id = ?', [founderId]);
  const row = result.rows[0] as Record<string, unknown> | undefined;

  if (row) {
    return {
      communication_style: (row.communication_style as string ?? 'standard') as FounderAIProfile['communication_style'],
      preferred_length: (row.preferred_length as string ?? 'medium') as FounderAIProfile['preferred_length'],
      jargon_level: (row.jargon_level as string ?? 'moderate') as FounderAIProfile['jargon_level'],
      encouragement_level: (row.encouragement_level as string ?? 'balanced') as FounderAIProfile['encouragement_level'],
      directness_level: (row.directness_level as string ?? 'moderate') as FounderAIProfile['directness_level'],
      data_density: (row.data_density as string ?? 'moderate') as FounderAIProfile['data_density'],
      decision_framing: (row.decision_framing as string ?? 'balanced') as FounderAIProfile['decision_framing'],
      experience_level: (row.experience_level as string ?? 'experienced') as FounderAIProfile['experience_level'],
      active_psychology_patterns: row.active_psychology_patterns
        ? JSON.parse(row.active_psychology_patterns as string)
        : [],
      custom_instructions: row.custom_instructions as string | null,
    };
  }

  // Auto-calibrate from signals
  return autoCalibrate(founderId);
}

/**
 * Build a psychology-aware system prompt by wrapping the base prompt with calibration instructions.
 */
export async function buildFounderSystemPrompt(
  founderId: string,
  baseSystemPrompt: string
): Promise<string> {
  const profile = await getFounderAIProfile(founderId);
  const calibrationBlock = buildCalibrationBlock(profile);
  return `${calibrationBlock}\n\n${baseSystemPrompt}`;
}

/**
 * Update the AI profile based on explicit founder preferences.
 */
export async function updateAIProfile(
  founderId: string,
  updates: Partial<FounderAIProfile>
): Promise<void> {
  const existing = await query('SELECT id FROM founder_ai_profile WHERE founder_id = ?', [founderId]);

  if (existing.rows.length === 0) {
    await query(
      `INSERT INTO founder_ai_profile (id, founder_id, communication_style, preferred_length, jargon_level, encouragement_level, directness_level, data_density, decision_framing, experience_level, custom_instructions)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        nanoid(), founderId,
        updates.communication_style ?? 'standard',
        updates.preferred_length ?? 'medium',
        updates.jargon_level ?? 'moderate',
        updates.encouragement_level ?? 'balanced',
        updates.directness_level ?? 'moderate',
        updates.data_density ?? 'moderate',
        updates.decision_framing ?? 'balanced',
        updates.experience_level ?? 'experienced',
        updates.custom_instructions ?? null,
      ]
    );
  } else {
    const sets: string[] = [];
    const args: unknown[] = [];
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && key !== 'active_psychology_patterns') {
        sets.push(`${key} = ?`);
        args.push(value);
      }
    }
    if (updates.active_psychology_patterns) {
      sets.push('active_psychology_patterns = ?');
      args.push(JSON.stringify(updates.active_psychology_patterns));
    }
    if (sets.length > 0) {
      sets.push("updated_at = datetime('now')");
      args.push(founderId);
      await query(`UPDATE founder_ai_profile SET ${sets.join(', ')} WHERE founder_id = ?`, args);
    }
  }
}

/**
 * Record feedback on an AI output to improve calibration over time.
 */
export async function recordOutputFeedback(
  founderId: string,
  outputType: string,
  outputId: string | null,
  feedback: {
    rating?: number;
    feedback?: string;
    too_long?: boolean;
    too_short?: boolean;
    too_technical?: boolean;
    too_simple?: boolean;
  }
): Promise<void> {
  await query(
    `INSERT INTO ai_output_feedback (id, founder_id, output_type, output_id, rating, feedback, too_long, too_short, too_technical, too_simple)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      nanoid(), founderId, outputType, outputId,
      feedback.rating ?? null,
      feedback.feedback ?? null,
      feedback.too_long ? 1 : 0,
      feedback.too_short ? 1 : 0,
      feedback.too_technical ? 1 : 0,
      feedback.too_simple ? 1 : 0,
    ]
  );

  // Auto-adjust profile based on consistent feedback
  await autoAdjustFromFeedback(founderId);
}

// ─── Internal ───────────────────────────────────────────────────────────────

function buildCalibrationBlock(profile: FounderAIProfile): string {
  const rules: string[] = ['COMMUNICATION CALIBRATION:'];

  // Length
  switch (profile.preferred_length) {
    case 'short': rules.push('- Keep responses under 150 words. Lead with the answer. No preamble.'); break;
    case 'long': rules.push('- Provide thorough responses with full reasoning. 300-600 words is fine.'); break;
    default: rules.push('- Moderate length. 150-300 words. Balance brevity with context.'); break;
  }

  // Directness
  switch (profile.directness_level) {
    case 'blunt': rules.push('- Be blunt. No softening language. Say what you mean directly.'); break;
    case 'direct': rules.push('- Be direct. Lead with the recommendation. Spare the diplomacy.'); break;
    case 'gentle': rules.push('- Be supportive in tone. Frame challenges as opportunities. Acknowledge difficulty.'); break;
    default: rules.push('- Balanced tone. Direct but not harsh.'); break;
  }

  // Jargon
  switch (profile.jargon_level) {
    case 'none': rules.push('- No jargon, no acronyms. Explain everything in plain English. Assume no business background.'); break;
    case 'low': rules.push('- Minimal jargon. Define technical terms on first use. Prefer plain language.'); break;
    case 'high': rules.push('- Technical language welcome. Assume fluency in SaaS metrics and startup terminology.'); break;
    default: rules.push('- Moderate technical language. Use SaaS terms but define niche concepts.'); break;
  }

  // Encouragement
  switch (profile.encouragement_level) {
    case 'minimal': rules.push('- Skip praise. Just give the analysis. The founder doesn\'t need validation.'); break;
    case 'high': rules.push('- Acknowledge wins explicitly. Frame setbacks as learning. This founder benefits from encouragement.'); break;
    default: break;
  }

  // Decision framing
  switch (profile.decision_framing) {
    case 'recommendation_first': rules.push('- Always lead with your recommendation. Put options and reasoning after.'); break;
    case 'options_first': rules.push('- Present options first, then your recommendation. Let the founder see the landscape before your opinion.'); break;
    default: break;
  }

  // Data density
  switch (profile.data_density) {
    case 'low': rules.push('- Use narratives over numbers. Reference trends, not specific percentages.'); break;
    case 'high': rules.push('- Include specific numbers, percentages, and comparisons. This founder thinks in data.'); break;
    default: break;
  }

  // Psychology-aware adjustments
  for (const pattern of profile.active_psychology_patterns) {
    switch (pattern) {
      case 'perfectionism':
        rules.push('- This founder tends toward perfectionism. Explicitly encourage shipping over polishing. Use phrases like "good enough to learn from" and "the market will tell you."');
        break;
      case 'imposter_syndrome':
        rules.push('- This founder has imposter signals. Normalize their challenges. Reference that other founders face similar situations. Avoid comparisons to well-funded competitors.');
        break;
      case 'overcorrection':
        rules.push('- This founder overcorrects from past failures. Present balanced perspectives. When they avoid something entirely, gently note that moderation exists between extremes.');
        break;
      case 'empathy_scope_creep':
        rules.push('- This founder says yes to everything. Proactively ask "does this advance your positioning?" when they approve feature requests. Help them practice saying no.');
        break;
      case 'isolation_drift':
        rules.push('- This founder is isolated. Be warm. Reference the network. Suggest community engagement. Don\'t let conversations be purely transactional.');
        break;
    }
  }

  // Custom instructions
  if (profile.custom_instructions) {
    rules.push(`- Founder's custom instructions: ${profile.custom_instructions}`);
  }

  // Experience level
  switch (profile.experience_level) {
    case 'first_time':
      rules.push('- First-time founder. Explain concepts when introduced. Don\'t assume knowledge of fundraising, SaaS metrics, or go-to-market strategies.');
      break;
    case 'serial':
      rules.push('- Serial founder. Skip explanations of standard concepts. Focus on what\'s unique to their situation.');
      break;
    default: break;
  }

  return rules.join('\n');
}

async function autoCalibrate(founderId: string): Promise<FounderAIProfile> {
  const profile = { ...DEFAULT_PROFILE };

  // Check founder health for psychology patterns
  const psych = await query(
    `SELECT pattern_type FROM founder_psychology_insights WHERE founder_id = ? AND status = 'active'`,
    [founderId]
  );
  profile.active_psychology_patterns = (psych.rows as unknown as Array<Record<string, string>>).map((r) => r.pattern_type);

  // Check sector for jargon/tone.
  //
  // ONE ARBITRARY COMPANY USED TO SET THE TONE FOR ALL OF THEM. This was
  // `LIMIT 1` with no ORDER BY, so a founder running an education company and a
  // developer-tools company got whichever row SQLite returned first — and the
  // two rules below pull in opposite directions. The sector rule applies when
  // the founder's active companies agree; when they do not, the default stands,
  // because there is no single answer to give.
  const productsResult = await query(
    "SELECT DISTINCT sector_profile FROM products WHERE owner_id = ? AND status = 'active' AND sector_profile IS NOT NULL",
    [founderId]
  );
  const sectors = (productsResult.rows as Array<Record<string, string>>).map((r) => r.sector_profile);
  const sector = sectors.length === 1 ? sectors[0] : undefined;
  if (sector === 'education' || sector === 'government') {
    profile.jargon_level = 'low';
  }
  if (sector === 'developer_tools' || sector === 'deep_tech') {
    profile.jargon_level = 'high';
  }

  // Check engagement trend
  const health = await query('SELECT engagement_trend FROM founder_health WHERE founder_id = ?', [founderId]);
  const trend = (health.rows[0] as Record<string, string> | undefined)?.engagement_trend;
  if (trend === 'declining' || trend === 'critical') {
    profile.encouragement_level = 'high';
    profile.directness_level = 'gentle';
  }

  return profile;
}

async function autoAdjustFromFeedback(founderId: string): Promise<void> {
  // Count recent feedback signals
  const feedback = await query(
    `SELECT
       SUM(too_long) as long_count,
       SUM(too_short) as short_count,
       SUM(too_technical) as tech_count,
       SUM(too_simple) as simple_count,
       COUNT(*) as total
     FROM ai_output_feedback
     WHERE founder_id = ? AND created_at > datetime('now', '-30 days')`,
    [founderId]
  );

  const f = feedback.rows[0] as Record<string, number> | undefined;
  if (!f || f.total < 3) return; // Need at least 3 feedback signals

  const updates: Partial<FounderAIProfile> = {};

  if (f.long_count > f.total * 0.5) updates.preferred_length = 'short';
  if (f.short_count > f.total * 0.5) updates.preferred_length = 'long';
  if (f.tech_count > f.total * 0.5) updates.jargon_level = 'low';
  if (f.simple_count > f.total * 0.5) updates.jargon_level = 'high';

  if (Object.keys(updates).length > 0) {
    await updateAIProfile(founderId, updates);
  }
}
