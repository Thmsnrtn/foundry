# Runbook — Agent silently failing for one product

> Trigger: A founder reports their daily briefing is empty / stale / one
> agent's section is missing for several days; or you notice no recent
> rows in `agent_messages` for a specific product.

## 1. Detection

### Signals
- Daily briefing for one product has empty or yesterday-only content.
- `agent_messages.created_at` for the product is several hours/days old.
- `agent_instances.last_run_at` is stale relative to the agent's cadence.
- Founder explicitly asks "is Foundry working?"

### Quick checks
```sql
-- Per-product agent run recency
SELECT agent_name, status, last_run_at, next_run_at
  FROM agent_instances
 WHERE product_id = '<product_id>'
 ORDER BY last_run_at DESC NULLS LAST;

-- Recent message production
SELECT agent_name, COUNT(*) AS msgs_24h
  FROM agent_messages
 WHERE product_id = '<product_id>'
   AND created_at >= datetime('now', '-24 hours')
 GROUP BY agent_name;
```

If `last_run_at` is fresh but `agent_messages` is empty, the agent ran
and produced nothing. That's a content problem, not a runtime problem.
If `last_run_at` is stale, the agent isn't running at all.

## 2. Mitigation

### A. Agent isn't running at all

1. **Confirm scheduler is alive**: `scp_agent_runner` cron `0 * * * *`
   should be hitting hourly.
   ```bash
   fly logs --since 2h | grep scp_agent_runner | tail -5
   ```

2. **Check for crash loop in agent code**: the agent's `analyzeAndAct`
   may be throwing during initialization.
   ```bash
   fly logs --since 6h | grep -E "(error|fail).*<agent_name>" -i
   ```

3. **Force-run the agent** to surface the error inline:
   ```bash
   npm run cli -- agent:run <product_id> <agent_name>
   ```
   The CLI will print the stack if it throws.

4. **Reset cadence** if `next_run_at` is stuck in the past:
   ```sql
   UPDATE agent_instances
      SET next_run_at = datetime('now', '+5 minutes')
    WHERE product_id = '<product_id>' AND agent_name = '<agent_name>';
   ```
   Wait for the next hourly tick.

### B. Agent runs but produces nothing

1. **Check `domain_health_score`**: if it's near zero, the agent has
   been failing recently and may be in a defensive mode.
   ```sql
   SELECT agent_name, domain_health_score, total_sessions, successful_sessions
     FROM agent_instances WHERE product_id = '<product_id>';
   ```

2. **Check golden lessons / config bloat**: a runaway lesson injection
   might be making the prompt so large it's failing to extract signals.
   ```sql
   SELECT COUNT(*) FROM agent_evolution_versions
    WHERE product_id = '<product_id>'
      AND change_type = 'golden_lesson'
      AND status = 'active';
   ```
   If >50, prune the oldest. Anything over ~30 lessons is suspicious.

3. **Check upstream data presence**: agents read `metric_snapshots`,
   `customers`, integration data. If those are empty, the agent has
   nothing to observe.

### C. Whole product is paused

```sql
SELECT id, name, status FROM products WHERE id = '<product_id>';
```
If `status != 'active'`, the scheduler skips this product. Reactivate
only if the founder asked for it.

## 3. Root cause checklist

- [ ] **Token / quota issue**: Anthropic key revoked or quota exceeded
      → all agents across all products would fail, not just one.
- [ ] **Per-product crash**: bad data in `product_dna` or `customers`
      tripping a parser. Check most recent migration that touched
      relevant tables.
- [ ] **Evolution mishap**: a recent prompt evolution made the agent
      output unparseable. `agent_evolution_versions` filtered to recent
      `prompt_refinement` entries — revert if needed.
- [ ] **Cron drift**: scheduler stuck. Restart Fly app: `fly apps
      restart foundry-intel`.
- [ ] **DB lock contention**: long-running query holding a lock; check
      Turso replication state.

## 4. Recovery for affected founder

Once the agent is healthy again:

1. **Backfill a briefing**: trigger an immediate briefing run so the
   founder doesn't have to wait until tomorrow:
   ```bash
   npm run cli -- briefing:generate <product_id>
   ```

2. **Email the founder** if downtime exceeded 24 hours: short note
   acknowledging the gap, what was lost (typically: nothing
   irrecoverable), and confirmation it's resolved.

## 5. Post-incident

- If the same agent fails twice for different products, write a
  regression test with the offending input.
- If the cause was config bloat, add a check in the agent runtime that
  refuses to run if its prompt exceeds a token budget.
- If the cause was scheduler drift, log the gap and consider adding a
  watchdog that alerts when any agent's `last_run_at` is more than 2×
  its cadence.
