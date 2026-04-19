# Consolidation: Category E (Startup OS) -> Foundry

## Typical prospect's existing stack
- **Mercury** for banking, treasury, corporate cards, and bill pay
- **Brex / Ramp** as alternative or supplementary corporate cards with expense management
- **Gusto / Rippling** for payroll and HR
- **Stripe Atlas** for incorporation and initial setup
- **Clerky / Stripe** for legal formation documents
- **Notion** as internal wiki and lightweight project management
- **Slack** for team communication

## What Foundry replaces vs integrates

### Replaces:
- The "CEO morning routine" of checking Mercury balance, Stripe revenue, Slack alerts, and email -- Foundry's daily briefings and Signal Dashboard consolidate the founder's morning context into one view with agent-prioritized insights
- Manual operational decision-making from scattered signals -- Foundry's decision queue with agent-generated recommendations replaces the pattern of seeing a metric in Mercury, checking context in Stripe, and deciding what to do in a Notion doc
- Spreadsheet-based operations tracking -- founders who track operational health in Google Sheets (revenue trends, churn risk, feature priorities) can replace those with SCP agent outputs

### Integrates with (stays):
- **Mercury** stays -- banking, treasury, cards, and payments are financial infrastructure that Foundry does not replicate; Foundry could ingest Mercury transaction data as a signal source
- **Brex / Ramp** stays -- expense management and corporate cards are operational plumbing
- **Gusto / Rippling** stays -- payroll and HR are compliance-critical systems outside Foundry's domain
- **Stripe** stays as payment infrastructure -- Foundry integrates with Stripe for billing intelligence but does not replace it as the payment processor
- **Slack** stays as communication layer -- Foundry integrates with Slack (signal delivery, notifications) but does not replace team messaging
- **Notion** partially stays -- team wiki and documentation remain in Notion; founder-facing operational intelligence moves to Foundry

## Consolidation friction: LOW

Foundry does not replace any Startup OS infrastructure tool -- it layers on top of them as the intelligence and decision layer. Mercury handles money, Gusto handles people, Stripe handles payments, and Foundry handles the founder's cognitive load across all of them. The migration is additive (add Foundry to the stack) not substitutive (replace Mercury with Foundry). The friction is justifying the cost of an additional tool ($79-399/mo) on top of an already expensive stack.

## Key affordance to reduce friction: Position Foundry as the "intelligence layer over your existing stack" with a first-run experience that connects Mercury, Stripe, and GitHub in under 10 minutes and delivers a first autonomous briefing within 24 hours -- proving value before the first billing cycle.
