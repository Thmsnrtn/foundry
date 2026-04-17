# Competitor: LangGraph (LangChain)
Category: AI agent orchestration platform
URL: https://www.langchain.com/langgraph

## What They Do
LangGraph is a low-level, graph-based orchestration framework for building stateful, long-running AI agents. It models agent workflows as directed graphs with nodes (actions), edges (transitions), and persistent state, giving developers fine-grained control over complex multi-agent architectures. It is MIT-licensed open source, backed by LangChain (which raised $125M Series B), and deployed at companies like LinkedIn, Klarna, Replit, and Elastic.

## Target User
Engineering teams building production-grade agent systems that require deterministic control flows, auditability, and regulatory compliance — particularly in fintech, healthcare, and enterprise software. Targets developers comfortable with graph-based programming who need more control than high-level frameworks provide.

## Key Features
- Graph-based workflow design: nodes, edges, conditional branching, parallel execution, and hierarchical sub-graphs
- Durable execution with automatic checkpoint/resume — agents survive crashes and can run indefinitely
- Human-in-the-loop: breakpoints, state inspection, and mid-execution intervention
- Persistent memory: short-term working memory and long-term cross-session memory
- Native streaming: token-by-token output for real-time agent reasoning visibility
- Multi-agent patterns: single agent, multi-agent, hierarchical, and supervisor architectures
- 1.0 API stability guarantee
- LangSmith integration for observability, tracing, evaluation, and deployment
- LangSmith Deployment (managed hosting) for production agent infrastructure
- Model-agnostic: works with any LLM provider

## Pricing
- **LangGraph (framework)**: Free, MIT-licensed open source
- **LangSmith Developer**: Free — 5,000 traces/month, 14-day retention, 1 seat
- **LangSmith Plus**: $39/seat/month — 10,000 base traces, 1 free dev deployment, $0.005/deployment run, $2.50 per 1,000 overage traces
- **LangSmith Enterprise**: Custom pricing — SSO, custom retention, self-hosted/hybrid deployment options, dedicated support

## Strengths (vs Foundry)
- Maximum architectural flexibility: graph primitives let teams model any workflow topology, including ones Foundry has not anticipated
- Durable execution and checkpointing make agents resilient to failures at infrastructure level — battle-tested at LinkedIn scale
- Deep observability via LangSmith: full trace visualization, evaluation frameworks, and deployment monitoring in one stack
- Massive ecosystem and community: LangChain is the most widely adopted LLM framework, so LangGraph inherits tooling, tutorials, and talent pool
- Open source with no vendor lock-in on the orchestration layer; self-hosting is straightforward
- $125M in funding and enterprise GTM motion give long runway and market presence

## Weaknesses (vs Foundry)
- Pure infrastructure, zero domain knowledge — building a "CFO agent" or "Sales agent" requires months of custom development; Foundry ships these ready-made
- Steep learning curve: graph-based programming is powerful but complex; non-technical founders cannot use it
- Tightly coupled to LangChain ecosystem — switching away from LangChain primitives requires significant rework
- No concept of multi-company orchestration — LangGraph manages workflows, not portfolios of businesses
- No built-in role semantics or business context — agents are generic graph nodes, not specialized business functions
- Deployment pricing ($0.005/run) and trace costs add up for always-on monitoring across multiple companies

## Key Insight
LangGraph is the most technically sophisticated agent orchestration framework available, but it is explicitly infrastructure — it gives you graph primitives and says "build your own." Foundry competes at a fundamentally different altitude: the application layer. The strategic risk is that a well-funded team builds a "Foundry-like" vertical product on top of LangGraph. Foundry's defense is speed-to-value: a founder connects Foundry and gets 12 working agents immediately, while a LangGraph-based competitor would need to replicate years of domain-specific agent design. Position Foundry as "the product LangGraph teams wish they had already built."
