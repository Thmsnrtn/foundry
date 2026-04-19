# Persona 06 — Jordan

## Identity

- **Role:** Compliance-minded founder with regulatory obligations
- **Background:** Runs a fintech SaaS that processes payment data and is subject to SOC 2 Type II and state money transmitter regulations. Former compliance officer at a regional bank. Treats audit trails as load-bearing infrastructure, not nice-to-have features. Every agent action that touches customer data must be logged, timestamped, and exportable.
- **Current situation:** Jordan added their company to Foundry three months ago. The agents provide useful operational insights, but Jordan's compliance auditor is asking for evidence that autonomous agent actions are logged with sufficient detail to satisfy regulatory review. Jordan needs to prove that Foundry's agent system meets the same auditability bar as their own product.

## Profile

| Attribute | Value |
|-----------|-------|
| Technical comfort | 6/10 |
| Fleet size | 1 company |
| Trust in autonomy | Medium — trusts automation only when audit trail is complete |
| Subscription tier | Growth ($199) |

## Abandonment Triggers

1. Agent actions are not individually logged with timestamps, actor IDs, and before/after state.
2. No bulk export of agent activity logs in a machine-readable format (CSV, JSON).
3. Cannot demonstrate to an external auditor exactly what the agents did and when.

## Voice

> "My auditor doesn't care that the AI is smart. They care that every action has a timestamp, an actor, and a rollback path."

> "If I can't export a full agent activity log for the last 90 days in one click, this fails my compliance check."

> "Autonomous is fine. Unauditable is not."
