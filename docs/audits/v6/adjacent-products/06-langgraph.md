# LangGraph — Graph-Based Agent Orchestration

**Category:** C — AI Agent Orchestration
**Last researched:** 2026-04-18

## What It Does

LangGraph is an open-source (MIT-licensed) agent runtime and orchestration framework
from LangChain that models agent workflows as directed graphs. It provides durable
execution (automatic resumption from failures), persistent state management,
human-in-the-loop capabilities, and multi-agent coordination patterns. The hosted
LangGraph Platform offers managed deployment, Studio for visual debugging, and
one-click GitHub deployment. 90M+ monthly downloads, production deployments at
Uber, JP Morgan, BlackRock, Cisco, LinkedIn, Klarna.

## Target User

Primary: AI engineers building production-grade agent systems that require reliability,
state management, and human oversight. Secondary: enterprise platform teams deploying
agentic workflows at scale. LangGraph skews more technical than CrewAI — the graph
abstraction requires engineering fluency.

## Positioning (How They Describe Themselves)

"Agent orchestration framework for reliable AI agents." LangGraph positions on
reliability and control — not the easiest framework, but the most production-grade.
The emphasis is on "durable," "stateful," "human-in-the-loop" — vocabulary that
signals enterprise readiness.

## Pricing

- Open-source library: Free (MIT license)
- LangGraph Platform: Paid tiers from $39/seat/month
- Per-execution fee: $0.001 per node execution
- LangSmith (observability): separate pricing, often bundled

## Key Vocabulary

Graph, node, edge, state, checkpoint, thread, reducer, channel, super-step,
human-in-the-loop, breakpoint, command, handoff, tool call, persistence,
durable execution, trajectory, studio, deployment.

## Onboarding Flow

Developer-centric: install library, define state schema, create nodes (functions),
connect with edges (conditional routing), compile graph, run. LangGraph Studio
provides visual debugging and state inspection. One-click deploy from GitHub repo
to hosted platform. Documentation-heavy with conceptual guides, tutorials, and
reference architectures. Steeper learning curve than CrewAI due to graph abstraction.

## Multi-Entity Handling

No concept of "entity" or "company" as a primitive. LangGraph manages state within
a single graph execution (a "thread"). Multiple threads can exist independently but
share no state or intelligence by default. Cross-thread communication requires custom
implementation. The organizing unit is the graph/workflow, not the business. No fleet
management, no lifecycle awareness.

## Agent Handling

LangGraph's agent architecture is graph-native:
- **State as first-class citizen:** shared state object flows through every node,
  with reducer-based merge logic preventing overwrites
- **Checkpointing:** automatic state persistence enables resume-from-failure and
  time-travel debugging
- **Human-in-the-loop:** inspect and modify state at any breakpoint before continuing
- **Multi-agent patterns:** shared state channels, agent handoffs via Command objects,
  parallel execution, hierarchical and supervisor patterns
- **Memory:** short-term (within thread) and long-term (cross-session) persistence

## Novelty Positioning

Category creation, infrastructure-layer. LangGraph defines the "agent runtime"
sub-category within the broader AI agent space. The graph abstraction and vocabulary
(nodes, edges, checkpoints, threads) are category-defining. LangGraph 1.0 (Oct 2025)
was positioned as a "watershed moment for enterprise AI" — explicit category-defining
language.

## What Foundry Can Learn

1. **Durable execution is table stakes for autonomous agents.** LangGraph's core
   value proposition — agents that survive failures and resume from checkpoints — is
   something Foundry's SCP agents lack (no retry, no circuit breaker, no checkpoint).
   This is a critical infrastructure gap.

2. **Human-in-the-loop as a trust gradient.** LangGraph's breakpoint/inspect/modify
   pattern maps directly to Foundry's 5-gate authority system. The difference:
   LangGraph provides the mechanism, Foundry provides the policy. Foundry should
   communicate its gate system in terms that LangGraph-aware technical buyers
   immediately understand.

3. **Graph visualization as a comprehension tool.** LangGraph Studio's visual graph
   of agent workflows makes complex systems legible. Foundry's Fleet Observatory
   concept needs equivalent visual clarity — seeing all 12 agents across all companies,
   their states, and their interactions as a navigable graph/map.
