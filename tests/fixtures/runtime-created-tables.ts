// =============================================================================
// Tables that exist at runtime but not in the migrated schema
//
// Two gates need this list and had no business keeping two copies:
//   • no-phantom-tables — every table NAMED in src must exist
//   • sql-prepares-against-schema — every literal statement must PREPARE
//
// A second copy is how one of them ends up permitting something the other
// refuses. Each entry is a deliberate exception with the reason attached; a
// table without one is a bug, and both gates say so in the same words.
// =============================================================================

export const RUNTIME_CREATED_TABLES: Record<string, string> = {
  health_write_probe: 'created at call time in src/routes/internal/health.ts — the '
    + 'health check writes a row and deletes it, to prove the volume accepts writes '
    + 'rather than only reads; deliberately not migrated, because a probe that '
    + 'depends on migrations having run cannot report that they have not',
  audio_brief_scripts: 'created at call time in src/services/scp/briefing/audio.ts (ensureTable)',
  email_digests: 'created at call time in src/services/scp/briefing/email-digest.ts (ensureTable)',
  company_memory: 'voice-reply.ts: read inside a try/catch that falls back to decisions',
  daily_briefings: 'debate/orchestrator.ts: guarded synthesis-append against a table that was never built',
};
