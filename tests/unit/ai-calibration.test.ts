// =============================================================================
// Tests: AI Calibration — Prompt Composition
// =============================================================================

import { describe, it, expect } from 'vitest';

// Extract the calibration block builder for direct testing
type FounderAIProfile = {
  communication_style: string;
  preferred_length: 'short' | 'medium' | 'long';
  jargon_level: 'none' | 'low' | 'moderate' | 'high';
  encouragement_level: 'minimal' | 'balanced' | 'high';
  directness_level: 'gentle' | 'moderate' | 'direct' | 'blunt';
  data_density: 'low' | 'moderate' | 'high';
  decision_framing: 'options_first' | 'balanced' | 'recommendation_first';
  experience_level: 'first_time' | 'experienced' | 'serial';
  active_psychology_patterns: string[];
  custom_instructions: string | null;
};

function buildCalibrationBlock(profile: FounderAIProfile): string {
  const rules: string[] = ['COMMUNICATION CALIBRATION:'];

  switch (profile.preferred_length) {
    case 'short': rules.push('- Keep responses under 150 words.'); break;
    case 'long': rules.push('- Provide thorough responses.'); break;
    default: rules.push('- Moderate length.'); break;
  }

  switch (profile.directness_level) {
    case 'blunt': rules.push('- Be blunt.'); break;
    case 'direct': rules.push('- Be direct.'); break;
    case 'gentle': rules.push('- Be supportive in tone.'); break;
    default: rules.push('- Balanced tone.'); break;
  }

  switch (profile.jargon_level) {
    case 'none': rules.push('- No jargon.'); break;
    case 'low': rules.push('- Minimal jargon.'); break;
    case 'high': rules.push('- Technical language welcome.'); break;
    default: rules.push('- Moderate technical language.'); break;
  }

  for (const pattern of profile.active_psychology_patterns) {
    if (pattern === 'perfectionism') rules.push('- Encourage shipping over polishing.');
    if (pattern === 'imposter_syndrome') rules.push('- Normalize their challenges.');
    if (pattern === 'isolation_drift') rules.push('- Be warm. Reference the network.');
  }

  if (profile.experience_level === 'first_time') {
    rules.push('- First-time founder. Explain concepts.');
  }
  if (profile.experience_level === 'serial') {
    rules.push('- Serial founder. Skip explanations.');
  }

  if (profile.custom_instructions) {
    rules.push(`- Custom: ${profile.custom_instructions}`);
  }

  return rules.join('\n');
}

const defaultProfile: FounderAIProfile = {
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

describe('AI calibration block', () => {
  it('produces default calibration for standard profile', () => {
    const block = buildCalibrationBlock(defaultProfile);
    expect(block).toContain('COMMUNICATION CALIBRATION');
    expect(block).toContain('Moderate length');
    expect(block).toContain('Balanced tone');
    expect(block).not.toContain('First-time');
    expect(block).not.toContain('perfectionism');
  });

  it('adapts for first-time founders', () => {
    const block = buildCalibrationBlock({ ...defaultProfile, experience_level: 'first_time', jargon_level: 'none' });
    expect(block).toContain('First-time founder');
    expect(block).toContain('No jargon');
  });

  it('adapts for serial founders', () => {
    const block = buildCalibrationBlock({ ...defaultProfile, experience_level: 'serial', directness_level: 'blunt' });
    expect(block).toContain('Serial founder');
    expect(block).toContain('Be blunt');
  });

  it('injects psychology pattern instructions', () => {
    const block = buildCalibrationBlock({
      ...defaultProfile,
      active_psychology_patterns: ['perfectionism', 'imposter_syndrome'],
    });
    expect(block).toContain('shipping over polishing');
    expect(block).toContain('Normalize their challenges');
  });

  it('includes custom instructions', () => {
    const block = buildCalibrationBlock({ ...defaultProfile, custom_instructions: 'Always mention deadlines' });
    expect(block).toContain('Always mention deadlines');
  });

  it('combines multiple adaptations', () => {
    const block = buildCalibrationBlock({
      ...defaultProfile,
      preferred_length: 'short',
      directness_level: 'direct',
      jargon_level: 'high',
      experience_level: 'serial',
      active_psychology_patterns: ['isolation_drift'],
    });
    expect(block).toContain('under 150 words');
    expect(block).toContain('Be direct');
    expect(block).toContain('Technical language welcome');
    expect(block).toContain('Serial founder');
    expect(block).toContain('Be warm');
  });
});
