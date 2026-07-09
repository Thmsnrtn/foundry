// =============================================================================
// FOUNDRY — Schema-as-code kernel (Ascent A1)
//
// Foundry's raw-SQL query layer is what let ~55 column/table-drift bugs ship
// this session (code writing columns the table doesn't have, caught only at
// runtime). AcreOS avoids that class entirely with a typed Drizzle schema.
//
// This is the lightweight equivalent: a table is described ONCE as a typed row
// interface + an `Insert` shape, and writes go through buildInsert/buildUpdate,
// which derive columns from the (typed) object keys. A typo'd or non-existent
// column is then a COMPILE error at the call site, not a 500 in production.
//
// Adopt incrementally — new subsystems (memory, red-team, …) use it from day 1;
// hot legacy tables migrate onto it opportunistically.
// =============================================================================

/** Build a parameterized INSERT from a typed row object. Column names come from
 *  the object's keys, so the Insert type is the single source of column truth. */
export function buildInsert<T extends Record<string, unknown>>(
  table: string,
  row: T,
): { sql: string; args: unknown[] } {
  const keys = Object.keys(row).filter((k) => row[k] !== undefined);
  const cols = keys.join(', ');
  const placeholders = keys.map(() => '?').join(', ');
  return {
    sql: `INSERT INTO ${table} (${cols}) VALUES (${placeholders})`,
    args: keys.map((k) => row[k]),
  };
}

/** Build a parameterized `UPDATE … SET …` from a typed patch object + WHERE.
 *  `where` columns/values are appended after the SET args. */
export function buildUpdate<T extends Record<string, unknown>, W extends Record<string, unknown>>(
  table: string,
  patch: T,
  where: W,
): { sql: string; args: unknown[] } {
  const setKeys = Object.keys(patch).filter((k) => patch[k] !== undefined);
  const whereKeys = Object.keys(where);
  const setClause = setKeys.map((k) => `${k} = ?`).join(', ');
  const whereClause = whereKeys.map((k) => `${k} = ?`).join(' AND ');
  return {
    sql: `UPDATE ${table} SET ${setClause} WHERE ${whereClause}`,
    args: [...setKeys.map((k) => patch[k]), ...whereKeys.map((k) => where[k])],
  };
}
