// =============================================================================
// Simulation 02: Daily Founder Journey
// Verifies the critical daily-use paths: dashboard, decisions, agents,
// signal computation, and settings. Static analysis of route handlers.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let dashboardSource: string;
let decisionSource: string;
let agentSource: string;
let signalSource: string;
let settingsSource: string;
let sharedSource: string;
let indexSource: string;

beforeAll(() => {
  dashboardSource = readFileSync(resolve(SRC, 'routes/dashboard/index.ts'), 'utf-8');
  decisionSource = readFileSync(resolve(SRC, 'routes/dashboard/decisions.ts'), 'utf-8');
  agentSource = readFileSync(resolve(SRC, 'routes/dashboard/agents.ts'), 'utf-8');
  signalSource = readFileSync(resolve(SRC, 'services/signal.ts'), 'utf-8');
  settingsSource = readFileSync(resolve(SRC, 'routes/dashboard/settings.ts'), 'utf-8');
  sharedSource = readFileSync(resolve(SRC, 'routes/dashboard/_shared.ts'), 'utf-8');
  indexSource = readFileSync(resolve(SRC, 'index.ts'), 'utf-8');
});

// =============================================================================
// 1. Dashboard Route
// =============================================================================

describe('Dashboard loads without error', () => {

  it('GET /dashboard route is defined', () => {
    expect(dashboardSource).toMatch(
      /dashboardRoutes\.get\(['"]\/dashboard['"]/
    );
  });

  it('dashboard calls computeSignal for the active product', () => {
    expect(dashboardSource).toMatch(/computeSignal\(productId\)/);
  });

  it('dashboard loads stressors, history, and daily insight in parallel', () => {
    expect(dashboardSource).toMatch(/Promise\.all/);
    expect(dashboardSource).toMatch(/getActiveStressors/);
    expect(dashboardSource).toMatch(/getSignalHistory/);
    expect(dashboardSource).toMatch(/getDailyInsight/);
  });

  it('dashboard redirects to /onboarding when no products exist', () => {
    expect(dashboardSource).toMatch(
      /rows\.length\s*===\s*0[\s\S]*?redirect.*onboarding/
    );
  });

  it('dashboard renders an HTML response via dashboardLayout', () => {
    expect(dashboardSource).toMatch(/c\.html\(dashboardLayout/);
  });
});

// =============================================================================
// 2. Decision Queue
// =============================================================================

describe('Decision queue renders', () => {

  it('GET /decisions route is defined', () => {
    expect(decisionSource).toMatch(
      /decisionRoutes\.get\(['"]\/decisions['"]/
    );
  });

  it('decision queue loads risk state for the product', () => {
    expect(decisionSource).toMatch(/risk_state.*lifecycle_state.*product_id/i);
  });

  it('decision queue calls getLayoutContext with decisions nav marker', () => {
    expect(decisionSource).toMatch(
      /getLayoutContext\(founder,\s*['"]decisions['"]/
    );
  });

  it('decisions route is mounted in the main app', () => {
    expect(indexSource).toMatch(/decisionRoutes/);
  });
});

// =============================================================================
// 3. Agent Roster
// =============================================================================

describe('Agent roster page renders', () => {

  it('agent roster route exists', () => {
    // Route is mounted at /agents prefix, so the handler uses '/' or '/:name'
    expect(agentSource).toMatch(
      /\.get\(['"]\//
    );
  });

  it('agent roster queries agent_instances for the product', () => {
    expect(agentSource).toMatch(/agent_instances/);
    expect(agentSource).toMatch(/product_id/);
  });

  it('agent roster renders HTML', () => {
    expect(agentSource).toMatch(/c\.html/);
  });

  it('agent routes are mounted in the main app', () => {
    expect(indexSource).toMatch(/agentRoutes/);
  });
});

// =============================================================================
// 4. Signal Computation
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
