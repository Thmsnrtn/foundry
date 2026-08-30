process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';
import { CONFIG_TYPES, isConfigType } from '../../src/services/scp/agent-config.js';

// =============================================================================
// A WORD THAT BOUGHT AN EXEMPTION FROM THE FREEZE.
//
// `agent_configs.config_type` permits six values. The evolution prompt asks a
// language model for one of them and adds "configType must be one of the 6
// valid types" — a constraint stated in English, to the model, and enforced in
// no code: `applyConfigChange` took `configType: string`, and the `ConfigType`
// union and `CONFIG_TYPES` array had both existed since evolution v2 with no
// reader.
//
// The damage was not the failed INSERT. `classifyEvolutionChange` mapped
// `'behavioral_constraints'` to `'tightening'`, and `'tightening'` is on the
// freeze gate's `alwaysAllowed` list — so a word the model chose selected a
// category the freeze never blocks, thirty lines before the column would have
// refused to store it. A control that exists to halt change was consulted, and
// answered, on a value that could not exist.
//
// The classifier and the column shared no vocabulary at all: not one of
// 'system_prompt', 'behavioral_constraints', 'domain_context' or
// 'system_prompt_core' is a storable config type.
// =============================================================================

describe('a config type is asked before it is believed', () => {
  it('accepts every value the column will store', () => {
    for (const t of CONFIG_TYPES) expect(isConfigType(t), t).toBe(true);
  });

  it('refuses the words the classifier used to be written against', () => {
    // The exact vocabulary the old classifier and its test traded in. None of
    // it can be stored, and 'behavioral_constraints' is the one that bought the
    // exemption.
    for (const w of ['behavioral_constraints', 'system_prompt', 'domain_context',
                     'system_prompt_core', 'decision_framework', 'any_future_type']) {
      expect(isConfigType(w), `${w} is not a storable config type`).toBe(false);
    }
  });

  it('refuses a non-string, rather than throwing on one', () => {
    for (const v of [null, undefined, 42, {}, ['persona']]) expect(isConfigType(v)).toBe(false);
  });
});

describe('the refusal happens before anything acts on the word', () => {
  it('guards the config type ahead of the freeze check, not after it', () => {
    // ORDER IS THE WHOLE FIX. Validating after `isBlocked` would leave the
    // freeze gate answering on a value that cannot exist, which is the defect.
    const src = stripComments(
      readFileSync(resolve(import.meta.dirname, '../../src/services/scp/evolution.ts'), 'utf8'));
    const guard = src.indexOf('isConfigType(proposed.configType)');
    const classify = src.indexOf('classifyEvolutionChange(proposed.configType');
    const freeze = src.indexOf('await isBlocked(productId, category)');

    expect(guard, 'the configType guard is gone').toBeGreaterThan(-1);
    expect(classify, 'the classify call moved').toBeGreaterThan(-1);
    expect(freeze, 'the freeze check moved').toBeGreaterThan(-1);
    expect(guard, 'the guard must precede the classification').toBeLessThan(classify);
    expect(guard, 'the guard must precede the freeze check').toBeLessThan(freeze);
  });

  it('still treats tightening as always allowed, so the exemption is real', async () => {
    // If this ever stops being true the finding above stops mattering — and the
    // test would otherwise quietly pass for the wrong reason.
    const src = readFileSync(
      resolve(import.meta.dirname, '../../src/services/discipline/freeze-periods.ts'), 'utf8');
    expect(/alwaysAllowed[\s\S]{0,200}'tightening'/.test(src),
      'tightening is no longer freeze-exempt; re-read what this test defends').toBe(true);
  });
});
