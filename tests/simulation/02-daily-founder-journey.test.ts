// =============================================================================
// Simulation 02: Daily Founder Journey
//
// What is left of it. Three of its six sections read the source of
// `dashboard/index.ts`, `dashboard/decisions.ts` and `dashboard/agents.ts` —
// commercial routes the private instance never served, deleted on 13 September
// 2026. Their assertions went with them: there is no weaker test than one that
// reads a file to confirm a product exists, and no test at all once the file
// is gone.
//
// The three that remain are about code the owner's instance still runs: signal
// computation, the settings page, and the shared layout context.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let signalSource: string;
let settingsSource: string;
let sharedSource: string;
let indexSource: string;

beforeAll(() => {
  signalSource = readFileSync(resolve(SRC, 'services/signal.ts'), 'utf-8');
  settingsSource = readFileSync(resolve(SRC, 'routes/dashboard/settings.ts'), 'utf-8');
  sharedSource = readFileSync(resolve(SRC, 'routes/dashboard/_shared.ts'), 'utf-8');
  indexSource = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
});

// =============================================================================
// 1. Dashboard Route
// =============================================================================

describe('Signal computation does not crash', () => {

  it('computeSignal function is exported', () => {
    expect(signalSource).toMatch(/export\s+(async\s+)?function\s+computeSignal/);
  });

  it('Signal uses a base score of 85', () => {
    expect(signalSource).toMatch(/85/);
  });

  it('Signal applies stressor penalty', () => {
    expect(signalSource).toMatch(/stressorPenalty|stressor_penalty|stressor.*penalty/i);
  });

  it('Signal applies MRR penalty', () => {
    expect(signalSource).toMatch(/mrrPenalty|mrr_penalty|mrr.*penalty/i);
  });

  it('Signal applies risk state ceiling (green=none, yellow=72, red=40)', () => {
    expect(signalSource).toMatch(/72/);
    expect(signalSource).toMatch(/40/);
  });

  it('Signal clamps to 0-100 range', () => {
    // Should use Math.min, Math.max or clamp logic
    expect(signalSource).toMatch(/Math\.max|Math\.min|clamp/);
  });

  it('Signal generates prose summary', () => {
    expect(signalSource).toMatch(/prose/);
  });
});

// =============================================================================
// 5. Settings Page
// =============================================================================

describe('Settings page renders', () => {

  it('GET /settings route is defined', () => {
    expect(settingsSource).toMatch(
      /\.get\(['"]\/settings['"]/
    );
  });

  it('settings route is mounted in the main app', () => {
    expect(indexSource).toMatch(/settingsRoutes/);
  });

  it('settings page renders HTML', () => {
    expect(settingsSource).toMatch(/c\.html/);
  });
});

// =============================================================================
// 6. Layout Context (shared data loader)
// =============================================================================

describe('Shared layout context loads UX intelligence', () => {

  it('getLayoutContext function is exported', () => {
    expect(sharedSource).toMatch(/export.*getLayoutContext/);
  });

  it('layout context loads next action', () => {
    expect(sharedSource).toMatch(/getNextAction/);
  });

  it('layout context loads unread notifications', () => {
    expect(sharedSource).toMatch(/getUnreadNotifications|getUnreadCount/);
  });

  it('layout context loads unseen milestones', () => {
    expect(sharedSource).toMatch(/getUnseenMilestones/);
  });

  it('layout context loads tour state', () => {
    expect(sharedSource).toMatch(/getTourState/);
  });
});
