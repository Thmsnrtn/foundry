// =============================================================================
// Tests: Multi-Tenancy Isolation (Phase 7)
// Static analysis tests that verify every DB query, middleware, and schema
// enforces tenant scoping. A cross-tenant data leak is existential.
// =============================================================================

import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ─── Source Code Loading ────────────────────────────────────────────────────
// Read source files once for all tests. These are static analysis tests
// that verify SQL strings and middleware logic without hitting the DB.

let clientSource: string;
let tenantSource: string;
let authSource: string;
let schemaSource: string;

beforeAll(() => {
  const base = resolve(__dirname, '../../src');
  clientSource = readFileSync(resolve(base, 'db/client.ts'), 'utf-8');
  tenantSource = readFileSync(resolve(base, 'middleware/tenant.ts'), 'utf-8');
  authSource = readFileSync(resolve(base, 'middleware/auth.ts'), 'utf-8');
  schemaSource = readFileSync(resolve(base, 'db/schema.sql'), 'utf-8');
});

/**
 * Extract a function body from source code by name.
 * Matches from the function declaration to the next `export` keyword or EOF.
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
 * Extract the SQL string(s) within a function body.
 */
function extractSQL(fnBody: string): string {
  // Match template literals and regular string literals containing SQL keywords
  const sqlMatches = fnBody.match(/(['"`])SELECT[\s\S]*?\1|(['"`])INSERT[\s\S]*?\1|(['"`])UPDATE[\s\S]*?\1|(['"`])DELETE[\s\S]*?\1/gi);
  return sqlMatches ? sqlMatches.join(' ') : '';
}

// =============================================================================
// 1. DATABASE TENANT ISOLATION — Every query must scope by owner or product
// =============================================================================

describe('Database tenant isolation', () => {

  // ── Owner-Scoped Queries ────────────────────────────────────────────────

  it('getProductsByOwner scopes by founder ID (owner_id)', () => {
    const fn = extractFunction(clientSource, 'getProductsByOwner');
    expect(fn).toMatch(/WHERE.*owner_id\s*=\s*\?/i);
  });

  it('getProductsByOwner excludes archived products', () => {
    const fn = extractFunction(clientSource, 'getProductsByOwner');
    expect(fn).toMatch(/status\s*!=\s*\?.*archived|archived/i);
  });

  it('getProductByOwner scopes by BOTH product ID and owner ID', () => {
    const fn = extractFunction(clientSource, 'getProductByOwner');
    const sql = extractSQL(fn);
    // Must contain both id = ? and owner_id = ? in WHERE clause
    expect(sql).toMatch(/WHERE/i);
    expect(sql).toMatch(/id\s*=\s*\?/);
    expect(sql).toMatch(/owner_id\s*=\s*\?/);
  });

  it('getProductByOwner requires two parameters (productId and founderId)', () => {
    const fn = extractFunction(clientSource, 'getProductByOwner');
    expect(fn).toMatch(/productId:\s*string,\s*founderId:\s*string/);
  });

  it('getFounderByClerkId scopes by clerk_user_id', () => {
    const fn = extractFunction(clientSource, 'getFounderByClerkId');
    expect(fn).toMatch(/WHERE.*clerk_user_id\s*=\s*\?/i);
  });

  // ── Product-Scoped Queries ──────────────────────────────────────────────

  it('getLifecycleState scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getLifecycleState');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getLatestAudit scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getLatestAudit');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getPriorAudit scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getPriorAudit');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getPendingDecisions scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getPendingDecisions');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getActiveStressors scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getActiveStressors');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getMetricSnapshots scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getMetricSnapshots');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getLatestMetrics scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getLatestMetrics');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getCohorts scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getCohorts');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getCompetitors scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getCompetitors');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getCompetitiveSignals scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getCompetitiveSignals');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getAuditLog scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getAuditLog');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('countGate0DecisionsWithOutcomes scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'countGate0DecisionsWithOutcomes');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getStoryArtifacts scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getStoryArtifacts');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getBetaIntakes scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getBetaIntakes');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  it('getLifecycleConditions scopes by product_id', () => {
    const fn = extractFunction(clientSource, 'getLifecycleConditions');
    expect(fn).toMatch(/WHERE.*product_id\s*=\s*\?/i);
  });

  // ── Insert Operations — Must Include product_id ─────────────────────────

  it('insertAuditLog includes product_id in INSERT', () => {
    const fn = extractFunction(clientSource, 'insertAuditLog');
    expect(fn).toMatch(/INSERT\s+INTO\s+audit_log/i);
    expect(fn).toMatch(/product_id/);
  });

  it('insertAuditLog requires product_id parameter', () => {
    const fn = extractFunction(clientSource, 'insertAuditLog');
    expect(fn).toMatch(/product_id:\s*string/);
  });

  // ── Scenario Models — Indirect Scoping Via Decision FK ──────────────────

  it('getScenarioModels scopes by decision_id (FK-chained to product)', () => {
    const fn = extractFunction(clientSource, 'getScenarioModels');
    expect(fn).toMatch(/WHERE.*decision_id\s*=\s*\?/i);
  });
});

