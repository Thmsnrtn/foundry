# Consolidation: Category C (AI Agent Orchestration) -> Foundry

## Typical prospect's existing stack
- **CrewAI** or **LangGraph** for building custom agent workflows
- **LangSmith** or **Langfuse** for agent observability and tracing
- **OpenAI / Anthropic / local models** as LLM providers
- **Vector databases** (Pinecone, Chroma) for agent memory and RAG
- **Custom Python/TypeScript code** gluing agents to business logic
- **GitHub Actions / Temporal** for scheduling and durable execution

## What Foundry replaces vs integrates

### Replaces:
- Custom-built business operations agents -- Foundry's 12 pre-built SCP agents (Atlas/CTO, Compass/PM, Forge/Revenue, etc.) replace months of custom agent development for the specific domain of SaaS company operations
- Agent orchestration infrastructure for business intelligence -- the SCP scheduler, gate system, and signal processing replace hand-rolled orchestration code for the founder-ops use case
- Business context assembly -- Foundry's per-company context loading (golden lessons, decision patterns, company history) replaces custom RAG pipelines built to give agents business awareness

### Integrates with (stays):
- **CrewAI / LangGraph** stays for non-business-ops agent use cases -- customer support agents, code review agents, content generation pipelines, and other domain-specific agent systems remain outside Foundry's scope
- **LangSmith / Langfuse** stays for observability -- Foundry lacks structured tracing and agent observability (a known gap), so teams may instrument Foundry's AI calls with external observability
- **LLM providers** stay -- Foundry uses Anthropic Claude, but teams with existing provider contracts and custom prompts for other use cases keep those
- **Vector databases** stay for other retrieval use cases -- Foundry uses Turso (SQLite), not vector search

## Consolidation friction: MEDIUM

The CrewAI/LangGraph user is a builder, not a buyer. They value customization, control, and the ability to define agent behavior from primitives. Foundry's opinionated, pre-built agents feel like a loss of control. The friction is not technical migration (there is no data to migrate) but philosophical: accepting a pre-built system vs building your own. The prospect who consolidates is the one who tried to build business-ops agents with CrewAI, spent months on it, and realized the domain expertise required makes custom development uneconomical.

## Key affordance to reduce friction: Expose Foundry's SCP agents via a programmatic API and MCP server so that CrewAI/LangGraph users can integrate Foundry's domain-specific intelligence into their existing agent ecosystems rather than replacing their orchestration layer entirely.
