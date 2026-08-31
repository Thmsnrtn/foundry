// =============================================================================
// Tests: SQL migration statement splitter (Phase 3.2)
// Covers exactly the cases the old `split(/;\s*\n/)` + blanket `--` strip broke.
// =============================================================================

import { describe, it, expect } from 'vitest';
import { splitSqlStatements } from '../../src/db/migrate.js';

describe('splitSqlStatements', () => {
  it('splits simple statements on top-level semicolons', () => {
    const out = splitSqlStatements('CREATE TABLE a (id TEXT);\nCREATE TABLE b (id TEXT);\n');
    expect(out).toEqual(['CREATE TABLE a (id TEXT)', 'CREATE TABLE b (id TEXT)']);
  });

  it('does NOT split on a semicolon inside a string literal', () => {
    const out = splitSqlStatements(`INSERT INTO t (v) VALUES ('a;b');\nCREATE TABLE c (id TEXT);`);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("'a;b'");
  });

  it('preserves escaped quotes inside string literals', () => {
    const out = splitSqlStatements(`INSERT INTO t (v) VALUES ('it''s; fine');`);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'it''s; fine'");
  });

  it('strips line comments without touching dashes inside strings', () => {
    const sql = `CREATE TABLE t (\n  v TEXT DEFAULT 'a--b',  -- trailing note\n  n INT\n);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain("'a--b'");        // string dashes survive
    expect(out[0]).not.toContain('trailing note'); // comment stripped
  });

  it('ignores semicolons inside a block comment', () => {
    const out = splitSqlStatements('CREATE TABLE a (id TEXT); /* one; two; */ CREATE TABLE b (id TEXT);');
    expect(out).toHaveLength(2);
  });

  it('does not split inside a CREATE TRIGGER BEGIN..END body', () => {
    const sql = `CREATE TRIGGER trg AFTER INSERT ON t BEGIN\n  UPDATE t SET n = 1;\n  UPDATE t SET n = 2;\nEND;\nCREATE TABLE after (id TEXT);`;
    const out = splitSqlStatements(sql);
    expect(out).toHaveLength(2);
    expect(out[0]).toContain('CREATE TRIGGER');
    expect(out[0]).toContain('UPDATE t SET n = 2');
    expect(out[1]).toContain('CREATE TABLE after');
  });

  it('handles a trailing statement with no terminating semicolon', () => {
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1']);
  });

  it('drops empty statements from stray semicolons', () => {
    expect(splitSqlStatements('SELECT 1;;\n;')).toEqual(['SELECT 1']);
  });
});

describe('a CASE inside a trigger body', () => {
  it('does not close the body early', () => {
    // `CASE ... END` ends with the same keyword the trigger body does. Counting
    // only BEGIN made the CASE's `END` cancel the trigger's, so the body was cut
    // at its first internal semicolon and SQLite reported "incomplete input" on
    // a statement that was perfectly well formed. The splitter's own comment
    // claimed it respected trigger bodies; it respected the ones nobody had
    // written a CASE in yet.
    const sql = `
CREATE TRIGGER t
BEFORE UPDATE OF status ON candidates
WHEN NEW.status IS NOT OLD.status
BEGIN
  SELECT RAISE(ABORT, 'no_decision') WHERE NOT EXISTS (
    SELECT 1 FROM decisions d
     WHERE d.candidate_id = NEW.id
       AND NEW.status = CASE d.decision
             WHEN 'reconsidered' THEN 'pending'
             ELSE d.decision
           END
  );
END;

CREATE INDEX idx_after ON candidates(status);
`;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TRIGGER');
    expect(statements[0].trim().endsWith('END')).toBe(true);
    expect(statements[1]).toContain('CREATE INDEX');
  });

  it('handles a CASE nested inside another', () => {
    const sql = `
CREATE TRIGGER t2 BEFORE INSERT ON x
BEGIN
  SELECT RAISE(ABORT, 'no') WHERE 1 = CASE WHEN 1 THEN CASE WHEN 1 THEN 1 ELSE 0 END ELSE 0 END;
END;
SELECT 1;
`;
    const statements = splitSqlStatements(sql);
    expect(statements).toHaveLength(2);
    expect(statements[0]).toContain('CREATE TRIGGER t2');
  });
});
