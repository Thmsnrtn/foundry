# Outbound Tool Gateway

`src/services/outbound/` is the trust boundary on outbound actions. It owns
two things:

1. The original `executor.ts` — propose → approve → execute pipeline used by
   `src/services/integration/resend.ts` and the agent action queue.
2. The V3.1 `gateway.ts` — top-level `invoke()` with four pre-flight checks
   that wraps any registered tool handler.

The gateway is the destination state. Existing integrations migrate to it
adapter-by-adapter on their own cadence; until then, both paths coexist.

---

## When to use the gateway vs the executor

Use **`gateway.invoke(...)`** when you are emitting an outbound action that:

- has a defined customer-reaching surface (email, public landing copy,
  CS thread, billing event), AND
- benefits from at-most-once dedup, communication budgeting, or
  classification — i.e., basically every customer-reaching surface.

Use **`executor.proposeAction(...)`** for legacy paths that already wrap
their own approval queue. New surfaces should not be added to the executor
without first asking whether the gateway can serve them.

---

## The four pre-flight checks

Each check short-circuits the chain. Only when all four pass does the
gateway dispatch to the registered tool handler.

| Order | Check | Source of truth | When it fires |
|------:|-------|-----------------|---------------|
| 1 | **kill-switch** | `products.status`, `products.disabled_tools`, `agent_instances.status` | Always |
| 2 | **classification** | `data_classifications` (per product+surface) | Only when `surface` is provided in the request |
| 3 | **budget** | `communication_budgets` (per product+customer+week) | Only when `customerExternalId` is provided |
| 4 | **idempotency** | `idempotency_keys` (per product+tool+dedupKey) | Only when `dedupKey` is provided |

### Cost of each check

- **kill-switch** — single SELECT on `products`, plus one on `agent_instances`
  when an agent name is supplied. Cheap.
- **classification** — single SELECT on `data_classifications`. The default
  policy (no row) admits `general` and `customer`, refuses everything else.
- **budget** — UPDATE on row hit, INSERT on first-of-week. UNIQUE conflict
  is race-handled.
- **idempotency** — SELECT for active row, INSERT (race-safe) on miss.
  Daily cleanup cron deletes expired rows.

In the happy path, the gateway issues 3-5 fast SQL operations before the
handler runs. None of them call an LLM.

---

## Calling the gateway

```ts
import { invoke, registerToolHandler } from './gateway.js';

// Once at startup, register handlers for every tool you support.
registerToolHandler('send_email', async (req) => {
  return await sendViaResend(req.params);
});

// At the call site:
const result = await invoke({
  productId: 'prd_abc',
  agent: 'beacon',
  tool: 'send_email',
  action: 'send onboarding email',
  params: { to, subject, html },
  dedupKey: `onboarding:${userId}:${campaignVersion}`,
  customerExternalId: userId,
  surface: 'email_outbound',
  dataClass: 'customer',
});

if (!result.ok) {
  // result.phase tells you which check refused; result.reason explains.
  return;
}
// result.cached is true when idempotency returned a prior result.
// result.result is the handler's return value (or the cached payload).
```

Required: `productId`, `agent`, `tool`, `action`, `params`.
Optional but expected for customer-reaching surfaces: `dedupKey`,
`customerExternalId`, `surface`, `dataClass`.

A request without `surface` skips classification entirely. A request
without `customerExternalId` skips budget. A request without `dedupKey`
will execute every call — even duplicates.

---

## Adapter migration order

Migrate existing integrations to the gateway in this order. The order is
chosen by blast radius, not by ease of porting.

1. **Resend (highest priority)** — `src/services/integration/resend.ts`.
   Highest frequency, customer-reaching, hardest to take back. A
   double-sent email creates the most acute trust break with friendly
   alpha founders. Add: `dedupKey` on every send, `customerExternalId`
   on customer-bound mail, `surface='email_outbound'` with appropriate
   `dataClass`.
2. **Stripe** — billing events. Lower volume but each event is high
   stakes (a duplicate refund is much worse than a duplicate email).
   Add: `dedupKey` per Stripe object id, `customerExternalId=stripe_customer_id`.
3. **GitHub** — PR creation, comment posting. Lowest customer-facing
   risk; covered separately by `webhook_idempotency` for inbound events.
   Migrate when capacity allows; not blocking.

Each migration is its own commit. Pattern:

1. Define a tool name (`send_email`, `create_pr`, `update_subscription`).
2. Move the underlying call into a `ToolHandler`.
3. Register it once at boot.
4. Replace direct call sites with `invoke({ tool, ... })`.
5. Backfill defaults for `dataClass` and `surface` per call site.

Do not migrate everything in a single commit. Each adapter migration
needs its own test pass and rollback path.

---

## Adding a new tool

1. Pick a stable tool name. Lowercase + underscores. Not the package name —
   the *capability* name (`send_email`, not `resend_send`).
2. Write the handler:
   ```ts
   const handler: ToolHandler = async (req) => {
     // req.productId, req.agent, req.tool, req.params
     // return whatever you want cached; this becomes result.result
     return await externalCall(req.params);
   };
   ```
3. Register at boot: `registerToolHandler('your_tool', handler);`
4. Decide which kinds of callers must supply `dedupKey`, `customerExternalId`,
   `surface`. Document in the handler module.
5. If the tool reaches a customer, add a row to the team's runbook on how
   to disable it via `disableTool(productId, 'your_tool')`.

---

## Disabling a tool in production

```ts
import { disableTool, enableTool } from './kill-switch.js';

await disableTool(productId, 'send_email');   // refuses immediately
await enableTool(productId, 'send_email');    // re-enables
```

Use this when you discover a regression mid-shift. The kill-switch reads
fresh state on every `invoke()` call, so the change applies to in-flight
traffic without restarts.

---

## Audit trail

Every invocation writes one row to `audit_log` with:

- `action_type = 'gateway:<tool>'`
- `trigger = 'gateway/<agent>'`
- `outcome ∈ {'allowed','cached','refused','failed'}`
- `input_context` JSON with `invocation_id`, `action`, `params_summary`
- `output` populated for cached and allowed outcomes

Audit writes are best-effort. A failure to write audit does not break the
invocation — but it does mean the trail has a gap, which is worth noticing.
