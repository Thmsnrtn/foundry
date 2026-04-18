// =============================================================================
// FOUNDRY — Validation Schema Tests
// Ensures all input validation schemas correctly accept/reject data.
// =============================================================================

import { describe, it, expect } from 'vitest';
import {
  reportMetricsSchema,
  resolveDecisionSchema,
  recordOutcomeSchema,
  selectRepoSchema,
  addCompetitorSchema,
  betaIntakeSchema,
  productDNAUpdateSchema,
  preferencesSchema,
  failureLogSchema,
  validate,
} from './validation.js';

describe('reportMetricsSchema', () => {
  it('accepts valid metrics', () => {
    const data = {
      signups_7d: 42,
      active_users: 100,
      new_mrr_cents: 9900,
      churned_mrr_cents: 500,
      activation_rate: 0.65,
      day_30_retention: 0.45,
      churn_rate: 0.05,
    };
    expect(() => validate(reportMetricsSchema, data)).not.toThrow();
  });

  it('accepts empty object (all fields optional)', () => {
    expect(() => validate(reportMetricsSchema, {})).not.toThrow();
  });

  it('rejects negative signups', () => {
    expect(() => validate(reportMetricsSchema, { signups_7d: -1 })).toThrow();
  });

  it('rejects activation_rate > 1', () => {
    expect(() => validate(reportMetricsSchema, { activation_rate: 1.5 })).toThrow();
  });

  it('rejects string values for numbers', () => {
    expect(() => validate(reportMetricsSchema, { new_mrr_cents: 'abc' })).toThrow();
  });

  it('rejects NPS score outside range', () => {
    expect(() => validate(reportMetricsSchema, { nps_score: 150 })).toThrow();
    expect(() => validate(reportMetricsSchema, { nps_score: -150 })).toThrow();
  });
});

describe('resolveDecisionSchema', () => {
  it('accepts valid resolve', () => {
    const data = { chosen_option: 'Option A', resolution_reasoning: 'Because reasons' };
    expect(() => validate(resolveDecisionSchema, data)).not.toThrow();
  });

  it('requires chosen_option', () => {
    expect(() => validate(resolveDecisionSchema, {})).toThrow();
  });

  it('rejects empty chosen_option', () => {
    expect(() => validate(resolveDecisionSchema, { chosen_option: '' })).toThrow();
  });

  it('accepts without resolution_reasoning', () => {
    expect(() => validate(resolveDecisionSchema, { chosen_option: 'A' })).not.toThrow();
  });
});

describe('recordOutcomeSchema', () => {
  it('accepts valid outcome', () => {
    expect(() => validate(recordOutcomeSchema, { outcome: 'It worked great' })).not.toThrow();
  });

  it('rejects empty outcome', () => {
    expect(() => validate(recordOutcomeSchema, { outcome: '' })).toThrow();
  });

  it('rejects missing outcome', () => {
    expect(() => validate(recordOutcomeSchema, {})).toThrow();
  });
});

describe('selectRepoSchema', () => {
  it('accepts valid repo selection', () => {
    const data = {
      repo_owner: 'my-org',
      repo_name: 'my-app',
      access_token: 'ghp_xxxx',
    };
    expect(() => validate(selectRepoSchema, data)).not.toThrow();
  });

  it('rejects repo_owner with special characters', () => {
    expect(() => validate(selectRepoSchema, {
      repo_owner: '../etc',
      repo_name: 'app',
      access_token: 'ghp_x',
    })).toThrow();
  });

  it('rejects missing access_token', () => {
    expect(() => validate(selectRepoSchema, {
      repo_owner: 'org',
      repo_name: 'app',
    })).toThrow();
  });
});

describe('addCompetitorSchema', () => {
  it('accepts valid competitor', () => {
    expect(() => validate(addCompetitorSchema, { name: 'Acme Corp' })).not.toThrow();
  });

  it('accepts competitor with optional fields', () => {
    const data = {
      name: 'Acme Corp',
      website: 'https://acme.com',
      positioning: 'Enterprise-first',
    };
    expect(() => validate(addCompetitorSchema, data)).not.toThrow();
  });

  it('rejects empty name', () => {
    expect(() => validate(addCompetitorSchema, { name: '' })).toThrow();
  });

  it('rejects invalid website URL', () => {
    expect(() => validate(addCompetitorSchema, {
      name: 'Acme',
      website: 'not-a-url',
    })).toThrow();
  });
});

describe('productDNAUpdateSchema', () => {
  it('accepts valid DNA fields', () => {
    expect(() => validate(productDNAUpdateSchema, {
      icp_description: 'SaaS founders',
      positioning_statement: 'Best product ever',
    })).not.toThrow();
  });

  it('rejects unknown fields (SQL injection protection)', () => {
    expect(() => validate(productDNAUpdateSchema, {
      'id; DROP TABLE products': 'pwned',
    })).toThrow();
  });

  it('rejects non-whitelisted fields', () => {
    expect(() => validate(productDNAUpdateSchema, {
      owner_id: 'stolen-id',
    })).toThrow();
  });
});

describe('preferencesSchema', () => {
  it('accepts valid preferences', () => {
    expect(() => validate(preferencesSchema, {
      digest_time: '09:00',
      timezone: 'America/New_York',
      notification_channels: ['email', 'dashboard'],
    })).not.toThrow();
  });

  it('rejects invalid digest_time format', () => {
    expect(() => validate(preferencesSchema, { digest_time: '9am' })).toThrow();
  });

  it('rejects invalid notification channel', () => {
    expect(() => validate(preferencesSchema, {
      notification_channels: ['sms'],
    })).toThrow();
  });
});

describe('failureLogSchema', () => {
  it('accepts valid failure log', () => {
    const data = {
      category: 'pricing',
      what_was_tried: 'Raised prices by 50%',
      outcome: 'Churn spiked',
    };
    expect(() => validate(failureLogSchema, data)).not.toThrow();
  });

  it('rejects invalid category', () => {
    expect(() => validate(failureLogSchema, {
      category: 'invalid_category',
      what_was_tried: 'Something',
      outcome: 'Something',
    })).toThrow();
  });
});

describe('validate helper', () => {
  it('returns parsed data on success', () => {
    const result = validate(recordOutcomeSchema, { outcome: 'Great' });
    expect(result.outcome).toBe('Great');
  });

  it('throws with status 400', () => {
    try {
      validate(recordOutcomeSchema, {});
      expect.unreachable('Should have thrown');
    } catch (err: any) {
      expect(err.status).toBe(400);
      expect(err.issues).toBeDefined();
    }
  });
});