// =============================================================================
// 2. CROSS-COMPANY DATA ANONYMIZATION — decision_patterns must have no PII
// =============================================================================

describe('Cross-company data anonymization (decision_patterns)', () => {

  it('decision_patterns table has no product_id column', () => {
    // Extract the CREATE TABLE block for decision_patterns
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    const tableDefinition = tableMatch![0];
    // There should be no product_id column defined
    expect(tableDefinition).not.toMatch(/\bproduct_id\b/i);
  });

  it('decision_patterns table has no founder_id column', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    const tableDefinition = tableMatch![0];
    expect(tableDefinition).not.toMatch(/\bfounder_id\b/i);
  });

  it('decision_patterns table has no owner_id column', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    const tableDefinition = tableMatch![0];
    expect(tableDefinition).not.toMatch(/\bowner_id\b/i);
  });

  it('decision_patterns table has no product name column', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    const tableDefinition = tableMatch![0];
    // Should not have a column named "product_name" or "name"
    // (it should only have anonymized fields like decision_type, lifecycle_stage, etc.)
    expect(tableDefinition).not.toMatch(/\bproduct_name\b/i);
    // Check that "name" is not a standalone column (it can appear in column names like "option_chosen_category")
    const columns = tableDefinition.match(/^\s+\w+\s+TEXT/gm) || [];
    const hasNameColumn = columns.some((col) => /^\s+name\s+/i.test(col));
    expect(hasNameColumn).toBe(false);
  });

  it('decision_patterns table has no REFERENCES to products table', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    const tableDefinition = tableMatch![0];
    expect(tableDefinition).not.toMatch(/REFERENCES\s+products/i);
  });

  it('decision_patterns table has no REFERENCES to founders table', () => {
    const tableMatch = schemaSource.match(
      /CREATE TABLE[^;]*decision_patterns\s*\([\s\S]*?\);/i
    );
    expect(tableMatch).toBeTruthy();
    const tableDefinition = tableMatch![0];
    expect(tableDefinition).not.toMatch(/REFERENCES\s+founders/i);
  });

  it('getRelevantPatterns query does NOT filter by product_id or owner_id', () => {
    const fn = extractFunction(clientSource, 'getRelevantPatterns');
    const sql = extractSQL(fn);
    // This query is intentionally cross-tenant — it reads anonymized patterns
    expect(sql).not.toMatch(/\bproduct_id\s*=\s*\?/i);
    expect(sql).not.toMatch(/\bowner_id\s*=\s*\?/i);
    expect(sql).not.toMatch(/\bfounder_id\s*=\s*\?/i);
  });

  it('carries a keyed contributor hash, never a raw identifier', () => {
    // Migration 144 gave `decision_patterns` a contributor_hash so the wisdom
    // aggregation could require k DISTINCT companies — full anonymity had cost
    // it the ability to tell three companies from one, and an insight derived
    // from a single company was publishable to that company's competitors.
    //
    // The column must stay a KEYED hash. A plain hash of a product id is
    // reversible by anyone who can enumerate ids, which is everyone who has the
    // products table, and would turn this row back into an identified one.
    const patterns = readFileSync(
      resolve(__dirname, '../../src/services/wisdom/network.ts'), 'utf-8');
    expect(patterns).toMatch(/createHmac\(/);
    expect(patterns, 'the hash must be keyed with the application secret')
      .toMatch(/process\.env\.ENCRYPTION_KEY/);
    expect(patterns, 'an unkeyed digest of a product id is not anonymous')
      .not.toMatch(/createHash\(['"]sha256['"]\)\.update\(productId/);

    // And the row still names nobody.
    expect(schemaSource.includes('contributor_hash')
      || readFileSync(resolve(__dirname, '../../src/db/migrations/144_pattern_contributor_hash.sql'), 'utf-8')
        .includes('contributor_hash')).toBe(true);
  });

  it('getRelevantPatterns is documented as intentionally cross-tenant', () => {
    // The JSDoc comment above the function documents the design decision
    // Look for the comment block preceding the function
    const commentAndFn = clientSource.match(
      /\/\*\*[\s\S]*?\*\/\s*export\s+async\s+function\s+getRelevantPatterns/
    );
    expect(commentAndFn).toBeTruthy();
    expect(commentAndFn![0]).toMatch(/NOT\s+tenant.scoped|not\s+tenant|intentionally|cross.product/i);
  });
});

// =============================================================================
// 3. TENANT MIDDLEWARE — Must enforce ownership and return 404 (not 403)
// =============================================================================

describe('Tenant middleware isolation', () => {

  it('tenant middleware calls getProductByOwner to verify ownership', () => {
    expect(tenantSource).toMatch(/getProductByOwner/);
  });

  it('tenant middleware imports getProductByOwner from db/client', () => {
    expect(tenantSource).toMatch(/import\s*\{[^}]*getProductByOwner[^}]*\}\s*from\s*['"].*db\/client/);
  });

  it('tenant middleware passes both productId and founder.id to ownership check', () => {
    expect(tenantSource).toMatch(/getProductByOwner\(\s*productId\s*,\s*founder\.id\s*\)/);
  });

  it('returns 404 (not 403) for non-owned products — no information leak', () => {
    // Must return 404 when product is not found (prevents enumeration)
    expect(tenantSource).toMatch(/404/);
    // Capture from rows.length === 0 through the json response
    const ownershipBlock = tenantSource.match(
      /rows\.length\s*===\s*0[\s\S]*?c\.json\([^)]+\)/
    );
    expect(ownershipBlock).toBeTruthy();
    expect(ownershipBlock![0]).toMatch(/404/);
    expect(ownershipBlock![0]).not.toMatch(/403/);
  });

  it('returns "Not found" error message (not "Forbidden" or "Unauthorized")', () => {
    const ownershipBlock = tenantSource.match(
      /rows\.length\s*===\s*0[\s\S]*?c\.json\([^)]+\)/
    );
    expect(ownershipBlock).toBeTruthy();
    expect(ownershipBlock![0]).toMatch(/Not found/);
    expect(ownershipBlock![0]).not.toMatch(/Forbidden/i);
    expect(ownershipBlock![0]).not.toMatch(/Unauthorized/i);
  });

  it('blocks access to archived products', () => {
    expect(tenantSource).toMatch(/archived/);
    // Verify archived check results in 404
    const archivedBlock = tenantSource.match(
      /status\s*===\s*['"]archived['"][\s\S]*?c\.json\([^)]+\)/
    );
    expect(archivedBlock).toBeTruthy();
    expect(archivedBlock![0]).toMatch(/404/);
  });

  it('requires authentication before tenant check', () => {
    // The middleware should check for founder authentication before querying product ownership
    // Find positions within the middleware function body (after export const)
    const middlewareBody = tenantSource.slice(tenantSource.indexOf('createMiddleware'));
    const founderAuthGuard = middlewareBody.indexOf('if (!founder)');
    const ownershipQuery = middlewareBody.indexOf('getProductByOwner(');
    expect(founderAuthGuard).toBeGreaterThan(-1);
    expect(ownershipQuery).toBeGreaterThan(-1);
    expect(founderAuthGuard).toBeLessThan(ownershipQuery);
  });

  it('returns 401 when founder is missing (unauthenticated)', () => {
    expect(tenantSource).toMatch(/401/);
    expect(tenantSource).toMatch(/Authentication required/);
  });

  it('returns 400 when product ID is missing', () => {
    expect(tenantSource).toMatch(/400/);
    expect(tenantSource).toMatch(/Product ID required/);
  });

  it('loads lifecycle state after ownership verification', () => {
    const ownershipCheck = tenantSource.indexOf('getProductByOwner');
    const lifecycleLoad = tenantSource.indexOf('getLifecycleState');
    expect(ownershipCheck).toBeGreaterThan(-1);
    expect(lifecycleLoad).toBeGreaterThan(-1);
    expect(lifecycleLoad).toBeGreaterThan(ownershipCheck);
  });
});

// =============================================================================
// 4. AUTH MIDDLEWARE — Founder resolution scoping
// =============================================================================

describe('Auth middleware founder scoping', () => {

  it('auth middleware resolves founder by Clerk user ID (not by guessable ID)', () => {
    expect(authSource).toMatch(/getFounderByClerkId/);
  });

  it('auth middleware does not expose founder ID in client-facing error responses', () => {
    // Client-facing JSON error responses should not include founder IDs
    // Server-side structured logging with founderId context is acceptable
    expect(authSource).not.toMatch(/c\.json\(.*founder\.id|c\.json\(.*founderId/i);
  });

  it('auto-provisioned founders use INSERT with ON CONFLICT (no duplicate creation)', () => {
    expect(authSource).toMatch(/ON CONFLICT.*DO NOTHING/i);
  });

  it('last_seen_at update scopes by founder ID', () => {
    expect(authSource).toMatch(/UPDATE founders SET last_seen_at.*WHERE id\s*=\s*\?/i);
  });
});

// =============================================================================
// 5. COMPREHENSIVE EXPORT COVERAGE — No unscoped query helpers
// =============================================================================

describe('All exported query functions are scoped', () => {

  // Functions that are intentionally NOT tenant-scoped (with justification)
  const INTENTIONALLY_UNSCOPED = new Set([
    'getDb',           // Connection factory, not a query
    'query',           // Raw query helper, used by scoped functions
    'batch',           // Raw batch helper, used by scoped functions
    'executeRaw',      // Migration helper, not exposed to routes
    'getRelevantPatterns',  // Cross-tenant by design (anonymized)
    'getAllActiveProducts',  // Scheduled job helper (iterates all products)
  ]);

  // INSERT operations scope differently (include product_id in VALUES, not WHERE)
  const INSERT_OPERATIONS = new Set([
    'insertAuditLog',
  ]);

  it('every tenant-facing SELECT query includes a WHERE clause', () => {
    // Extract all exported async functions (query helpers)
    const exportedFns = clientSource.match(
      /export\s+async\s+function\s+(\w+)/g
    );
    expect(exportedFns).toBeTruthy();

    for (const match of exportedFns!) {
      const fnName = match.replace(/export\s+async\s+function\s+/, '');
      if (INTENTIONALLY_UNSCOPED.has(fnName)) continue;
      if (INSERT_OPERATIONS.has(fnName)) continue;

      const fn = extractFunction(clientSource, fnName);

      // A FUNCTION THAT TOUCHES NO DATABASE CANNOT LEAK A TENANT'S DATA.
      //
      // This required a WHERE clause of EVERY exported async function, so
      // adding `closeDb` — which runs no SQL at all — failed a tenant-isolation
      // gate. That is a false positive, and the damage a false positive does
      // here is specific: the obvious way to make it green is to add a name to
      // INTENTIONALLY_UNSCOPED, and an allowlist that grows for reasons that
      // are not about tenancy stops meaning anything.
      //
      // Deliberately narrow, because this gate may only get stricter. It skips
      // a function that makes no database call and contains no SQL keyword at
      // all. Anything that calls `query`, `batch` or `execute`, or that holds a
      // SELECT this extractor cannot parse, still fails loudly — an unreadable
      // query is exactly when you want to be told.
      const touchesDatabase = /\b(query|batch|execute|executeRaw)\s*\(/.test(fn)
        || /\b(SELECT|INSERT|UPDATE|DELETE)\b/i.test(fn);
      if (!touchesDatabase) continue;

      const sql = extractSQL(fn);

      // Every SELECT query must have a WHERE clause with a scoping parameter
      const hasWhereScope = /WHERE/i.test(sql);
      expect(
        hasWhereScope,
        `${fnName} has no WHERE clause — potential tenant data leak`
      ).toBe(true);
    }
  });

  it('insertAuditLog includes product_id in INSERT columns', () => {
    const fn = extractFunction(clientSource, 'insertAuditLog');
    expect(fn).toMatch(/INSERT\s+INTO\s+audit_log\s*\([^)]*product_id/i);
  });

  it('getAllActiveProducts is documented/used only for scheduled jobs', () => {
    // The JSDoc comment above documents this is for scheduled jobs
    const commentAndFn = clientSource.match(
      /\/\*\*[\s\S]*?\*\/\s*export\s+async\s+function\s+getAllActiveProducts/
    );
    expect(commentAndFn).toBeTruthy();
    expect(commentAndFn![0]).toMatch(/scheduled\s+jobs|iterate\s+all|all\s+products|all\s+active/i);
  });

  it('no query helper uses SELECT * without WHERE (except getAllActiveProducts)', () => {
    const exportedFns = clientSource.match(
      /export\s+async\s+function\s+(\w+)/g
    );
    expect(exportedFns).toBeTruthy();

    for (const match of exportedFns!) {
      const fnName = match.replace(/export\s+async\s+function\s+/, '');
      if (INTENTIONALLY_UNSCOPED.has(fnName)) continue;

      const fn = extractFunction(clientSource, fnName);
      const sql = extractSQL(fn);
      if (!sql) continue; // Non-query functions (batch, etc.)

      // If it has a SELECT, it must have a WHERE
      if (/SELECT/i.test(sql)) {
        expect(
          sql,
          `${fnName} has SELECT without WHERE — tenant data leak`
        ).toMatch(/WHERE/i);
      }
    }
  });
});
