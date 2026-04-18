// =============================================================================
// Simulation 05: Multi-Tenancy Integrity
// Verifies every data access path enforces tenant isolation.
// Static analysis of db/client.ts, portfolio, experiment, voice, and
// decision_patterns — the cross-company data contract.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const SRC = resolve(__dirname, '../../src');

let clientSource: string;
let portfolioSource: string;
let experimentSource: string;
let voiceBriefingSource: string;
let voiceProcessorSource: string;
let schemaSource: string;
let tenantMiddlewareSource: string;
let authMiddlewareSource: string;

beforeAll(() => {
  clientSource = readFileSync(resolve(SRC, 'db/client.ts'), 'utf-8');
  portfolioSource = readFileSync(resolve(SRC, 'services/portfolio/manager.ts'), 'utf-8');
  experimentSource = readFileSync(resolve(SRC, 'services/experiments/engine.ts'), 'utf-8');
  voiceBriefingSource = readFileSync(resolve(SRC, 'services/voice/briefing.ts'), 'utf-8');
  voiceProcessorSource = readFileSync(resolve(SRC, 'services/voice/processor.ts'), 'utf-8');
  schemaSource = readFileSync(resolve(SRC, 'db/schema.sql'), 'utf-8');
  tenantMiddlewareSource = readFileSync(resolve(SRC, 'middleware/tenant.ts'), 'utf-8');
  authMiddlewareSource = readFileSync(resolve(SRC, 'middleware/auth.ts'), 'utf-8');
});

/**
 * Extract a function body from source code by name.
 */
function extractFunction(source: string, name: string): string {
  const pattern = new RegExp(
    `export\\s+(async\\s+)?function\\s+${name}[\\s\\S]*?(?=export\\s+(async\\s+)?function|$)`
  );
  const match = source.match(pattern);
  if (!match) throw new Error(`Function ${name} not found in source`);
  return match[0];
}

/**
 * Extract SQL strings within a function body.
 * Handles both regular strings ('/"`) and template literals (backtick).
 */
function extractSQL(fnBody: string): string {
  const matches: string[] = [];

  // Match single/double-quoted SQL
  const quoted = fnBody.match(
    /(['"])(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?\1/gi
  );
  if (quoted) matches.push(...quoted);

  // Match backtick template literal SQL
  const backtick = fnBody.match(
    /`(?:SELECT|INSERT|UPDATE|DELETE)[\s\S]*?`/gi
  );
  if (backtick) matches.push(...backtick);

  return matches.join(' ');
}

// =============================================================================
// 1. Every Exported Query Function Scopes by Owner/Product
// =============================================================================

describe('All exported db/client.ts queries enforce tenant scoping', () => {

  const INTENTIONALLY_UNSCOPED = new Set([
    'getDb',
    'query',
    'batch',
    'executeRaw',
    'getRelevantPatterns',
    'getAllActiveProducts',
  ]);

  const INSERT_OPERATIONS = new Set([
    'insertAuditLog',
  ]);

  it('every SELECT query helper has a WHERE clause', () => {
    const exportedFns = clientSource.match(
      /export\s+async\s+function\s+(\w+)/g
    );
    expect(exportedFns).toBeTruthy();

    for (const match of exportedFns!) {
      const fnName = match.replace(/export\s+async\s+function\s+/, '');
      if (INTENTIONALLY_UNSCOPED.has(fnName)) continue;
      if (INSERT_OPERATIONS.has(fnName)) continue;

      const fn = extractFunction(clientSource, fnName);
      const sql = extractSQL(fn);
      if (!sql || !/SELECT/i.test(sql)) continue;

      expect(
        sql,
        `${fnName} has SELECT without WHERE — potential tenant data leak`
      ).toMatch(/WHERE/i);
    }
  });

  it('insertAuditLog includes product_id in the INSERT', () => {
    const fn = extractFunction(clientSource, 'insertAuditLog');
    expect(fn).toMatch(/INSERT\s+INTO\s+audit_log\s*\([^)]*product_id/i);
  });

  it('getProductByOwner requires both productId and founderId', () => {
    const fn = extractFunction(clientSource, 'getProductByOwner');
    expect(fn).toMatch(/productId:\s*string,\s*founderId:\s*string/);
    const sql = extractSQL(fn);
    expect(sql).toMatch(/owner_id\s*=\s*\?/);
  });
});

// =============================================================================
// 2. Portfolio API Has Ownership Checks
// =============================================================================

describe('Portfolio API has ownership checks', () => {

  it('getPortfolioOverview scopes by portfolio_id', () => {
    const fn = extractFunction(portfolioSource, 'getPortfolioOverview');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/WHERE.*portfolio_id\s*=\s*\?/i);
  });

  it('addToPortfolio requires both portfolioId and founderId', () => {
    const fn = extractFunction(portfolioSource, 'addToPortfolio');
    expect(fn).toMatch(/portfolioId:\s*string/);
    expect(fn).toMatch(/founderId:\s*string/);
  });

  it('removeFromPortfolio scopes by portfolio_id AND product_id', () => {
    const fn = extractFunction(portfolioSource, 'removeFromPortfolio');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/portfolio_id\s*=\s*\?/);
    expect(sql).toMatch(/product_id\s*=\s*\?/);
  });

  it('benchmarkProduct scopes by portfolio_id', () => {
    const fn = extractFunction(portfolioSource, 'benchmarkProduct');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/portfolio_id\s*=\s*\?/i);
  });

  it('authenticatePortfolioKey queries by api_key (not id)', () => {
    const fn = extractFunction(portfolioSource, 'authenticatePortfolioKey');
    expect(fn).toMatch(/api_key\s*=\s*\?/);
  });

  it('portfolio API keys use prefixed format (pfk_*)', () => {
    expect(portfolioSource).toMatch(/pfk_/);
  });
});

