# CrewAI — Multi-Agent AI Framework

**Category:** C — AI Agent Orchestration
**Last researched:** 2026-04-18

## What It Does

CrewAI is an open-source framework for building and orchestrating autonomous AI agent
systems. It enables developers to define role-based agents, assign tasks, equip agents
with tools, and coordinate multi-agent workflows ("Crews"). The hosted platform
(CrewAI AMP) provides enterprise deployment, tracing, guardrails, and a visual
builder (CrewAI Studio). Claims 60% of Fortune 500 as customers, 450M+ agentic
workflow executions per month, 100K+ certified developers.

## Target User

Primary: developers and AI engineers building custom agent systems. Secondary:
enterprise teams deploying AI automation across departments. Tertiary (via Studio):
non-technical "citizen builders" using visual editors to create agent workflows.

## Positioning (How They Describe Themselves)

"The leading multi-agent platform." Open-source framing: "The open source multi-agent
orchestration framework." CrewAI positions as infrastructure — the layer you build
agent applications on top of, not the application itself.

## Pricing

- Open-source framework: Free (MIT-adjacent license)
- Hosted platform: Free (50 executions/mo), Professional $25/mo (100 executions),
  Enterprise custom (up to 30K executions, self-hosted K8s/VPC, SOC2, SSO, PII masking)
- Revenue model: execution-based pricing on hosted platform

## Key Vocabulary

Crew, agent, task, tool, flow, role, goal, backstory, delegation, memory (short-term,
long-term, entity, contextual), kickoff, execution, trace, guardrail, training,
process (sequential, hierarchical), callback, human input.

## Onboarding Flow

Developer-centric: pip install crewai, define agents in Python/YAML, assign tasks,
run crew. Extensive documentation and DeepLearning.AI certification course. Studio
provides low-code path for non-developers. Enterprise onboarding includes dedicated
AI Deployment Engineer for integration, migration, and production scaling.

## Multi-Entity Handling

CrewAI has no concept of "entity" or "company." A Crew is a team of agents working
on a task — the organizing unit is the workflow, not the business. Multiple Crews
can exist but they don't share state, context, or learning by default. There is no
fleet management, no cross-Crew intelligence, no lifecycle concept. Each Crew is
stateless across executions unless the developer builds persistence.

## Agent Handling

This is CrewAI's core — rich agent primitives:
- **Role-based architecture:** agents have roles, goals, backstories, and tool access
- **Dual orchestration:** Crews (autonomous collaboration) + Flows (deterministic,
  event-driven)
- **Memory system:** short-term, long-term, entity, and contextual memory
- **Training:** agents improve over time through execution feedback
- **Guardrails:** task-level validation before output is accepted
- **Tracing:** real-time visibility into agent reasoning and tool calls

## Novelty Positioning

Category creation. "Multi-agent orchestration" barely existed as a category before
CrewAI and LangGraph popularized it. CrewAI explicitly creates vocabulary (Crew, Flow,
kickoff) and conceptual frameworks (role-based agents, collaborative intelligence)
that define the space. Strong category-defining energy.

## What Foundry Can Learn

1. **Role-based agents are intuitive.** CrewAI's role/goal/backstory pattern for
   defining agents maps naturally to human organizational roles. Foundry's 12 named
   agents (Atlas/CTO, Compass/PM, etc.) already follow this pattern — lean into it
   harder in onboarding and communication.

2. **Crews are generic; Foundry's agents are domain-specific.** CrewAI provides
   building blocks; Foundry provides a finished building. This is the key
   differentiator: a CrewAI user needs months to build what Foundry ships day one.
   The positioning should emphasize "pre-built, domain-expert agents" not "agent
   framework."

3. **Memory architecture as competitive moat.** CrewAI's four-layer memory system
   (short-term, long-term, entity, contextual) is instructive. Foundry's agents
   should have equivalent memory depth — golden lessons, company history, decision
   patterns, and cross-company context should be explicit, queryable memory layers.
