# Agent Namespace Ownership

**Canonical home of the 12-agent Sovereign Company Protocol roster: THIS repo**
(`src/services/scp/agents/`). Verified 2026-07-13: Foundry imports nothing
from AcreOS-side persona files; all cross-repo references in src are
provenance comments only ("adapted from AcreOS"), never imports.

- The empty persona stubs under AcreOS `sovereign-protocol/agents/` are
  non-canonical copies scheduled for deletion under a separate directive.
  Their removal cannot affect Foundry.
- Rule going forward: agent codenames, prompts, and eval cases live here.
  Any other repo that wants the roster consumes it through the Trust Plane
  (MCP), never by copying files.
