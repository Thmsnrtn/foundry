// =============================================================================
// FOUNDRY — Circuit Breaker
// Prevents cascading failures by tracking external service health.
// =============================================================================

import { log } from './logger.js';

interface CircuitState {
  failures: number;
  lastFailure: number;
  lastSuccess: number;
  state: 'closed' | 'open' | 'half-open';
}

const circuits = new Map<string, CircuitState>();

interface CircuitBreakerConfig {
  failureThreshold: number;     // failures before opening
  resetTimeoutMs: number;       // time before half-open retry
  name: string;                 // circuit identifier
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  name: 'default',
};

function getState(name: string): CircuitState {
  if (!circuits.has(name)) {
    circuits.set(name, { failures: 0, lastFailure: 0, lastSuccess: Date.now(), state: 'closed' });
  }
  return circuits.get(name)!;
}

/**
 * Execute a function with circuit breaker protection.
 * If the circuit is open, throws immediately without calling the function.
 * After resetTimeout, allows a single test request (half-open).
 */
export async function withCircuitBreaker<T>(
  fn: () => Promise<T>,
  config: Partial<CircuitBreakerConfig> & { name: string },
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const state = getState(cfg.name);
  const now = Date.now();

  // Check if circuit is open
  if (state.state === 'open') {
    if (now - state.lastFailure > cfg.resetTimeoutMs) {
      // Transition to half-open: allow one test request
      state.state = 'half-open';
      log.info(`Circuit ${cfg.name} transitioning to half-open`);
    } else {
      throw new Error(`Circuit breaker ${cfg.name} is OPEN — service unavailable`);
    }
  }

  try {
    const result = await fn();
    // Success: reset circuit
    state.failures = 0;
    state.lastSuccess = now;
    if (state.state === 'half-open') {
      state.state = 'closed';
      log.info(`Circuit ${cfg.name} closed — service recovered`);
    }
    return result;
  } catch (err) {
    state.failures++;
    state.lastFailure = now;

    if (state.failures >= cfg.failureThreshold || state.state === 'half-open') {
      state.state = 'open';
      log.warn(`Circuit ${cfg.name} OPENED after ${state.failures} failures`, {
        circuit: cfg.name,
        failures: state.failures,
      });
    }

    throw err;
  }
}

/**
 * Get the current state of all circuit breakers (for health check).
 */
export function getCircuitStates(): Record<string, { state: string; failures: number; lastFailure: string }> {
  const result: Record<string, { state: string; failures: number; lastFailure: string }> = {};
  for (const [name, state] of circuits) {
    result[name] = {
      state: state.state,
      failures: state.failures,
      lastFailure: state.lastFailure ? new Date(state.lastFailure).toISOString() : 'never',
    };
  }
  return result;
}
