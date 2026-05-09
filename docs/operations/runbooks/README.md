# Foundry — Runbooks

Operational runbooks for incidents that recur. Each one: detection
signals, fastest mitigation, root cause checklist, post-incident
follow-up.

| Runbook | When to read it |
|---------|-----------------|
| [ai-bill-spike.md](./ai-bill-spike.md) | Anthropic spend jumps unexpectedly. |
| [stripe-webhook-backlog.md](./stripe-webhook-backlog.md) | Subscription/tier changes not reflecting in Foundry; Stripe shows failed deliveries. |
| [agent-silently-failing.md](./agent-silently-failing.md) | An agent's section is missing from a founder's briefing for >24 hours. |

## Conventions

- Runbooks are written assuming **one operator, one terminal**. Commands
  are copy-pasteable. SQL is for libSQL/SQLite.
- The Fly app name is `foundry-intel` throughout.
- Each runbook has a "Post-incident" section. Always do it. Runbooks
  improve with every incident; the cost of skipping a five-minute
  follow-up is paying it back many times in repeat incidents.

## What this directory does NOT cover

- Disaster recovery (full DB loss / region outage). See
  `docs/operations/disaster-recovery.md`.
- Standard deploy / migration commands. See `docs/operations/runbook.md`.
- Founder support requests that aren't operational incidents. Those go
  through whatever support inbox is set up.

## Adding a runbook

When a new failure mode happens twice, write a runbook for it. Use this
as a template:

```markdown
# Runbook — <one-line trigger>

> Trigger: <single sentence>

## 1. Detection
What signals tell you this is happening. Include SQL for quick checks.

## 2. Mitigation
Numbered steps, fastest first. Each step is something you can paste.

## 3. Root cause checklist
Bulleted list of things to rule out. The point is to surface unknown
unknowns, not to be exhaustive.

## 4. Post-incident
What to add to the codebase / monitoring so this is faster next time.
```

Three pages max. If a runbook exceeds that, it's two runbooks.