// =============================================================================
// 3. Experiment API Has Ownership Checks
// =============================================================================

describe('Experiment API has ownership checks', () => {

  it('createExperiment includes product_id and owner_id', () => {
    const fn = extractFunction(experimentSource, 'createExperiment');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/product_id/);
    expect(sql).toMatch(/owner_id/);
  });

  it('getActiveExperiments scopes by product_id', () => {
    const fn = extractFunction(experimentSource, 'getActiveExperiments');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('designExperiment accepts productId parameter', () => {
    const fn = extractFunction(experimentSource, 'designExperiment');
    expect(fn).toMatch(/productId:\s*string/);
  });

  it('experiment events reference experiment_id (FK-chained to product)', () => {
    const fn = extractFunction(experimentSource, 'recordExperimentEvent');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/experiment_id/);
  });
});

// =============================================================================
// 4. Voice API Has Ownership Checks
// =============================================================================

describe('Voice API has ownership checks', () => {

  it('generateMorningBriefing accepts productId and founderId', () => {
    const fn = extractFunction(voiceBriefingSource, 'generateMorningBriefing');
    expect(fn).toMatch(/productId:\s*string/);
    expect(fn).toMatch(/founderId:\s*string/);
  });

  it('generateMorningBriefing queries voice_sessions by product_id', () => {
    const fn = extractFunction(voiceBriefingSource, 'generateMorningBriefing');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('processVoiceTranscript persists by session_id', () => {
    const fn = extractFunction(voiceBriefingSource, 'processVoiceTranscript');
    const sql = extractSQL(fn);
    expect(sql).toMatch(/WHERE.*id\s*=\s*\?/i);
  });

  it('processVoiceMemo scopes by founder_id and product_id', () => {
    const fn = extractFunction(voiceProcessorSource, 'processVoiceMemo');
    expect(fn).toMatch(/founderId:\s*string/);
    expect(fn).toMatch(/productId:\s*string/);
    const sql = extractSQL(fn);
    expect(sql).toMatch(/founder_id/);
    expect(sql).toMatch(/product_id/);
  });

  it('voice decisions are inserted scoped to product_id', () => {
    const fn = extractFunction(voiceProcessorSource, 'processVoiceMemo');
    const sql = extractSQL(fn);
    // Decisions created from voice should include product_id
    expect(sql).toMatch(/INSERT INTO decisions.*product_id/i);
  });
});

// =============================================================================
// 5. Decision Patterns Has No Product ID (Cross-Company by Design)
// =============================================================================

describe('decision_patterns is intentionally unscoped (anonymized)', () => {

  it('decision_patterns table has no product_id column', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    expect(tableMatch![0]).not.toMatch(/\bproduct_id\b/i);
  });

  it('decision_patterns table has no founder_id column', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    expect(tableMatch![0]).not.toMatch(/\bfounder_id\b/i);
  });

  it('decision_patterns table has no owner_id column', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    expect(tableMatch![0]).not.toMatch(/\bowner_id\b/i);
  });

  it('decision_patterns has no REFERENCES to products or founders', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    expect(tableMatch![0]).not.toMatch(/REFERENCES\s+products/i);
    expect(tableMatch![0]).not.toMatch(/REFERENCES\s+founders/i);
  });

  it('getRelevantPatterns does not filter by product_id or owner_id', () => {
    const fn = extractFunction(clientSource, 'getRelevantPatterns');
    const sql = extractSQL(fn);
    expect(sql).not.toMatch(/\bproduct_id\s*=\s*\?/i);
    expect(sql).not.toMatch(/\bowner_id\s*=\s*\?/i);
  });

  it('schema documents decision_patterns as intentionally cross-product', () => {
    expect(schemaSource).toMatch(/decision_patterns.*intentionally.*cross.product|Exception.*decision_patterns/i);
  });
});

// =============================================================================
// 6. Cross-Company Data Contract Enforcement
// =============================================================================

describe('Cross-company data contract enforcement', () => {

  it('tenant middleware verifies product ownership via getProductByOwner', () => {
    expect(tenantMiddlewareSource).toMatch(/getProductByOwner/);
  });

  it('tenant middleware returns 404 for non-owned products (not 403)', () => {
    expect(tenantMiddlewareSource).toMatch(/404/);
    // After the ownership check (rows.length === 0), there should be a 404 response
    const ownershipBlock = tenantMiddlewareSource.match(
      /rows\.length\s*===\s*0[\s\S]*?c\.json\([^)]+,\s*404\s*\)/
    );
    expect(ownershipBlock).toBeTruthy();
  });

  it('auth middleware resolves founder from Clerk JWT (not from query params)', () => {
    expect(authMiddlewareSource).toMatch(/getFounderByClerkId/);
    expect(authMiddlewareSource).not.toMatch(/req\.query.*founder_id|req\.params.*founder_id/i);
  });

  it('auth middleware auto-provisions founders with ON CONFLICT DO NOTHING', () => {
    expect(authMiddlewareSource).toMatch(/ON CONFLICT.*DO NOTHING/i);
  });

  it('products table has owner_id foreign key to founders', () => {
    expect(schemaSource).toMatch(
      /products[\s\S]*?owner_id\s+TEXT\s+NOT NULL\s+REFERENCES\s+founders\(id\)/i
    );
  });
});
