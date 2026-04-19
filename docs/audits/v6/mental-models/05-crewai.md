# Mental Model: CrewAI User -> Foundry

## What they expect (from CrewAI experience)
1. Define custom agents with specific roles, goals, backstories, and tool access
2. Compose agents into task-oriented crews with sequential or hierarchical orchestration
3. Assign tools to agents and observe their reasoning via execution traces
4. Build custom workflows (Flows) with deterministic routing between agent steps
5. Train agents with feedback to improve performance over time

## Where they look in Foundry
- Agent definition: They look for an agent editor or YAML config. Foundry's 12 agents are pre-defined (Atlas, Compass, Prism, etc.) with fixed roles -- there is no user-facing agent creation or customization. The "role/goal/backstory" pattern exists but is hardcoded.
- Crew composition: They look for a workflow builder. Foundry's SCP scheduler runs all 12 agents per product on a fixed hourly cadence. There is no user-configurable orchestration -- no way to create custom agent teams or task assignments.
- Tool access / tracing: They look for a trace viewer showing agent reasoning. Foundry has no equivalent to CrewAI's execution traces or LangGraph Studio. Agent outputs appear as signals and briefings, not as step-by-step reasoning logs.
- Custom workflows: No equivalent. Foundry's agent execution flow is fixed (load context -> check cadence -> analyzeAndAct -> process signals -> update health). No user-defined flows.
- Agent training: Golden lessons are injected into agent prompts, which is a form of learning. But there is no explicit training loop or user feedback mechanism that improves agent behavior.

## Vocabulary differences
- "Crew" -> Foundry uses "SCP" (Sovereign Company Protocol -- the full 12-agent team)
- "Task" -> Foundry uses "Signal" (output) or "Decision" (action requiring approval)
- "Tool" -> Foundry uses "Integration" (GitHub, Stripe, Slack, etc.)
- "Flow" -> No equivalent (Foundry's execution is cadence-based, not flow-based)
- "Kickoff" -> Foundry uses "Provisioning" (SCP instance creation)
- "Memory" -> Foundry uses "Golden Lessons" + "Decision Patterns" (partial overlap)
- "Guardrail" -> Foundry uses "Gate" (5-level authority system)

## Mental model mismatch severity: MEDIUM
## Key translation needed: CrewAI users think in terms of building custom agent systems from primitives; Foundry delivers a pre-built, domain-specific agent team -- the value is not customization but opinionated, expert autonomy out of the box.
