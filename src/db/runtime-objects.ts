// =============================================================================
// FOUNDRY — SCHEMA OBJECTS THE MIGRATIONS DO NOT CREATE
//
// The committed snapshot describes what the migrations build. A running process
// also makes things for itself: the health check proves the volume is writable
// by writing and deleting a row, creating its probe table when it is missing.
// That table is real, it is in `sqlite_master`, and it is not part of any
// schema anybody committed.
//
// WHY THIS IS ONE LIST AND NOT TWO. Both facts were already known here, in
// different modules, and only one of them acted on it. `carrying.ts` — the
// owner-facing reading — excluded the probe table and correctly reported no
// drift. `self-observation.ts` — which writes the CANONICAL evidence and feeds
// the responsibility Foundry actually shadows — did not, and reported drift
// every six hours for eleven days over that one table.
//
// So the institution's own record said a responsibility was failing while the
// page the owner reads said it was fine, and the disagreement was invisible
// because nothing compared the two. A detector whose only finding is false
// teaches everybody downstream to ignore it — and the correction this
// responsibility would have produced, left to run, was to write the probe table
// into the committed description and make the description wrong.
//
// The knowledge lives once, in the layer that owns the schema, and every reader
// takes it from here. Adding an entry is a deliberate statement that something
// creates this object at runtime; it is not a way to silence a real drift.
// =============================================================================

/**
 * The health check's probe table, named here so the route that CREATES it and
 * the comparison that FORGIVES it cannot drift apart. They already had, in
 * opposite directions.
 */
export const WRITE_PROBE = 'health_write_probe';

/** Created by a running process rather than by any migration. */
export const OBJECTS_MADE_AT_RUNTIME: ReadonlySet<string> = new Set([
  // `/internal/health` writes and deletes a row to prove the volume accepts
  // writes, and creates the table when it is missing.
  WRITE_PROBE,
]);

/** Whether a live schema object is one a running process made for itself. */
export function madeAtRuntime(objectName: string): boolean {
  return OBJECTS_MADE_AT_RUNTIME.has(objectName);
}
