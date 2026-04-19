# Mental Model: LangGraph User -> Foundry

## What they expect (from LangGraph experience)
1. Define agent workflows as directed graphs with explicit state schemas and node routing
2. Inspect and modify agent state at breakpoints (human-in-the-loop)
3. Rely on durable execution with automatic checkpointing and resume-from-failure
4. Visualize agent execution in a studio/debugger showing graph traversal in real time
5. Deploy and manage agent runtimes with observability (traces, latency, token usage)

## Where they look in Foundry
- Graph definition: They look for a state machine or workflow editor. Foundry's agents follow a fixed execution pattern (BaseAgent v2), not a user-defined graph. The risk state machine (Green/Yellow/Red) is the closest graph-like structure, but it governs business state, not agent execution flow.
- Human-in-the-loop: They look for breakpoints or approval gates. Foundry's 5-gate authority system (Gate 0 autonomous through Gate 4 human-only) maps well conceptually, but the UX is decision queue approval, not state inspection and modification mid-execution.
- Durable execution: They expect checkpointing and resume. Foundry has no retry logic, no circuit breakers, no checkpointing on any external call -- this is a critical gap identified in the orientation audit.
- Studio / visualization: They look for a real-time execution viewer. Foundry's Fleet Observatory is aspirational (not built). No agent execution visualization exists.
- Observability: They expect traces, token counts, latency metrics. Foundry has no structured logging (422 console.log calls), no request tracing, no correlation IDs. Agent execution is opaque.

## Vocabulary differences
- "Graph" -> No equivalent (Foundry uses linear agent execution, not graph-based)
- "Node" -> Foundry uses "Agent" (the execution unit)
- "State" / "Checkpoint" -> No equivalent (no persistent execution state)
- "Thread" -> Foundry uses "Conversation Thread" (different meaning -- chat, not execution)
- "Breakpoint" -> Foundry uses "Gate" (approval threshold, not execution pause)
- "Edge" -> No equivalent (agent coordination is implicit, not routed)
- "Reducer" -> No equivalent

## Mental model mismatch severity: HIGH
## Key translation needed: LangGraph users think in terms of reliable, observable, stateful agent infrastructure; Foundry's agents deliver business value but lack the runtime primitives (durability, tracing, checkpointing) that LangGraph users consider non-negotiable.
