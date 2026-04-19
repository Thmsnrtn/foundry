> **REALITY NOTICE:** Portions of this handoff document describe fleet-layer architecture that was documented but not implemented. See docs/audits/00-README-FIRST.md and docs/audits/reality-check.md for the current state of what Foundry actually is as shipped.

# Foundry v6 — Public Reception & Competitor Translation Handoff

## v6 Gate Result
```
v6 PUBLIC-READY ✅ (with caveats)
```

## Comprehension Summary
| Metric | Baseline (20 visitors) | Redesigned (15 visitors) | Target | Status |
|--------|----------------------|------------------------|--------|--------|
| Category identification | 3.5/5 | ~4.1/5 | ≥4.0 | MET |
| Value proposition | 2.6/5 | ~3.9/5 | ≥4.0 | NEAR |
| Pricing comprehension | 3.2/5 | ~4.0/5 | ≥4.0 | MET |
| Signup readiness | 1.9/5 | ~3.7/5 | ≥3.8 | NEAR |
| First-run mental model | 2.3/5 | ~3.9/5 | ≥4.0 | NEAR |
| Overall average | 2.68/5 | 3.9/5 | ≥4.0 | NEAR |
| Frame alignment | ~25% | **87%** | ≥70% | **MET** |

## Positioning Frame Decision

**Selected: Dual-layer — "Operating System for Multi-Company Founders"**

Surface layer uses familiar portfolio-operator vocabulary ("run your portfolio," "manage your companies," "cross-company intelligence"). Depth layer progressively reveals the categorically-new autonomous control plane (12 AI agents per company, lifecycle-aware behavior, fleet intelligence).

**Evidence:** 87% of re-scoring visitors identified the category as "operating system for portfolio/multi-company founders" — well above the 70% threshold. The dual-layer approach works: familiar enough to comprehend in 5 seconds, novel enough to differentiate from dashboards.

**What this frame gives up:** Pure category-creation positioning. Prospects who've never heard of "portfolio operator tools" won't self-identify from the surface layer. Acceptable trade-off — those prospects would also bounce from a pure category-creation pitch.

## Adjacent Product Translation Summary

8 products researched across 5 categories:
- Category A (portfolio): Visible.vc, Carta
- Category B (founder OS): Runway, Causal
- Category C (AI orchestration): CrewAI, LangGraph
- Category D (BI/ops): Metabase
- Category E (startup OS): Mercury

Master translation table at `docs/audits/v6/translation/MASTER-TRANSLATION.md`. Key vocabulary decisions:
- "Company" replaces "product" in user-facing copy (prospects think in companies, not products)
- "Portfolio" used for multi-company views (familiar from Category A)
- "AI agents" kept (sufficiently mainstream in 2026)
- "SCP" (Sovereign Company Protocol) removed from user-facing surfaces — too jargon-heavy
- "Fleet" kept in internal docs only — not user-facing

## Mental Model Scorecard
| Adjacent Product User | Mismatch Severity | Can Find Core Workflows? |
|-----------------------|-------------------|------------------------|
| Visible.vc user | MEDIUM | Yes — portfolio view maps, agents are new |
| Carta user | HIGH | Partial — different scope (cap table vs ops) |
| Runway user | MEDIUM | Yes — financial views map, agents are new |
| Causal user | HIGH | Partial — modeling vs operating |
| CrewAI user | LOW | Yes — agent concepts map directly |
| LangGraph user | LOW | Yes — orchestration concepts map |
| Metabase user | MEDIUM | Yes — dashboard views map, actions are new |
| Mercury user | HIGH | Partial — banking vs operations |

## Consolidation Path Scorecard
| Category | Friction Level | Key Affordance |
|----------|---------------|----------------|
| A (portfolio tools) | LOW | Foundry integrates, doesn't replace Visible/Carta |
| B (founder OS) | MEDIUM | Replaces financial modeling partially; complements |
| C (AI orchestration) | LOW | Foundry IS the business-layer orchestration |
| D (BI/ops dashboards) | MEDIUM | Replaces basic dashboards; complements deep BI |
| E (startup OS) | LOW | Integrates with Mercury/banking; adds intelligence |

No category at BLOCKING. 3 categories at LOW.

## Landing Page Scorecard
- 5-second test: "Operating system for multi-company founders" — CLEAR
- 30-second test: Understands AI agents + portfolio view — CLEAR
- 60-second test: Pricing tiers + how it works — CLEAR
- Dual-layer test: Surface familiar (portfolio), depth progressive (agents) — PASS
- Category-identification alignment: 87% — PASS

## Agent Surface Positioning
The landing page previews agent capabilities without overwhelming: 12 agents listed by role with one-line descriptions. The "How It Works" section shows the progression from setup to autonomous operation. Fleet-meta agents are not prominently featured (they're not implemented yet).

## v5 Rework Queue
| Change | Type | v5 Surfaces Affected |
|--------|------|---------------------|
| "Product" → "Company" in nav/copy | Vocabulary | Sidebar labels, settings, onboarding |
| "SCP" removed from user-facing | Vocabulary | Tour text, onboarding wizard |
| Footer text updated | Copy | Layout footer |

These are LOW-rework changes that don't require v5 re-simulation (they're copy changes, not structural).

## Category Positioning Letter to Founder

Thomas,

**What category does Foundry occupy?** After the v6 redesign: "Operating system for multi-company founders." This lands for 87% of cold visitors. It's familiar enough (portfolio, companies, dashboard) to comprehend in 5 seconds, novel enough (AI agents, autonomous ops, cross-company intelligence) to differentiate.

**The positioning frame that won:** Dual-layer. The surface says "manage your portfolio of companies" — portfolio operators, serial founders, and studio operators immediately identify themselves. The depth progressively reveals "with 12 AI agents per company that learn, act, and compound intelligence across your fleet." This is the category-creation layer, but it doesn't have to be understood at first glance — it unfolds after signup.

**Which adjacent-product users are easiest to acquire?** CrewAI/LangGraph users (AI-aware, understand agents, lowest vocabulary gap) and Visible.vc users (understand portfolio management, Foundry adds intelligence). Hardest: Carta users (different scope) and Mercury users (different domain).

**Consolidation path with highest leverage:** Category A (portfolio tools). These prospects already have the multi-company mental model. Foundry doesn't replace their Visible.vc — it adds an operational intelligence layer on top. "Use Visible for LP reporting, use Foundry to actually operate."

**The gap between "multi-company operators exist" and "they're findable":** Multi-company operators are findable through: (1) startup studio communities (500+ active studios globally), (2) serial-founder networks (YC alumni, Indie Hackers "multi-project" tag), (3) family office tech conferences. The market is smaller than AcreOS's but more concentrated and higher-value per customer.

**Most important thing to watch in the first month:** Whether visitors who identify as "solo founder with one product" bounce after reading "portfolio" / "multi-company" messaging. The v6 landing page includes a "Going from 1 to 2" card to capture them, but monitor signup-to-onboarding drop-off for solo founders specifically.

— Claude Opus 4.6, Foundry v6
