# Runbook — AI bill spike

> Trigger: Anthropic monthly spend significantly above expected baseline,
> or daily spend trending toward an alarming month.

## 1. Detection

### Signals
- **Anthropic dashboard**: monthly cost projection >2× the prior month's
  baseline.
- **Foundry**: `scp_cost_report` (cron `0 0 1 * *` — runs 1st of month) flags
  any product whose 30-day AI cost crossed an internal ceiling.
- **CLI**: `npm run cli -- ai:cost-summary` (if implemented) or query
  `ai_cost_log` directly:
  ```sql
  SELECT product_id, SUM(cost_usd) AS spent_30d
    FROM ai_cost_log
   WHERE timestamp >= datetime('now', '-30 days')
   GROUP BY product_id
   ORDER BY spent_30d DESC;
  ```

### Order of magnitude reference
- Per-product expected: ~$5–$15/mo at default agent cadences.
- Per-product alarming: >$50/mo or any single-day >$10.

## 2. Mitigation (fastest first)

1. **Pause the noisiest agents** for the offending product:
   ```bash
   npm run cli -- agent:pause <product_id> oracle
   npm run cli -- agent:pause <product_id> compass
   ```
   Oracle and Compass run weekly synthesis and tend to pull large context.

2. **Globally disable the most expensive jobs**:
   ```bash
   # In src/jobs/index.ts JOB_REGISTRY, comment out:
   #   - scp_wisdom_synthesis  (Sunday 3 UTC, large prompts)
   #   - scp_strategy_synthesis (1st of month, monthly synthesis)
   #   - scp_compressed_brief  (Monday 7 UTC)
   # Redeploy.
   ```
   Heavy-handed but immediate.

3. **Pause the whole product** if a single product is the culprit and
   the founder is unreachable:
   ```sql
   UPDATE products SET status = 'paused' WHERE id = '<product_id>';
   ```
   The kill-switch will refuse all gateway invocations once Resend is
   migrated; for now this stops scheduled agent runs that scope to
   `status = 'active'`.

4. **Lower model tier** for non-critical agents. In
   `src/services/ai/client.ts`, the `callOpus` calls cost roughly 5× the
   `callSonnet` calls. Audit which agents call Opus and convert
   non-strategic ones to Sonnet temporarily.

## 3. Root cause checklist

- [ ] **Runaway loop**: did an agent recurse / retry without bound? Check
      `agent_messages` for the same agent_name spammed in a short window.
- [ ] **Unintentional cadence change**: was a cron schedule recently
      tightened (hourly → every 5 min)? `git log src/jobs/index.ts`.
- [ ] **Prompt bloat**: `buildWisdomContext()` size suddenly larger? Check
      `product_dna` length and `agent_wiki_entries` count for the
      product.
- [ ] **Customer/data growth**: did a product add many customers or
      metric snapshots? Larger context = larger prompts.
- [ ] **Compromised credentials**: is the Anthropic key being used outside
      Foundry? Rotate `ANTHROPIC_API_KEY` if uncertain.
- [ ] **Eval / benchmark accident**: did a one-off eval or benchmark job
      run unbounded? Check recent commits to `tests/evals/` or
      `scp_intelligence_benchmarks`.

## 4. Post-incident

- Add a daily ceiling check to `scp_cost_report` (it currently runs
  monthly).
- If a specific agent was the culprit, add a per-agent token-cost ceiling
  in the agent's config_json.
- File a regression test if the cause was a code change (e.g. a new
  field that doubled prompt size).

## 5. Communication

If alpha founders are affected (their agents went silent because the
product was paused), email them:
- What happened (one sentence).
- What you did (paused).
- What they need to do (nothing — it's resuming).
- ETA for resume.

Don't dramatize. They're early users; trust is built by handling the
unsexy stuff well.
