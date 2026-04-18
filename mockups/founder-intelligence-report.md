# Foundry Founder Intelligence Report
## 175 Unique Founder Personas, Synthesized Insights & Platform Roadmap

*Generated: 2026-04-03*
*Purpose: Stress-test Foundry's architecture against the full spectrum of founder realities, extract platform-shaping insights, and produce a congruent roadmap that deepens Foundry's autonomous operational layer.*

---

# Part I: The 175 Founders

## Cohort 1: First-Time Founders (15 Personas)

### F-001: Maya Okonkwo
**Background:** Former high school biology teacher in Atlanta, 28. Taught AP Bio for 4 years before realizing her student lab-management spreadsheets had become a full product.
**Product:** LabFlow — SaaS for high school science departments to manage lab inventory, safety compliance, and experiment scheduling.
**Situation:** Quit teaching 3 months ago. Has 14 pilot schools but zero revenue. Terrified of pricing because her users are underfunded public schools. Her savings runway is 5 months. Doesn't know what MRR decomposition means.
**Key Insight:** Foundry's audit engine assumes commercial integrity (D6) means standard SaaS pricing, but education SaaS often uses district-level purchasing cycles (annual POs, not monthly cards). The billing dimension needs sector-aware scoring.

### F-002: Raj Malhotra
**Background:** 24-year-old CS graduate from Georgia Tech. Built a side project during senior year that went viral on Hacker News.
**Product:** DiffWatch — monitors open-source dependency changes and alerts teams to breaking changes before they hit CI.
**Situation:** 2,300 free users, 0 paying. Addicted to building features. Has never talked to a user 1:1. His GitHub stars are his dopamine. Doesn't understand why people won't pay for something they use daily.
**Key Insight:** Foundry's lifecycle system (Prompt 2 — Hypothesis Validation) forces user interviews before progression. For developer-tool founders like Raj, the system needs to recognize that "community signal" (GitHub issues, Discord messages) can supplement but not replace direct interviews.

### F-003: Elena Vasquez
**Background:** 35, former restaurant manager in Houston. Immigrant from Venezuela. Noticed every restaurant she worked at used paper for shift scheduling.
**Product:** TurnoSync — shift scheduling + tip pooling for independent restaurants.
**Situation:** Has a working MVP built by a freelancer on Upwork. 3 paying restaurants ($49/mo each). Can't modify the code herself. The freelancer ghosted. She's operationally brilliant but technically dependent.
**Key Insight:** Foundry's audit engine (8-step GitHub analysis) requires a connected repo. For no-code or outsourced-code founders, the audit needs an alternative intake path — perhaps manual checklist submission or Vercel/Netlify deployment analysis.

### F-004: Derek Washington
**Background:** 42, laid off from a mid-level product manager role at Salesforce. Two kids, mortgage in the Bay Area.
**Product:** PipeClean — a Salesforce add-on that auto-deduplicates and enriches lead data.
**Situation:** Built on Salesforce's AppExchange. Has 22 installs but only 4 paying ($199/mo). His biggest fear isn't the product — it's his wife's patience. He needs revenue traction in 90 days or he's going back to a job.
**Key Insight:** Foundry's scenario modeling (Gate 3) projects metrics at 30/60/90 days, but doesn't account for the founder's personal financial runway as a constraint variable. A "founder sustainability threshold" would make scenarios more honest.

### F-005: Aisha Nguyen
**Background:** 30, former UX researcher at Spotify. Half-Vietnamese, half-Senegalese, grew up in Paris. Moved to NYC for the startup scene.
**Product:** VoiceHive — qualitative research platform that uses AI to tag and cluster user interview transcripts.
**Situation:** Has a strong prototype and 8 design agencies on a waitlist. But she's a solo founder with imposter syndrome — every competitor (Dovetail, Condens) has $10M+ in funding. She's building evenings and weekends while freelancing to pay rent.
**Key Insight:** Foundry's competitive monitoring (weekly scan) surfaces competitor signals, but for founders facing well-funded incumbents, the system should also surface "incumbent blind spots" — areas where large competitors are structurally slow to move (pricing flexibility, niche verticals, speed of iteration).

### F-006: Tommy Kowalski
**Background:** 26, dropped out of a philosophy degree in Chicago. Self-taught coder. Lives with 3 roommates.
**Product:** MeetingDebt — tracks how much time your org spends in meetings and calculates the dollar cost, then suggests which recurring meetings to kill.
**Situation:** Went viral on Twitter/X with a demo video (400K views). 600 signups in a week, but 95% bounced after connecting their calendar. The product works but the onboarding is a wall. He's never shipped anything before and doesn't know how to diagnose a funnel.
**Key Insight:** Foundry's D10 (Stranger Test) catches onboarding friction, but for virality-driven founders, the system needs a "viral-to-retained" analysis mode — specifically measuring the decay curve from signup spike to active usage, not just first-session completion.

### F-007: Priya Shankar
**Background:** 39, former McKinsey consultant, MBA from Wharton. Left consulting to "build something real." Lives in Boston.
**Product:** BoardBridge — board meeting preparation platform for Series A-C startups. Auto-generates board decks from integrated data sources.
**Situation:** Has deep relationships in the VC world. 6 portfolio companies using the tool (free). VCs love it but founders see it as "homework." She's solving the buyer's problem (VCs) but the user's problem (founders) is different. Classic misaligned ICP.
**Key Insight:** Foundry's Product DNA (ICP Description + ICP Pain) should flag when the buyer and user are different personas. A "buyer-user alignment check" in the wisdom layer would catch this common B2B trap before it calcifies.

### F-008: Marcus Chen
**Background:** 31, former data engineer at Stripe. Born in Taiwan, raised in Seattle. Extremely technical, extremely introverted.
**Product:** SchemaShift — database migration tool that auto-generates rollback plans and tests migrations against production-replica data.
**Situation:** The product is exceptional. Infrastructure-grade code. But Marcus hasn't told anyone about it. No landing page, no Twitter, no ProductHunt. 2 users (both former colleagues). He believes "if it's good enough, people will find it." He's mass wrong.
**Key Insight:** Foundry's lifecycle system should detect "distribution silence" — when a technically strong product (high D1, D5, D9 scores) has near-zero acquisition signals. The system should trigger a positioning-first intervention rather than waiting for the founder to self-diagnose.

### F-009: Becca Thornton
**Background:** 45, former school principal in rural Iowa. Community organizer. Zero technical background.
**Product:** TownSquare — community engagement platform for rural municipalities (meeting scheduling, public comment collection, document sharing).
**Situation:** Built on Bubble.io. 2 townships using it. State government expressed interest but requires SOC 2 compliance. She doesn't know what SOC 2 is. The gap between her product and enterprise readiness feels insurmountable.
**Key Insight:** Foundry's D5 (Operational Readiness) scores security and compliance, but for non-technical founders, the remediation PR system is useless — they can't merge code. The platform needs a "compliance pathway advisor" that translates technical requirements into actionable vendor/contractor recommendations.

### F-010: Jordan Blake
**Background:** 22, just graduated from Howard University with a marketing degree. Built their first app during a hackathon.
**Product:** CampusPlug — marketplace connecting college students with local businesses for part-time gig work.
**Situation:** 200 students signed up at Howard. 12 local businesses listed. But Jordan is about to graduate and move home to Detroit, and the product only works with hyperlocal density. They need to figure out if this can expand beyond one campus.
**Key Insight:** Foundry's scenario modeling assumes continuous markets, but marketplace founders face discrete network-density thresholds. The system needs a "critical mass calculator" for marketplace products — modeling the minimum supply/demand density per geography before expansion makes sense.

### F-011: Nadia Petrov
**Background:** 33, former clinical psychologist in Denver. Burned out treating patients and realized the intake process was the bottleneck.
**Product:** IntakeIQ — AI-powered patient intake forms that pre-screen for clinical urgency and route to appropriate providers.
**Situation:** 5 therapy practices using it. HIPAA compliance is handled (she hired a consultant). But she's paralyzed by the liability question — what if the AI mis-triages and someone gets hurt? She's adding disclaimers everywhere instead of shipping features.
**Key Insight:** Foundry's decision queue should recognize "liability paralysis" as a stressor pattern — when a founder's pending decisions are all stalled by risk-aversion rather than information gaps. The recovery protocol should include a "risk framework" template specific to regulated industries.

### F-012: Sam Oduya
**Background:** 29, former logistics coordinator at Amazon's Lagos warehouse. Nigerian, moved to Austin on an H-1B through a consulting firm.
**Product:** RouteStack — last-mile delivery optimization for mid-size e-commerce brands using multiple 3PL providers.
**Situation:** His consulting firm employer found out about the side project and threatened to invoke the IP assignment clause. He's lawyering up while trying to keep building. The legal overhead is consuming all his bandwidth.
**Key Insight:** Foundry's stressor identification tracks product-level risks but not founder-level existential threats (IP disputes, visa dependency, legal action). A "founder risk layer" that monitors non-product threats would prevent the system from cheerfully optimizing metrics while the founder's world is on fire.

### F-013: Claire Dubois
**Background:** 48, former fashion buyer for Nordstrom. Lives in Portland. Recently divorced, using her settlement to fund the startup.
**Product:** StyleCircle — subscription box curation platform for independent boutiques (not the boxes themselves, but the software to manage inventory, subscriber preferences, and fulfillment).
**Situation:** 7 boutiques onboarded. Revenue: $2,100/mo. But churn is brutal — 3 boutiques cancelled in the last 2 months because the onboarding took too long (average 3 weeks to fully configure). She's spending all her time on customer success instead of product.
**Key Insight:** Foundry's cohort analysis tracks retention curves but doesn't distinguish between "product churn" (they tried and left) and "onboarding churn" (they never fully activated). Segmenting churn by activation stage would make the stressor identification far more actionable.

### F-014: Kofi Asante
**Background:** 36, Ghanaian-British, former investment banker at Barclays London. Relocated to Miami for the climate tech scene.
**Product:** CarbonLedger — carbon accounting SaaS for mid-market manufacturers who need to report Scope 1-3 emissions.
**Situation:** Regulatory tailwinds are strong (EU CSRD, SEC climate rules). 3 enterprise pilots. But the sales cycle is 6-9 months, and each customer needs heavy customization. He's building a services company disguised as a SaaS company and doesn't realize it.
**Key Insight:** Foundry's D6 (Commercial Integrity) should detect "services masquerading as SaaS" — when customization hours per customer exceed a threshold relative to subscription revenue. This is a structural business model issue that the audit should flag before the founder burns through runway.

### F-015: Lin Zhao
**Background:** 27, former game developer at Riot Games. Grew up in Chengdu, studied at USC. Creative, chaotic energy.
**Product:** QuestBoard — gamified project management for creative teams (XP points, skill trees, quest chains instead of sprints and tickets).
**Situation:** The product is delightful. 40 teams on free tier. But nobody converts to paid because the free tier is too generous. Lin keeps adding features to the free tier because he thinks "more features = more users = eventual money." He's building a charity.
**Key Insight:** Foundry's feature gating system (Founding Cohort / Growth / Scale tiers) is well-designed internally, but the platform should also analyze the founder's own product tier structure — detecting "value leakage" when high-engagement features sit below the paywall.

---

## Cohort 2: Technical Founders (15 Personas)

### F-016: Dmitri Volkov
**Background:** 40, ex-Google SRE (12 years). Russian-born, lives in Seattle. Has 3 kids and a stay-at-home wife depending on him.
**Product:** IncidentGraph — maps incident cascades across microservices to identify systemic fragility, not just root causes.
**Situation:** The product is architecturally brilliant. He built it the way Google would. Problem: it requires Kubernetes, Datadog integration, and a dedicated SRE to configure. His ICP should be 500-person engineering orgs, but he's trying to sell to 20-person startups because that's who responds on Twitter.
**Key Insight:** Foundry's ICP Pain in Product DNA should cross-reference with the product's technical requirements. When the minimum viable customer (infrastructure complexity) doesn't match the actual pipeline (small teams), the wisdom layer should flag the mismatch as a positioning stressor.

### F-017: Keiko Tanaka
**Background:** 34, former Apple iOS engineer. Japanese-American, lives in San Francisco. Perfectionist to a fault.
**Product:** PixelPerfect — automated visual regression testing for mobile apps. Screenshots every screen, diffs against baselines, flags unintended UI changes.
**Situation:** Has been building for 18 months. The product is extraordinary. But she keeps rewriting the diffing algorithm instead of launching. She's on version 4 of the core engine. Zero users because she's never put it in front of anyone. She thinks "v5 will be ready."
**Key Insight:** Foundry's lifecycle system needs a "ship velocity" signal — time between meaningful code commits and user-facing releases. When a founder is shipping code prolifically but never releasing, the system should trigger an intervention: "Your product is not getting better in isolation. Ship."

### F-018: Hassan Al-Rashid
**Background:** 37, former CTO of a YC W19 company that failed. Iraqi-American, lives in Austin. Carries the scars of a bad co-founder split.
**Product:** SyncPact — co-founder agreement platform that tracks equity vesting, decision rights, and responsibility matrices with version control for each change.
**Situation:** The product is born from pain. He lost 18 months and $400K because of a handshake co-founder agreement. Now he's building the tool he wished existed. 30 beta users from YC alumni network. But he's over-indexing on the legal complexity and under-indexing on the emotional UX — founders don't want to feel like they're lawyering up against their co-founder.
**Key Insight:** Foundry's D2 (Experience Coherence) evaluates functional consistency but not emotional tone. For products in sensitive domains (legal, health, finance), the audit should include a "tone-appropriateness" sub-dimension — is the product's emotional register aligned with the user's state of mind?

### F-019: Valentina Rossi
**Background:** 29, former backend engineer at Spotify. Italian, recently moved to Berlin. Speaks 4 languages.
**Product:** LocalizeFlow — continuous localization pipeline for SaaS products. Watches your codebase, extracts strings, machine-translates, then routes to human reviewers.
**Situation:** 12 teams using the free tier. Strong product-market fit signal (3 teams asked to pay before she had a pricing page). But she's terrified of infrastructure costs — every new customer spins up ML pipelines that cost her money. Her unit economics are inverted.
**Key Insight:** Foundry's MRR decomposition tracks revenue health, but doesn't model per-customer cost of service (COGS). For infrastructure-heavy SaaS, the health ratio should include a margin dimension — you can have growing MRR and still be losing money on every customer.

### F-020: Andre Williams
**Background:** 44, self-taught developer, former UPS driver. Black, lives in Memphis. Learned to code during COVID lockdowns through freeCodeCamp.
**Product:** DispatchBrain — route optimization for independent courier services and small delivery companies.
**Situation:** His first product. 5 courier companies using it ($79/mo each). The code is messy (he knows it), but it works. He's embarrassed to connect his GitHub to anything. Imposter syndrome is severe — he thinks "real developers" would laugh at his code.
**Key Insight:** Foundry's GitHub-dependent audit could be devastating for self-taught founders with messy codebases. The audit's critical findings (code quality, testing, documentation) need to be framed as growth opportunities, not judgments. The narrative layer should detect founder experience level and adjust tone.

### F-021: Nina Ostrovsky
**Background:** 32, ex-Cloudflare security engineer. Ukrainian, moved to the US in 2014. Lives in Denver.
**Product:** VaultSync — secrets management for small teams that can't afford (or don't need) HashiCorp Vault. Simple, opinionated, git-based.
**Situation:** 200 GitHub stars. A few open-source contributors. She wants to go open-core but doesn't know where to draw the line between free and paid. Every time she moves a feature behind a paywall, the community gets angry.
**Key Insight:** Foundry's commercial integrity dimension (D6) evaluates pricing/payment handling but doesn't address open-source monetization models. The platform needs open-core specific guidance — boundary-setting frameworks, community communication templates, and examples of successful open-core conversions.

### F-022: Takeshi Yamamoto
**Background:** 38, former ML researcher at DeepMind. Japanese, now in Toronto. Published 15 papers on graph neural networks.
**Product:** GraphSense — ML feature store that uses graph-based entity resolution to deduplicate and enrich customer data across fragmented sources.
**Situation:** The technology is groundbreaking. But his pitch deck reads like a research paper. He's been rejected by 12 VCs who "don't get it." He can explain the math but not the business value. His landing page has a LaTeX equation above the fold.
**Key Insight:** Foundry's D4 (Value Legibility) dimension is exactly what Takeshi needs, but the remediation should include concrete "translation exercises" — converting technical capability descriptions into customer outcome statements. The wisdom layer should detect "academic register" in positioning and flag it.

### F-023: Sarah Mitchell
**Background:** 41, ex-AWS principal engineer. American, lives in Portland. Mother of twins.
**Product:** InfraMap — auto-generates and maintains architecture diagrams from live AWS infrastructure. No manual diagramming.
**Situation:** 50 free users. Strong NPS (72). But she's building every feature request because she's used to Amazon's "customer obsessed" culture. Her roadmap is just a list of user requests. She has no product vision, just a feature factory.
**Key Insight:** Foundry's decision queue should detect "request-driven drift" — when a founder's product decisions are disproportionately sourced from user requests vs. strategic intent. The wisdom layer should periodically ask: "Which of these decisions advances your positioning, and which just makes existing users incrementally happier?"

### F-024: Carlos Mendez
**Background:** 26, bootcamp graduate (Lambda School). Mexican-American, lives in Phoenix. $80K in student loan debt from a degree he abandoned.
**Product:** DebtMap — student loan repayment optimizer that finds the mathematically optimal payoff strategy across multiple loans.
**Situation:** 1,200 free users (acquired through Reddit personal finance communities). Revenue: $0. He's afraid to charge because his users are people in financial distress. But he's in financial distress himself. The irony is not lost on him.
**Key Insight:** Foundry's D6 (Commercial Integrity) needs a "pricing psychology" module for founders serving financially sensitive audiences. The remediation shouldn't just say "add a paywall" — it should model freemium strategies where the free tier genuinely helps and the paid tier captures value from power users or adjacent personas (financial advisors, schools).

### F-025: Ingrid Bergstrom
**Background:** 36, former DevOps lead at Shopify. Swedish-Canadian, lives in Ottawa. Runs ultramarathons. Disciplined to a fault.
**Product:** DeplopyGuard — pre-deployment validation that checks 40+ production readiness criteria before allowing a deploy to proceed.
**Situation:** She has 8 enterprise customers ($500/mo each). Revenue is $4K/mo. But every customer needs custom validation rules, and she's the one writing them. She's scaling linearly — more customers = more hours. She needs to make rule-authoring self-serve but keeps deprioritizing it because custom rules = customer intimacy.
**Key Insight:** Foundry's scenario modeling should include a "scaling mode" analysis — projecting not just revenue but founder time commitment per customer at 2x, 5x, and 10x current customer count. This would surface the "linear scaling trap" before the founder burns out.

### F-026: Omar Farid
**Background:** 33, ex-Palantir engineer. Egyptian-American, lives in DC. Has a TS/SCI clearance.
**Product:** GovQuery — natural language interface for querying government procurement databases (SAM.gov, FPDS, USASpending).
**Situation:** 4 government contractors using the product ($299/mo). The product works beautifully. But selling to government-adjacent customers requires FedRAMP authorization, which costs $300K+ and takes 12-18 months. He's in a catch-22: can't get big customers without FedRAMP, can't afford FedRAMP without big customers.
**Key Insight:** Foundry's stressor system should recognize "compliance gatekeeping" as a market-structure stressor, not just a product issue. The scenario modeling should include "compliance-first" vs. "commercial traction-first" pathways with realistic timelines and capital requirements.

### F-027: Zara Obi
**Background:** 28, ex-Stripe engineer. Nigerian-British, lives in London. Obsessed with developer experience.
**Product:** PayRoute — payment orchestration layer that lets SaaS companies failover between payment processors (Stripe, Adyen, Braintree) automatically.
**Situation:** The product directly competes with her former employer's interests (Stripe wants lock-in, she's selling portability). She's paranoid about retaliation — will Stripe deprecate the APIs she depends on? Will they hire her competitors? She's building defensively instead of ambitiously.
**Key Insight:** Foundry's competitive monitoring scans for signals, but doesn't model "platform dependency risk" — when a product's existence depends on an incumbent's API goodwill. The stressor system should treat platform-dependency as a structural risk factor, with scenario modeling for API deprecation and alternative architectures.

### F-028: Luke Brennan
**Background:** 30, self-taught systems programmer. Australian, lives in Melbourne. Former electrician who learned Rust during a knee injury recovery.
**Product:** WireShark-lite (working title: PacketPeek) — simplified network packet analysis tool for small IT teams who find Wireshark overwhelming.
**Situation:** Exceptional product. Desktop app with a CLI. But he has no idea how to sell software. He posted it on a Rust forum, got praise from developers, but his actual customers should be IT managers at SMBs. He's marketing to builders, not buyers.
**Key Insight:** Foundry's Product DNA should detect "channel-audience mismatch" — when the founder's marketing channels reach a different persona than their paying ICP. The wisdom layer should map "where you're visible" against "who pays you" and flag divergence.

### F-029: Diana Cho
**Background:** 35, former security researcher at CrowdStrike. Korean-American, lives in Austin. Published multiple CVEs.
**Product:** ThreatCanvas — visual threat modeling tool that integrates with code repos to auto-identify attack surfaces as architecture evolves.
**Situation:** 15 security teams on a free pilot. The product is loved. But Diana keeps adding depth (more threat frameworks, more integration points) instead of breadth (more customers). She's building the world's best threat modeling tool for 15 teams instead of a good-enough tool for 1,500 teams.
**Key Insight:** Foundry's D8 (Competitive Defensibility) evaluates unique advantage, but should also flag "over-engineering depth at the expense of distribution." The lifecycle system should ask: "At your current stage, is another feature more valuable than another 100 users?"

### F-030: Pavel Novak
**Background:** 43, ex-Oracle database architect. Czech, lives in Prague, building for the US market remotely.
**Product:** QueryCoach — AI-powered SQL query optimizer that explains why queries are slow and suggests specific index/schema changes.
**Situation:** 200 users on a free plan. 8 paying ($49/mo). His problem: the product is too good at solving one-time problems. Users optimize their worst queries, then churn because they don't need it anymore. Usage is spiky, not habitual.
**Key Insight:** Foundry's retention analysis tracks cohort decay but doesn't diagnose "problem exhaustion churn" — when users leave not because the product failed but because it succeeded too well at a finite task. The wisdom layer should identify products with "consumable" value props and suggest retention mechanics (continuous monitoring, team scaling, adjacent problems).

---

## Cohort 3: Non-Technical Founders (15 Personas)

### F-031: Gabriella Santos
**Background:** 38, former HR director at a 500-person logistics company. Brazilian-American, lives in Atlanta. Speaks Portuguese, English, Spanish.
**Product:** OnboardIQ — employee onboarding workflow builder for mid-market companies. No-code, drag-and-drop.
**Situation:** Built on Retool. 11 companies using it ($149/mo). Revenue: $1,639/mo. But she hit Retool's limits — complex conditional logic breaks, and she can't customize the UI beyond what Retool allows. She needs to migrate to a custom codebase but doesn't know how to hire or evaluate a developer.
**Key Insight:** Foundry's remediation system generates GitHub PRs, which is useless for no-code founders. The platform needs a "technical transition advisor" — when a no-code product hits infrastructure limits, Foundry should guide the migration with contractor evaluation criteria, tech stack recommendations, and migration risk assessment.

### F-032: Michael Okafor
**Background:** 52, retired NFL player (8 seasons, defensive end). Nigerian-American. Lives in Dallas. No tech background but excellent at sales.
**Product:** AthleteVault — financial management platform for professional athletes (budgeting, contract visualization, advisor matching).
**Situation:** Michael's network is his moat — he knows 200+ current and former NFL players personally. 15 are using the product. But the product was built by a dev agency that charged $180K, delivered a WordPress site with plugins, and disappeared. It barely works. He needs a real product but has already been burned.
**Key Insight:** Foundry's audit engine should have a "vendor assessment" mode — evaluating not just the product as-is, but the quality and maintainability of agency-delivered code. The system should flag "agency debt" (non-standard architecture, missing tests, no CI/CD, hard-coded configurations) as a distinct stressor.

### F-033: Rachel Kim
**Background:** 41, former real estate broker. Korean-American, lives in LA. Top 1% in her market for 6 years.
**Product:** ShowFlow — open house management platform (visitor sign-in, follow-up automation, listing analytics for agents).
**Situation:** 45 agents using it. MRR: $2,250. Great traction. But she built it with a technical co-founder who just got a job offer at Google for $450K. He's leaving in 30 days. She owns 100% of the company but 0% of the technical capability. She's about to lose her entire engineering capacity.
**Key Insight:** Foundry should track "key person dependency" as a risk factor — when a product's entire technical capability rests on one person (co-founder, contractor, or employee). The stressor system should model the impact of that person's departure and recommend mitigation (documentation, pair programming, hiring pipeline).

### F-034: Jamal Richardson
**Background:** 46, former church pastor. African-American, lives in Charlotte. Led a 2,000-member congregation for 12 years.
**Product:** FaithOps — church management platform (member database, giving, small group coordination, volunteer scheduling).
**Situation:** 8 churches using it ($99/mo). His community trusts him deeply. But he's drowning in feature requests — every pastor wants something slightly different. He can't prioritize because he sees every request as pastoral care. He needs someone (or something) to tell him "no."
**Key Insight:** Foundry's decision queue should recognize "empathy-driven scope creep" — when a founder approves every request because they can't separate customer care from product strategy. The system should explicitly score requests against Product DNA positioning and ICP pain, giving the founder objective grounds to say no.

### F-035: Patricia Volkov
**Background:** 55, former hotel general manager at Marriott (25 years). Russian-American, lives in Miami.
**Product:** GuestSignal — guest experience analytics for independent hotels (sentiment analysis of reviews, operational correlation, staff performance patterns).
**Situation:** 6 hotels using it. Revenue: $1,800/mo. Patricia knows the industry inside and out but she's building the product she would have wanted 10 years ago, not the product today's hoteliers need. The industry has shifted to short-term rentals, and she's ignoring Airbnb hosts as a market.
**Key Insight:** Foundry's competitive scanning monitors named competitors but should also detect "market migration" — when the customer segment itself is shifting to a different form factor (hotels → STRs, taxis → rideshare, retail → e-commerce). The wisdom layer should surface market structure changes, not just competitive moves.

### F-036: Wendy Nakamura
**Background:** 43, former wedding planner. Japanese-American, lives in Honolulu. Built a referral empire with no technology.
**Product:** AlohaBook — wedding vendor coordination platform (timeline management, vendor communication, budget tracking, day-of logistics).
**Situation:** 20 wedding planners using it, all from her personal network. Revenue: $1,980/mo. But she's hitting a ceiling — her network is tapped out, and she doesn't know how to acquire customers beyond word-of-mouth. Her product is great for planners she knows, but invisible to everyone else.
**Key Insight:** Foundry's lifecycle system should detect "network ceiling" — when acquisition is 100% referral-based and the founder has no scalable channel. The intervention should be earlier than Prompt 2.5 (Tier Calibration) — it's a core positioning issue that blocks all growth.

### F-037: Thomas Greene
**Background:** 60, semi-retired CPA. American, lives in Scottsdale. 35 years in tax accounting.
**Product:** TaxTrail — automated tax document collection for small accounting firms (chases clients for W-2s, 1099s, etc. so the accountant doesn't have to).
**Situation:** 4 accounting firms using it (including his own former firm). Revenue: $596/mo. It's tax season and the product is saving his users hundreds of hours. But tax season is 4 months long, and nobody cares the other 8 months. His product has severe seasonality.
**Key Insight:** Foundry's metric snapshots are daily, but for seasonal products, the system should normalize against seasonal baselines — February churn in a tax product isn't alarming, but April churn is catastrophic. The stressor thresholds need seasonal adjustment.

### F-038: Amara Diallo
**Background:** 34, former community health worker in Minneapolis. Senegalese-American. Deeply connected to the immigrant healthcare access problem.
**Product:** HealthBridge — platform connecting immigrants and refugees with culturally competent healthcare providers who speak their language.
**Situation:** 300 registered patients, 40 providers. Revenue: $0 (funded by a small grant that expires in 6 months). The product is a marketplace but she's treating it like a nonprofit. She needs to find a revenue model that doesn't price out the people she's trying to help.
**Key Insight:** Foundry's Commercial Integrity dimension assumes monetization is a goal. For impact-first founders, the platform needs a "sustainability model advisor" that explores provider-side fees, grant stacking, government contracts, and hybrid models — not just "add a paywall."

### F-039: Richard Hartley
**Background:** 58, former car dealership owner. American, lives in Birmingham, Alabama. Sold 3 dealerships. Bored in retirement.
**Product:** DealerPulse — inventory management and pricing intelligence for independent used car lots.
**Situation:** 12 dealerships using it ($199/mo). Revenue: $2,388/mo. Richard doesn't need the money — he needs the purpose. But his design sensibility is stuck in 2005. The product UI looks like a Windows XP application. His users (old-school car guys) don't care, but it limits his market to that demographic.
**Key Insight:** Foundry's D2 (Experience Coherence) scores UI consistency, but should also assess "design era" — when a product's visual language limits its addressable market to a demographic subset. The remediation should include design system migration paths, not just code fixes.

### F-040: Lisa Moreau
**Background:** 37, former brand strategist at Ogilvy. French-Canadian, lives in Montreal. Built brands for Fortune 500s.
**Product:** BrandPulse — brand health monitoring for DTC brands (social sentiment, review analysis, competitor messaging tracking).
**Situation:** 8 DTC brands using it ($249/mo). Revenue: $1,992/mo. Lisa's product is data-rich but insight-poor — the dashboards show everything but recommend nothing. She keeps adding data sources instead of building the "so what" layer. She's building a BI tool, not a brand advisor.
**Key Insight:** Foundry's D4 (Value Legibility) should distinguish between "data display" and "decision support" products. When a product surfaces information without actionable recommendations, it's a value legibility issue. The audit should flag "insight deficit" — the gap between data shown and decisions enabled.

### F-041: Andre Petit
**Background:** 49, former restaurant chain operator (8 locations). Haitian-American, lives in Fort Lauderdale.
**Product:** KitchenCast — kitchen display system with demand forecasting for fast-casual restaurants.
**Situation:** 5 restaurant locations using it (his former business partner's chain). Revenue: $745/mo. The product works, but he's stuck in one customer. He's afraid to sell to other restaurants because he doesn't know if the product works outside the Haitian food prep patterns he optimized for.
**Key Insight:** Foundry's hypothesis validation (Prompt 2) should distinguish between "validated with one customer deeply" and "validated across customer diversity." The lifecycle system should recognize single-customer dependency and require breadth validation before progression.

### F-042: Sandra Hoffmann
**Background:** 44, former nurse practitioner. German-American, lives in Milwaukee. Left healthcare after burnout.
**Product:** ShiftCare — nurse scheduling platform that accounts for licensure requirements, overtime regulations, and burnout risk scores.
**Situation:** 3 clinics using it. Revenue: $447/mo. She knows the problem intimately. But she's building every feature based on her own 15 years of nursing experience rather than her customers' actual workflows. She's projecting her experience onto her users.
**Key Insight:** Foundry's Product DNA should track "founder-ICP distance" — how far the founder's own experience is from their current customers' reality. When a founder IS the ICP persona, there's a bias risk: building for yourself circa 5 years ago instead of your customers today. The wisdom layer should flag this.

### F-043: Kevin O'Brien
**Background:** 39, former firefighter. Irish-American, lives in Boston. Lost his best friend in a training accident due to communication failure.
**Product:** CrewComm — real-time communication and accountability platform for fire departments (who's where, who's doing what, who needs help).
**Situation:** 2 fire departments piloting it (free). The product could save lives. But fire department procurement is political, slow, and requires city council approval. Kevin's passion is limitless but his patience for bureaucracy is not. He's about to give up.
**Key Insight:** Foundry's lifecycle system should recognize "mission-critical patience" — when a product has clear value but operates in a procurement environment that requires years of relationship-building. The stressor system should model "sales cycle fit" — matching the founder's runway to the customer's buying timeline.

### F-044: Mia Johansson
**Background:** 31, former event planner. Swedish, lives in Stockholm, building for the US market remotely.
**Product:** VenueMatch — AI-powered venue recommendation engine for corporate event planners.
**Situation:** Launched 2 months ago. 150 signups. 0 revenue. She's getting lots of "this is cool" but zero buying intent. The problem: event planners already have venue relationships and don't want AI replacing their judgment. She's solving a problem her users don't think they have.
**Key Insight:** Foundry's Prompt 2 (Hypothesis Validation) should include a "problem acknowledgment" test — not just "does the product solve the problem?" but "does the customer believe the problem exists?" When users say "cool" but don't buy, it's often a problem-awareness gap, not a solution gap.

### F-045: Robert Tran
**Background:** 50, former insurance adjuster. Vietnamese-American, lives in Houston. 25 years in property damage assessment.
**Product:** ClaimSnap — mobile app for property owners to document damage for insurance claims (guided photo capture, AI damage assessment, auto-generated claim narratives).
**Situation:** 200 downloads. 15 active users. The app works well when there's a hurricane or flood, but his usage is entirely event-driven. Between disasters, the app is dormant. He needs to find a non-catastrophic use case or accept extreme usage volatility.
**Key Insight:** Foundry's metric snapshots assume continuous usage patterns. For event-driven products, the system needs a "dormancy tolerance" mode — distinguishing between concerning churn and expected dormancy. The risk state engine should not trigger Yellow/Red during known dormant periods.

---

## Cohort 4: Serial Founders (13 Personas)

### F-046: David Chen
**Background:** 44, third startup. First was a modest exit ($2M acquihire by DocuSign). Second failed (B2B marketplace, burned $4M in VC). Stanford MBA.
**Product:** SignalStack — predictive analytics for B2B sales pipelines. Uses CRM data + communication patterns to predict deal outcomes.
**Situation:** Raised a $1.5M seed round based on reputation. 10 design partners. But he's repeating his second startup's mistake — building too much before validating. He knows this intellectually but can't stop himself. The trauma of failure makes him over-build as a defense mechanism.
**Key Insight:** Foundry's founder judgment patterns should detect "overcorrection cycles" in serial founders — when a founder's behavior oscillates between the failure mode of their last company and its opposite. The wisdom layer should surface the pattern: "You under-built last time, now you're over-building. The middle path is X."

### F-047: Samantha Wright
**Background:** 39, second startup. First was a consumer social app that reached 500K users but never monetized (shut down after 3 years). Former Facebook product manager.
**Product:** CreatorVault — financial planning platform for full-time content creators (income smoothing, tax estimation, sponsor contract management).
**Situation:** 40 creators on beta. Strong signal. But she's terrified of the "second startup curse" — her first startup got press coverage, users, awards, and still died. She's overcorrecting by focusing only on revenue, ignoring growth. Her NPS is 82 but she hasn't acquired a new user in 6 weeks.
**Key Insight:** Foundry's risk state engine weighs multiple signals, but for serial founders, the system should calibrate against their stated fears. If a founder explicitly identifies "I'm worried about X," the system should monitor whether they're overcompensating by neglecting Y. Balance, not just safety.

### F-048: James Nakamura
**Background:** 51, fourth startup. Two exits (one acquihire, one $8M sale), one failure. Japanese-American, lives in LA. Legendary network.
**Product:** BoardReady — automated board reporting for portfolio companies. Pulls from Stripe, Quickbooks, HRIS, and generates investor-grade reports.
**Situation:** 25 portfolio companies using it (free, through his VC connections). Revenue: $0. He's repeating a serial founder pattern: building a "nice to have" product with a great network instead of a "must have" product with a real market. His network gets him distribution but masks product-market fit.
**Key Insight:** Foundry's Prompt 2 (Hypothesis Validation) should flag "network-subsidized traction" — when all beta users come through personal relationships. The system should require at least 30% of beta users to be acquired through scalable channels before marking hypothesis validation as complete.

### F-049: Angela Rossi
**Background:** 36, second startup. First was a fashion-tech company that raised $3M and ran out of money fighting inventory risk. Italian-American, lives in NYC.
**Product:** StyleAPI — fashion trend prediction API for e-commerce brands (predicts which styles will sell next season based on social, runway, and search data).
**Situation:** 6 e-commerce brands on pilot. The API works. But she's pricing it as a premium product ($2K/mo) because her last startup failed from underpricing. Now she's overpricing for her current market (mid-size DTC brands with $50K/mo revenue). Classic serial founder pendulum.
**Key Insight:** Foundry's D6 (Commercial Integrity) should detect "trauma-based pricing" — when pricing decisions are driven by prior startup trauma rather than current market analysis. The scenario modeling should include pricing sensitivity analysis comparing the founder's price point against the customer's budget capacity.

### F-050: Brian Torres
**Background:** 47, third startup. First two were acqui-hired (decent, not life-changing). Former Amazon principal PM. Lives in Seattle.
**Product:** FulfillOS — warehouse management system for DTC brands doing their own fulfillment (not using 3PLs).
**Situation:** 8 customers ($399/mo). Revenue: $3,192/mo. Profitable, growing, boring. Brian's problem is ambition mismatch — he wants to build a $100M company but he has a $5M company. He keeps trying to add features that would matter at scale (multi-warehouse, international shipping) instead of deepening the features that matter now (inventory accuracy, pick/pack optimization).
**Key Insight:** Foundry's lifecycle system should assess "stage-appropriate ambition" — detecting when a founder's feature roadmap is optimized for a company 10x their current size. The decision queue should flag features with "this solves a problem you'll have at $50K MRR, but you're at $3K MRR" analysis.

### F-051: Rebecca Osei
**Background:** 42, second startup. First was an edtech company in Ghana that reached 50K students but couldn't monetize (shut down, pivoted to consultancy). Ghanaian, now lives in London.
**Product:** LearnLoop — micro-learning platform for corporate training (5-minute modules, spaced repetition, manager dashboards).
**Situation:** 3 enterprise clients. Revenue: $4,500/mo. Her first startup taught her that usage doesn't equal revenue. Now she's hyper-focused on monetization but neglecting the learning experience. Her completion rates are 23% — the product makes money but doesn't deliver value.
**Key Insight:** Foundry's stressor system should monitor "value delivery metrics" alongside revenue metrics. When a product has healthy MRR but declining engagement/completion/satisfaction, it's a leading indicator of churn. The health ratio should include a "value-delivery index" — are customers getting what they're paying for?

### F-052: Marcus Lindgren
**Background:** 38, third startup. Two failures (both B2B marketplaces). Swedish, lives in Stockholm. Keeps trying the same model.
**Product:** FreelanceHub — marketplace connecting freelance developers with short-term project contracts.
**Situation:** 500 freelancers registered, 30 companies. 12 completed projects. Revenue: $1,200/mo (15% take rate). The chicken-and-egg problem is real, as always. Marcus intellectually understands marketplace dynamics but emotionally can't stop himself from trying again. He loves the model even though it keeps failing him.
**Key Insight:** Foundry's founder judgment patterns should detect "model fixation" — when a serial founder keeps attempting the same business model despite repeated failures. The system should surface the pattern without judgment but with data: "This is your 3rd marketplace. Previous marketplaces failed at the liquidity stage. What's structurally different this time?"

### F-053: Jennifer Park
**Background:** 45, fifth startup. Two exits, two failures. Korean-American, lives in SF. Angel investor on the side. Known in the ecosystem.
**Product:** FounderOS — operating system for first-time founders (templates, playbooks, community, mentorship matching).
**Situation:** She's building a direct competitor to Foundry's ethos, but as a content/community product rather than an AI-driven platform. 200 members ($29/mo). Revenue: $5,800/mo. The irony: she could benefit most from Foundry's autonomous layer because she's running 5 angel investments simultaneously and has no bandwidth for her own product.
**Key Insight:** Foundry should recognize its own competitive landscape — community-based founder support platforms. The differentiation is clear (autonomous AI vs. community/content), but the onboarding should acknowledge: "You might already be in a founder community. Foundry doesn't replace that — it replaces the operational layer those communities can't provide."

### F-054: Ryan O'Malley
**Background:** 40, second startup. First raised $12M, reached $2M ARR, then imploded (co-founder fraud). American, lives in Denver.
**Product:** TrustLayer — automated background check and verification platform for startup hires (employment, education, reference verification).
**Situation:** 20 companies using it ($99/mo). Revenue: $1,980/mo. Ryan's first startup trauma has made him a control freak — he reviews every line of code, every customer interaction, every email. He's a bottleneck. His CTO (employee #1) is about to quit because there's no autonomy.
**Key Insight:** Foundry's gate system (0-4) is designed for product autonomy, but the concept translates to founder behavior too. The wisdom layer should detect "founder bottleneck" patterns — when all decisions flow through one person. The system should model what happens if the founder gets sick for 2 weeks: which decisions stall?

### F-055: Diana Volkov
**Background:** 37, third startup. One failure, one acquihire. Russian-American, lives in Austin. Excellent technical founder but poor at hiring.
**Product:** HireSignal — technical interview platform that predicts job performance using work sample tests instead of algorithms/LeetCode.
**Situation:** 15 companies using it. Revenue: $3,750/mo. But her own team keeps churning — she's hired and lost 4 engineers in 12 months. The irony: her product helps other companies hire well, but she can't retain her own people. She's technical but emotionally unintelligent as a manager.
**Key Insight:** Foundry is product-focused, but founder operational capacity directly affects product trajectory. The platform should detect "founder operational stress" — when churn, hiring gaps, or team dysfunction are bottlenecking product development. This isn't product intelligence; it's founder intelligence.

### F-056: Alex Petrov
**Background:** 34, second startup. First was a crypto project that made $2M in 2021 and lost $1.8M in 2022. Bulgarian, lives in Lisbon.
**Product:** ComplianceBot — automated crypto compliance monitoring for DeFi protocols (wallet screening, transaction monitoring, regulatory reporting).
**Situation:** 5 protocols using it ($499/mo). Revenue: $2,495/mo. The product fills a real need as regulation increases. But Alex's reputation from the crypto crash follows him — investors don't trust him, and some customers are wary. He needs to rebuild credibility slowly, but the market window is closing fast.
**Key Insight:** Foundry's competitive monitoring should include "regulatory window analysis" — detecting when a market is being shaped by incoming regulation and modeling the timing advantage/disadvantage. For founders in regulated-by-incoming-law markets, speed-to-compliance is a competitive variable.

### F-057: Michelle Huang
**Background:** 43, fourth startup. Three exits (all small, $1-3M each). Taiwanese-American, lives in Seattle. Known as "the execution machine."
**Product:** RetainIQ — customer health scoring and automated intervention platform for B2B SaaS companies.
**Situation:** 12 customers. Revenue: $5,400/mo. Growing steadily. Michelle's problem is the opposite of most founders — she executes too efficiently and doesn't think strategically. She'll hit $50K MRR doing exactly what she's doing, but she'll never hit $500K because she doesn't invest in positioning, brand, or category creation.
**Key Insight:** Foundry's lifecycle system should distinguish between "execution-constrained" and "strategy-constrained" founders. For execution-constrained founders (most), Foundry's operational layer is immediately valuable. For strategy-constrained founders like Michelle, the system should surface strategic inflection points: "You're growing linearly. What would make growth nonlinear?"

### F-058: Tom Bradley
**Background:** 55, sixth startup. Three exits, two failures. Serial entrepreneur archetype. American, lives in Scottsdale. Golfs 3x/week.
**Product:** DealRoom — virtual data room for M&A transactions, specifically designed for companies under $10M revenue.
**Situation:** 8 customers ($199/mo). Revenue: $1,592/mo. Tom is building this as a "lifestyle business" — he doesn't want VC, doesn't want to scale aggressively, just wants $30K/mo in recurring revenue so he can golf and travel. But Foundry's systems are tuned for growth-oriented founders.
**Key Insight:** Foundry should support "lifestyle-mode" founders explicitly — adjusting stressor thresholds, scenario modeling, and digest urgency for founders optimizing for sustainability rather than scale. The risk state engine should have a "steady state" mode where flat growth isn't a stressor.

---

## Cohort 5: Domain Expert Founders (14 Personas)

### F-059: Dr. Anika Patel
**Background:** 42, board-certified dermatologist. Indian-American, lives in Chicago. 15 years of clinical practice.
**Product:** DermIQ — AI-powered skin lesion analysis for primary care physicians (not dermatologists) to improve triage accuracy.
**Situation:** 12 clinics in a pilot. The product has 94% sensitivity on benign/malignant classification. But the FDA regulatory path is unclear — is this a Class II medical device? She's been told she needs a 510(k) submission. The regulatory cost could be $500K-$1M. She has $50K in savings.
**Key Insight:** Foundry's scenario modeling should include "regulatory pathway branching" — when a product's go-to-market depends on regulatory classification, the system should model each pathway (510(k) vs. enforcement discretion vs. clinical decision support exemption) with cost, time, and probability estimates.

### F-060: Chef Marcus Williams
**Background:** 48, James Beard-nominated chef. African-American, lives in New Orleans. 25 years in restaurants.
**Product:** PlateCost — real-time food cost management for restaurants (ingredient tracking, menu pricing optimization, waste reduction).
**Situation:** 15 restaurants using it. Revenue: $2,235/mo. Marcus built exactly what he needed when he ran his own restaurant. The problem: he's the product, marketing, and support team. When he does a demo, restaurants sign up immediately — his credibility is off the charts. But he can't clone himself.
**Key Insight:** Foundry should detect "founder-as-channel-dependency" — when the founder's personal credibility is the primary conversion mechanism. The system should recommend "credibility scaling" strategies: video testimonials, case studies, partner certifications, and eventually a sales team that carries the founder's story, not the founder.

### F-061: Colonel (Ret.) James Bradford
**Background:** 56, retired Army logistics officer. 28 years of service. Lives in Virginia. Multiple combat deployments.
**Product:** ReadyState — unit readiness tracking platform for military reserve and National Guard units (training completion, equipment status, personnel availability).
**Situation:** 2 National Guard units testing it (free). The product is perfect for the problem. But military procurement is a labyrinth — he needs a contracting officer, a CLIN structure, an Authority to Operate (ATO), and infinite patience. He has the patience (military trained) but not the cash.
**Key Insight:** Foundry's lifecycle system assumes commercial SaaS timelines. For government/military SaaS, the entire lifecycle should stretch — "cold start" might last 18 months instead of 3. The system needs a "procurement-adjusted lifecycle" that doesn't punish founders for sales cycles they can't control.

### F-062: Dr. Sarah Okonkwo
**Background:** 39, PhD in educational psychology. Nigerian-British, lives in Manchester. Spent 10 years researching reading acquisition in multilingual children.
**Product:** ReadBridge — adaptive reading instruction platform that adjusts to children who speak multiple languages at home, using code-switching as a pedagogical tool rather than a problem to fix.
**Situation:** 5 schools in a pilot. The product is research-backed and effective. But school budgets require headteacher approval, and Sarah's PhD vocabulary alienates non-academic buyers. She says "phonological awareness in L2 contexts" when she should say "helps your multilingual kids read faster."
**Key Insight:** Foundry's D4 (Value Legibility) remediation should include "audience translation" — detecting when a founder's product description uses specialist vocabulary that their buyer doesn't share. The system should suggest simplified messaging for different stakeholder levels (teacher, headteacher, district purchaser, parent).

### F-063: Dr. Robert Kim
**Background:** 45, former pharmaceutical researcher (Pfizer, 12 years). Korean-American, lives in New Jersey. 8 patents in drug delivery systems.
**Product:** TrialFlow — clinical trial recruitment and management platform for small pharma/biotech companies running Phase I-II trials.
**Situation:** 3 biotech companies using it ($999/mo). Revenue: $2,997/mo. The product is excellent. But Robert is too scientific and not enough product manager — he keeps adding features for edge cases in clinical trial design that affect 2% of trials. His roadmap reads like a pharmacology textbook.
**Key Insight:** Foundry's decision queue should include "impact-reach scoring" — estimating what percentage of the user base each feature request affects. When a founder consistently builds for the 2% case, the system should surface: "This feature serves 3/150 customers. Are you sure?"

### F-064: Maria Gonzalez
**Background:** 50, former immigration attorney. Mexican-American, lives in Phoenix. 20 years of immigration law practice.
**Product:** VisaTrack — case management platform for immigration law firms (deadline tracking, form auto-fill, status updates for clients).
**Situation:** 8 law firms using it ($199/mo). Revenue: $1,592/mo. Immigration law changes constantly (executive orders, policy memos, court decisions). Her biggest challenge: keeping the product current. Every time the administration changes policy, she has to update forms, deadlines, and workflows. It's a content treadmill.
**Key Insight:** Foundry's stressor system should recognize "regulatory volatility" as an ongoing cost structure, not a one-time risk. The system should model the ongoing engineering cost of regulatory compliance as a permanent drag on margin and factor it into financial health calculations.

### F-065: Captain (Ret.) Lisa Chen
**Background:** 47, former airline pilot (United, 18 years). Chinese-American, lives in Denver. Meticulous, safety-obsessed.
**Product:** CrewFatigue — fatigue risk management system for regional airlines (predicts pilot fatigue based on schedule, sleep data, and circadian models).
**Situation:** 1 regional airline testing it. The product could prevent accidents. But aviation software requires DO-178C certification, which costs $1-2M. She's trying to sell a $500/mo SaaS product that costs $2M to certify. The math doesn't work at small scale.
**Key Insight:** Foundry's scenario modeling should detect "certification cost vs. TAM mismatch" — when the cost of entering a regulated market exceeds what the addressable market can pay at the founder's current pricing. The system should model minimum viable pricing that recovers certification costs over N customers.

### F-066: Dr. James Obi
**Background:** 38, veterinarian with a focus on exotic animals. Nigerian-American, lives in Miami. Runs his own practice.
**Product:** ExoticRx — telemedicine platform for exotic pet owners (reptiles, birds, small mammals) to consult with specialized vets.
**Situation:** 25 consultations/month at $75 each. The marketplace has supply constraint — there are only ~500 exotic animal vets in the US. He's building a platform for a market with a natural ceiling.
**Key Insight:** Foundry's scenario modeling should detect "supply-constrained marketplaces" — when the supply side of a marketplace has a natural cap. The system should model the maximum revenue ceiling based on supply availability and recommend strategies: geographic expansion, asynchronous consultations, training programs to increase supply.

### F-067: Professor Wei Zhang
**Background:** 52, tenured computer science professor at MIT. Chinese, has been in the US for 25 years. World expert in distributed consensus algorithms.
**Product:** ConsensusDB — distributed database that achieves strong consistency with 2ms latency (published results in SIGMOD).
**Situation:** The technology is genuinely novel. He has a working prototype and a PhD student helping him. But he's never sold anything in his life. He thinks the technology sells itself. His "go-to-market strategy" is publishing another paper.
**Key Insight:** Foundry should detect "academic founder" patterns — exceptional technology, zero commercial instincts. The lifecycle system should include a specialized track for deep-tech founders that front-loads commercial education: "Before Prompt 2, complete these 5 exercises in positioning, pricing, and customer discovery."

### F-068: Chef Amira Hassan
**Background:** 35, former pastry chef and food scientist. Somali-American, lives in Minneapolis. Holds a food science degree.
**Product:** ShelfSmart — shelf-life prediction engine for food manufacturers (uses ingredient composition, packaging, and storage conditions to predict expiration dates without expensive stability testing).
**Situation:** 4 food manufacturers using it ($499/mo). Revenue: $1,996/mo. The product saves each customer $50K+/year in stability testing costs. But she's pricing it at $499/mo because she doesn't realize the value she's delivering. A classic domain expert underpricing problem.
**Key Insight:** Foundry's D6 (Commercial Integrity) should include "value-based pricing analysis" — estimating the economic value delivered to each customer and comparing it to the price charged. When the ratio is >50:1 (customer saves $50K, pays $6K/year), the system should flag: "You are significantly underpriced relative to value delivered."

### F-069: Dr. Rachel Thornton
**Background:** 41, former NASA propulsion engineer. American, lives in Huntsville, Alabama. 14 years at Marshall Space Flight Center.
**Product:** ThrustSim — propulsion simulation software for small satellite and launch vehicle companies (faster and cheaper than ANSYS Fluent for specific use cases).
**Situation:** 3 space companies using it ($2,000/mo). Revenue: $6,000/mo. The product is world-class for its niche. But the total addressable market is ~200 companies globally. She's already captured 1.5% of her TAM. Growth requires either expanding the product scope or accepting a small, profitable business.
**Key Insight:** Foundry's scenario modeling should include "TAM ceiling analysis" — projecting when a founder will saturate their addressable market at current penetration rates. The system should flag this early and present strategic options: expand TAM (adjacent markets), increase ARPU (deeper product), or optimize for profitability.

### F-070: Detective (Ret.) Tony Russo
**Background:** 53, retired homicide detective (NYPD, 25 years). Italian-American, lives in Staten Island.
**Product:** CaseThread — cold case investigation platform that uses AI to find connections across decades of digitized case files.
**Situation:** 2 police departments piloting it. The product has already surfaced 3 viable leads in cold cases. But police department IT procurement is slower than military procurement. And the political sensitivity of AI in policing means every deployment requires community approval. He's navigating technology, politics, and justice simultaneously.
**Key Insight:** Foundry's competitive monitoring should include "social license" risk — when a product category faces public skepticism or opposition. AI in policing, AI in healthcare diagnosis, AI in hiring — these products need a "public trust" dimension in the audit that evaluates the founder's approach to transparency, bias, and accountability.

### F-071: Dr. Linda Washington
**Background:** 46, former epidemiologist at the CDC. African-American, lives in Atlanta. Left the CDC after 18 years of bureaucratic frustration.
**Product:** OutbreakOS — real-time disease surveillance platform for state and county health departments (faster than the CDC's existing systems).
**Situation:** 4 county health departments using it. Revenue: $0 (government pilot agreements). The product is 10x faster than existing CDC tools. But she's selling against an incumbent (the CDC itself) that is free. Her product is better but costs money, competing against "free and terrible."
**Key Insight:** Foundry's competitive analysis should model "free incumbent" dynamics — when the primary competitor is a free government or institutional tool. The scenario modeling should identify what triggers willingness-to-pay (compliance deadline, disaster, political mandate) and help the founder position for those moments.

### F-072: Professor Maya Johansson
**Background:** 44, materials scientist at Stanford. Swedish-American. Holds 6 patents in biodegradable polymers.
**Product:** PolyGreen — biodegradable packaging materials marketplace + formulation advisory for CPG brands.
**Situation:** 7 CPG brands exploring her materials. Revenue: $3,500/mo from advisory, $0 from marketplace. She's running a consulting business pretending to be a marketplace. The marketplace requires supplier onboarding at scale, which she hasn't done because she's too busy doing advisory.
**Key Insight:** This reinforces F-014's insight: Foundry should detect "services masquerading as platform." But additionally, the wisdom layer should recognize that for deep-tech founders, services revenue can be a valid bridge strategy — the system should model the transition plan from services to product revenue, not just flag the mismatch.

---

## Cohort 6: Immigrant Founders (13 Personas)

### F-073: Yuki Watanabe
**Background:** 32, Japanese engineer. Moved to SF on an O-1 visa. Speaks English fluently but struggles with American sales culture — directness feels rude.
**Product:** LinguaSync — real-time meeting translator for international business calls (not just translation, but cultural context — "when your Japanese client says 'that's interesting,' it means 'no'").
**Situation:** 20 companies in beta. The product is differentiated and valuable. But Yuki can't bring himself to do sales calls. In Japan, the product would sell itself through relationships and introductions. In America, he needs cold outreach, and every cold email he writes sounds like an apology.
**Key Insight:** Foundry's behavioral triggers (Gate 0) are email-based. The system should also model "founder sales readiness" — detecting when a founder has a great product but no sales activity. The intervention should be culturally aware, recognizing that some founders need sales methodology coaching, not just "send more emails."

### F-074: Fatima Al-Zahra
**Background:** 29, Syrian refugee. Arrived in Germany in 2015, learned to code in a refugee camp through an NGO program. Now in Berlin.
**Product:** RefuConnect — platform matching refugees with mentors, language partners, and job opportunities in their new country.
**Situation:** 2,000 registered refugees, 300 mentors. Revenue: $0. She's been running on grants and hackathon prizes. The product is desperately needed but the users have no money, and the natural payers (governments, NGOs) have 18-month grant cycles. She's 6 months from running out of everything.
**Key Insight:** Foundry's lifecycle system should include a "grant-dependent track" — recognizing that some founders operate in markets where the end user never pays. The system should help model grant stacking, government contract pathways, and hybrid monetization, with stressor thresholds adjusted for grant timelines.

### F-075: Andrei Kovacs
**Background:** 38, Romanian software engineer. Moved to London 8 years ago. Former Revolut engineer.
**Product:** RemitIQ — remittance price comparison and optimization for immigrant workers sending money home.
**Situation:** 5,000 users. Revenue: $1,200/mo (affiliate commissions from remittance providers). The product works, users love it, but the affiliate model caps his revenue — providers pay $0.20-0.50 per transaction. He needs 100K+ monthly transactions to build a real business, but he's at 8K.
**Key Insight:** Foundry's MRR decomposition should model "transaction-dependent revenue" differently from subscription revenue — health ratios should account for transaction volume trends, not just customer count. The system should detect when a founder's revenue model requires volume that their current growth rate can't reach within runway.

### F-076: Priya Mukherjee
**Background:** 35, Indian engineer. In the US on an H-1B. Former Uber engineer in SF. Her visa is tied to her current employer, and she wants to quit to go full-time on her startup.
**Product:** VisaPath — AI-powered visa application assistant that helps immigrants navigate the US immigration system (status tracking, form preparation, deadline alerts).
**Situation:** 800 users. Revenue: $2,400/mo ($3/mo subscription). She can't go full-time because quitting her job means losing her H-1B. She can't raise funding because VCs want full-time founders. She's trapped in a catch-22 that is specifically an immigrant founder problem.
**Key Insight:** Foundry's "founder sustainability threshold" (from F-004) should include immigration status as a variable. For immigrant founders on employer-sponsored visas, the system should model the O-1 visa transition timeline and cost as part of the founder's runway calculation.

### F-077: Carlos Herrera
**Background:** 41, Colombian entrepreneur. Moved to Miami 5 years ago. Built and sold a logistics company in Bogota.
**Product:** LatAmBridge — cross-border B2B payments platform for US companies paying Latin American vendors.
**Situation:** 12 companies using it. Revenue: $4,800/mo. Growing well. But compliance requirements are piling up — FinCEN registration, state money transmitter licenses ($50K+ per state), AML/KYC requirements. He's one regulatory audit away from being shut down.
**Key Insight:** Foundry's stressor system should recognize "compliance debt" as a critical stressor — when a product is operating in a regulated space without full compliance. This is different from "compliance gating" (F-026): compliance debt means the product is already live and at risk, not just blocked from entering. The severity should be "critical" by default.

### F-078: Mei Lin Chang
**Background:** 30, Taiwanese designer. Moved to NYC on an artist visa. Former Figma designer.
**Product:** DesignTown — collaborative design tool specifically for Asian design aesthetics (typography, color systems, layout patterns that work for CJK languages).
**Situation:** 200 designers using the free tier. 15 paying ($12/mo). Revenue: $180/mo. The product fills a real gap — Western design tools assume Latin character sets. But her addressable market is niche (Asian-focused design teams), and she's pricing too low.
**Key Insight:** Foundry's competitive monitoring should assess "market size vs. underserved intensity." When a small market is severely underserved, the willingness to pay is higher than market size alone suggests. The scenario modeling should factor in "underserved premium" — users will pay more when no alternatives exist.

### F-079: Ahmed Osman
**Background:** 36, Sudanese-American doctor. Moved to Houston for residency, stayed. Family medicine physician.
**Product:** DiasporaHealth — telehealth platform connecting diaspora communities with doctors from their home countries (Sudanese patients consulting Sudanese doctors in Arabic, with cultural understanding of health beliefs).
**Situation:** 50 consultations/month at $40 each. The concept is powerful — cultural concordance in healthcare improves outcomes. But licensing is a nightmare — doctors in Sudan can't practice medicine in the US. He's navigating multi-jurisdictional medical licensing and it's paralyzing him.
**Key Insight:** Foundry's audit should include a "regulatory jurisdiction mapping" capability — when a product spans multiple regulatory regimes (countries, states, industries), the system should map the regulatory landscape and identify which jurisdictions are accessible vs. blocked.

### F-080: Olena Kovalenko
**Background:** 33, Ukrainian software engineer. Fled to Poland in 2022, then moved to Toronto. Former Grammarly engineer.
**Product:** ResumeLocal — AI resume adapter that rewrites immigrant resumes to match local job market expectations (format, keyword optimization, experience translation).
**Situation:** 3,000 users. Revenue: $900/mo (freemium, $5/mo for unlimited adaptations). The product helps immigrants get interviews. But she's competing with LinkedIn's AI resume builder and ChatGPT direct. Her moat is immigrant-specific knowledge, but that's hard to articulate as a feature.
**Key Insight:** Foundry's D8 (Competitive Defensibility) should evaluate "knowledge moat" — when a product's advantage is domain expertise embedded in the AI, not just technology. The system should help founders articulate and protect experiential moats: proprietary datasets, domain-specific training data, expert-curated rules.

### F-081: Raj Bhandari
**Background:** 45, Nepali entrepreneur. Moved to Australia 15 years ago. Built a chain of grocery stores, now building tech.
**Product:** GrocerIQ — inventory and pricing optimization for independent ethnic grocery stores.
**Situation:** 20 stores using it in Sydney. Revenue: A$3,800/mo. His customers love it but they're cash businesses with thin margins. Pricing above A$200/mo per store loses them. He needs volume but ethnic grocery stores aren't on LinkedIn or Twitter — his customers are at wholesale markets at 4 AM.
**Key Insight:** Foundry's lifecycle system assumes digital customer acquisition. For founders serving offline-first communities, the system should support "offline channel modeling" — estimating customer acquisition cost through physical channels (trade shows, wholesale market presence, community events, religious institutions).

### F-082: Sofia Alvarez
**Background:** 28, Mexican UX designer. Moved to San Francisco on a TN visa. Former Airbnb designer.
**Product:** RemesaTrack — mobile app helping Mexican immigrants track and manage remittance obligations to extended family (who needs how much, when, tracking against commitments).
**Situation:** 1,500 users. Revenue: $0. The app is intensely personal — it touches family dynamics, obligation, guilt, and love. Users are devoted but resistant to paying for something that feels like "family management." The monetization challenge is cultural, not economic.
**Key Insight:** Foundry's Commercial Integrity analysis should recognize "culturally-embedded products" — where the act of paying changes the user's relationship with the product. The system should model indirect monetization (financial services partnerships, earned wage access integration, remittance provider partnerships) rather than direct subscription pricing.

### F-083: Ibrahim Toure
**Background:** 40, Senegalese entrepreneur. In Paris for 12 years. Former logistics manager at Carrefour.
**Product:** AfriShip — logistics optimization platform for Africa-focused e-commerce companies (last-mile delivery in West Africa is a nightmare).
**Situation:** 3 e-commerce companies using it. Revenue: $1,800/mo. The product works. But his customers' payment infrastructure is unreliable — some pay via mobile money, some via wire transfer, some are perpetually late. His own cash flow is unpredictable.
**Key Insight:** Foundry's MRR calculations assume reliable payment collection. For founders serving markets with unreliable payment infrastructure, the system should track "collected MRR" vs. "invoiced MRR" and factor payment reliability into the health ratio.

### F-084: Ananya Sharma
**Background:** 31, Indian data scientist. In the US on an L-1 visa (transferred from TCS India). Lives in New Jersey.
**Product:** SkillBridge — platform matching Indian IT workers with US companies for fractional engineering work (not body shopping — skills-matched project work).
**Situation:** 40 engineers, 8 companies. Revenue: $3,200/mo. Growing. But she's caught in the political crossfire of the H-1B debate. Her product is genuinely different from outsourcing (she matches by skill, not cost), but the perception problem is real.
**Key Insight:** Foundry's competitive monitoring should include "narrative risk" — when a product category is associated with a negative public narrative, even if the specific product is different. The system should help founders proactively manage positioning against category-level stigma.

### F-085: Chen Wei
**Background:** 37, Chinese hardware engineer. In Shenzhen, building for the US market remotely. Former DJI engineer.
**Product:** SensorMesh — IoT sensor management platform for US agriculture (soil moisture, temperature, pest detection).
**Situation:** 5 US farms using it through a hardware distributor. Revenue: $2,500/mo. But geopolitical tension between the US and China is a growing risk — a client recently asked: "Is our farm data going to China?" He needs to address the trust gap head-on.
**Key Insight:** Foundry's stressor system should recognize "geopolitical risk" for cross-border founders — when the founder's country of origin creates trust barriers with customers. The system should recommend trust-building strategies: US data residency, third-party audits, open-source transparency.

---

## Cohort 7: Solo Founders (13 Personas)

### F-086: Alex Rivera
**Background:** 33, former Shopify developer advocate. Nonbinary, lives in Portland. Highly visible in the dev community (50K Twitter followers).
**Product:** ShipKit — deployment toolkit for indie hackers (one-command deploy to any cloud, with monitoring, SSL, and rollback built in).
**Situation:** 400 users. Revenue: $3,200/mo. Great product-market fit. But Alex is doing everything alone: engineering, support (80+ tickets/week), content, and community. They're sleeping 4 hours a night. The product is growing but the founder is breaking.
**Key Insight:** Foundry should monitor "founder workload signals" — support ticket volume, deployment frequency, response times. When a solo founder's operational load exceeds sustainable thresholds, the system should trigger a "sustainability alert" and model which function to delegate first for maximum leverage.

### F-087: Yusuf Demir
**Background:** 29, Turkish-German developer. Lives in Munich. Former SAP engineer. Quiet, introverted, prefers to work alone.
**Product:** FormForge — AI-powered form builder that generates dynamic forms from natural language descriptions.
**Situation:** 1,800 free users, 45 paying ($19/mo). Revenue: $855/mo. The product is polished. But Yusuf has no one to brainstorm with, no one to challenge his assumptions, no one to celebrate wins with. He's losing motivation not because the product is failing but because building alone is lonely.
**Key Insight:** Foundry's behavioral triggers (Gate 0) should include "isolation drift" detection — when a solo founder's engagement patterns (login frequency, deployment cadence, decision response time) indicate declining motivation. The intervention should connect them with community, not just data.

### F-088: Grace Nakamura
**Background:** 40, former Twitter engineer. Japanese-American, lives in Oakland. Divorced, single mother of one.
**Product:** ThreadSafe — content moderation API for community platforms (toxicity detection, context-aware filtering, appeal management).
**Situation:** 8 customers ($199/mo). Revenue: $1,592/mo. Her time is split between her child, the product, and freelance consulting that pays her rent. She has about 15 productive hours per week for the startup. She can't do everything, so she needs to do the right things.
**Key Insight:** Foundry's decision queue should include "time-constrained prioritization" — for founders with limited hours, every decision should include estimated time to execute. The system should model the founder's available hours and flag when the decision backlog exceeds capacity, recommending deferral or delegation.

### F-089: Marco Bianchi
**Background:** 35, Italian developer. Lives in Rome, building for the US market. Former freelancer. Works from coffee shops.
**Product:** InvoiceAI — invoice processing API that extracts, categorizes, and reconciles invoices from any format (PDF, image, email).
**Situation:** 30 customers ($49/mo). Revenue: $1,470/mo. Growing steadily. But as a solo founder in a different timezone (CET vs. US), he's constantly context-switching. His European mornings are for building, his afternoons/evenings are for US customer support. The timezone split is fragmenting his focus.
**Key Insight:** Foundry's digest system delivers at founder-local time, which is good. But the system should also model "timezone-optimal workflows" — recommending when a founder should build vs. support vs. decide based on their timezone relative to their customers, to minimize context-switching.

### F-090: Chioma Adebayo
**Background:** 27, Nigerian developer. Lives in Lagos. Self-taught. Building for the African market.
**Product:** PayStack-for-Schools (name TBD) — school fee payment platform for Nigerian private schools (installment plans, receipt generation, parent communication).
**Situation:** 12 schools using it. Revenue: $600/mo (Nigerian payment infrastructure takes 40% of her margins). She's talented and driven, but building from Nigeria means every tool, service, and resource is harder to access and more expensive. Her $600/mo MRR has the impact of $2K/mo in the US.
**Key Insight:** Foundry should consider "purchasing power parity" in its financial metrics. $600/mo MRR in Lagos is not the same as $600/mo in San Francisco. The system should offer PPP-adjusted metrics and stressor thresholds for founders building in developing economies.

### F-091: Daniel Park
**Background:** 38, Korean-American former Google engineer. Lives in Seattle. Chose solo founding deliberately — he's seen co-founder conflicts destroy companies.
**Product:** APIMonitor — uptime and performance monitoring specifically for API-first businesses (not generic like Pingdom, but API-schema-aware).
**Situation:** 55 customers ($29/mo). Revenue: $1,595/mo. Healthy business. But he's hit a growth plateau — he can't build new features AND do marketing AND handle support. He needs to make his first hire but is paralyzed by the commitment. What if the product dips and he can't make payroll?
**Key Insight:** Foundry's scenario modeling should include "first hire analysis" — modeling the financial and operational impact of the first employee. When should a solo founder hire? What role (engineering, support, marketing)? What happens to cash flow? The system should model the breakeven point where the hire pays for itself.

### F-092: Lucia Fernandez
**Background:** 44, former accountant. Argentine, lives in Buenos Aires. Building for the Latin American market.
**Product:** ContaFacil — simplified accounting software for Argentine freelancers dealing with the country's labyrinthine tax system (inflation adjustments, currency controls, multiple tax regimes).
**Situation:** 200 users. Revenue: $1,200/mo in ARS (rapidly depreciating). Her MRR in USD terms drops every month even as she acquires customers. She's running on a treadmill — the currency crisis is eating her revenue.
**Key Insight:** Foundry's MRR calculations should support multi-currency founders — tracking MRR in both local and reference currencies. The stressor system should detect "currency erosion" as a structural risk and model USD-equivalent revenue trends alongside nominal local currency growth.

### F-093: Erik Johansson
**Background:** 31, Swedish developer. Lives in Gothenburg. Former Spotify backend engineer. Quiet, methodical.
**Product:** QueueSmart — intelligent job queue management for Ruby on Rails applications (smart prioritization, dead job recovery, performance analytics).
**Situation:** 80 customers ($15/mo). Revenue: $1,200/mo. The product works perfectly for its niche. But $15/mo per customer means he needs thousands of customers to build a meaningful business. He's at the wrong price point for the value he delivers but is afraid of losing customers if he raises prices.
**Key Insight:** Foundry's scenario modeling should include "pricing migration analysis" — modeling the impact of a price increase on retention. The system should use the founder's NPS, engagement data, and competitive alternatives to estimate the churn risk of a 2x or 3x price increase, and project the net revenue impact.

### F-094: Nkechi Okafor
**Background:** 36, Nigerian-American lawyer turned developer. Lives in DC. Taught herself Python during the pandemic. Former DOJ attorney.
**Product:** LegalSearch — AI-powered legal research tool for solo practitioners and small law firms (cheaper than Westlaw/LexisNexis).
**Situation:** 15 law firms ($99/mo). Revenue: $1,485/mo. Strong value proposition (Westlaw costs $200+/mo for similar functionality). But Thomson Reuters (Westlaw's parent) just launched an AI feature, and Nkechi is terrified. She's one feature launch away from being crushed by an incumbent with infinite resources.
**Key Insight:** Foundry's competitive monitoring should model "incumbent response probability" — when a startup enters an incumbent's market, what's the probability and timeline of the incumbent launching a competitive response? The system should help founders identify "response-proof" niches where the incumbent's architecture or business model prevents fast followership.

### F-095: Tomasz Wozniak
**Background:** 42, Polish developer. Lives in Warsaw. Former game developer at CD Projekt Red.
**Product:** GameBalancer — real-time game economy balancing tool for mobile game developers (predicts inflation, detects exploits, recommends currency adjustments).
**Situation:** 5 game studios using it ($299/mo). Revenue: $1,495/mo. The product is niche but high-value. His problem: game studios have long evaluation cycles (3-6 months) and his product's value is only apparent after a game launches. He's selling insurance before the fire.
**Key Insight:** Foundry's lifecycle system should recognize "value-delay products" — where the benefit materializes months after purchase. The system should model the customer's "value realization timeline" and recommend engagement strategies that bridge the gap between purchase and first measurable outcome.

### F-096: Aisha Mohammed
**Background:** 28, Somali-Canadian developer. Lives in Toronto. Former Shopify intern who dropped out of university to build.
**Product:** HalalCart — halal food delivery platform for Canadian cities (not just restaurants, but halal grocery, catering, and meal prep).
**Situation:** 40 restaurants, 2,000 users in Toronto. Revenue: $1,800/mo (15% commission). Growing, but she's subsidizing delivery costs to compete with UberEats/DoorDash. Her unit economics are negative. She's buying market share with money she doesn't have.
**Key Insight:** Foundry's MRR health ratio should include unit economics modeling — detecting when a marketplace's take rate doesn't cover its operational costs per transaction. The stressor system should flag "subsidy-dependent growth" as critical: "Your revenue is growing but you lose $X per transaction."

### F-097: Hans Mueller
**Background:** 50, German engineer. Lives in Berlin. Former Siemens industrial automation engineer. Precise, methodical, zero startup experience.
**Product:** FactoryPulse — predictive maintenance platform for small-to-medium manufacturing facilities (vibration analysis, temperature monitoring, failure prediction).
**Situation:** 3 manufacturing plants ($999/mo). Revenue: $2,997/mo. Hans builds like an engineer — every feature is over-specified, over-tested, and over-documented. His product is excellent but he's 2x slower than competitors because he refuses to ship anything less than perfect.
**Key Insight:** Foundry's lifecycle system should detect "engineering perfectionism" — when deployment/release cadence is unusually slow relative to commit frequency. The system should model the "cost of delay" — estimated revenue lost per week of shipping delay — to give perfectionist founders a financial reason to ship faster.

### F-098: Isabella Romano
**Background:** 34, Italian-Brazilian developer. Lives in Lisbon. Digital nomad. Former ThoughtWorks consultant.
**Product:** NomadTax — tax compliance assistant for digital nomads working across multiple countries (tracks days in each country, determines tax obligations, connects with local accountants).
**Situation:** 500 users. Revenue: $2,000/mo ($4/mo). Her users love the product but she IS her user — a nomad with no stable base. She builds from co-working spaces in different countries, with different time zones, different internet quality, and different energy levels. Her own lifestyle is both her insight and her constraint.
**Key Insight:** Foundry should recognize "founder-product isomorphism" — when the founder lives the exact problem they're solving. This is usually an advantage (deep empathy) but can be a constraint (can't scale beyond personal experience). The wisdom layer should flag when the founder's personal context is limiting their product vision.

---

## Cohort 8: Co-Founder Conflict (13 Personas)

### F-099: David & Sarah Thornton
**Background:** Married couple, both 37. David: engineer (former Airbnb). Sarah: designer (former IDEO). Live in SF.
**Product:** TravelCraft — AI-powered itinerary builder for luxury travelers.
**Situation:** The product works. 200 users. Revenue: $4,800/mo. But David and Sarah are fighting about everything — pricing, features, hiring, strategy. Their marital conflict is spilling into product decisions. Every product argument becomes a relationship argument and vice versa.
**Key Insight:** Foundry's decision queue should offer a "decision disaggregation" mode for co-founder teams — breaking compound decisions into atomic components, scoring each component independently, and identifying exactly where the disagreement lies. Most co-founder "fights" are about 1 variable disguised as 10.

### F-100: Alex Chen & Jordan Williams
**Background:** Alex: technical co-founder, 28, MIT CS. Jordan: business co-founder, 32, Harvard MBA. Met at a startup weekend.
**Product:** MeetMetrics — meeting effectiveness analytics for remote teams.
**Situation:** Alex wants to build AI features (technically exciting). Jordan wants to sell the existing product (commercially pragmatic). They're pulling in opposite directions. Alex is building features nobody asked for while Jordan is selling features that don't exist yet. Communication has broken down to Slack messages.
**Key Insight:** Foundry's decision queue should detect "founder divergence" — when co-founders' decisions systematically disagree along a predictable axis (build vs. sell, features vs. distribution, depth vs. breadth). The system should surface the pattern and facilitate explicit alignment discussions before the divergence becomes a rupture.

### F-101: Priya Rao & Vikram Shah
**Background:** Priya: 35, product designer. Vikram: 36, backend engineer. Both Indian-American. Former colleagues at Microsoft. Co-founded with a 50/50 equity split.
**Product:** DesignOps — design system management platform for enterprise teams.
**Situation:** 18 months in. Revenue: $8,000/mo. The business is working. But Priya does 70% of the customer-facing work while Vikram codes. She feels the equity split is unfair but can't bring it up because Vikram is her best friend. Resentment is building. She's considering leaving.
**Key Insight:** Foundry's risk state system focuses on product risks, but co-founder departure is an existential risk. The stressor system should model "co-founder alignment" as a risk factor — detectable through diverging engagement patterns (one founder's login frequency drops, decision response time increases, commit frequency falls).

### F-102: Maria Gonzalez & Tom O'Brien
**Background:** Maria: 40, domain expert (former hospital administrator). Tom: 33, full-stack developer. Equity: 60/40 (Maria/Tom).
**Product:** CareCoord — care coordination platform for multi-site healthcare systems.
**Situation:** Maria has the relationships and domain knowledge. Tom has the skills. But Tom wants to move faster (ship, iterate, learn) while Maria wants to move carefully (every feature needs clinical validation). They're both right, but the tension is slowing everything to a crawl.
**Key Insight:** Foundry's gate system is designed for autonomous decisions, but could also serve as a co-founder alignment mechanism. A "co-founder gate agreement" that pre-defines which decisions each founder can make autonomously (Gate 0-1) vs. which require joint approval (Gate 3-4) would prevent decision paralysis while respecting both founders' values.

### F-103: James Li & Patrick Murphy
**Background:** James: 29, Chinese-American, Stanford CS, brilliant engineer. Patrick: 31, Irish-American, Wharton MBA, polished salesman. Met through a mutual investor.
**Product:** PredictiveHR — workforce planning and attrition prediction for mid-market companies.
**Situation:** Patrick raised $1M in pre-seed funding before the product existed. James is now under pressure to build to Patrick's fundraising narrative, not to customer feedback. The product roadmap is shaped by what Patrick told investors, not by what users need. James feels like an implementation contractor, not a co-founder.
**Key Insight:** Foundry's lifecycle system should detect "narrative-driven development" — when a product's roadmap aligns more closely with investor pitch decks than with user feedback and validated hypotheses. The system should compare the stated product vision (from Product DNA) against actual usage patterns and flag divergence.

### F-104: Aisha & Mohammed Ahmed
**Background:** Siblings. Aisha: 34, UX designer. Mohammed: 30, developer. Sudanese-American, both in Houston.
**Product:** HalalHub — Muslim lifestyle app (prayer times, halal restaurant finder, community events, Islamic content).
**Situation:** 10,000 downloads. Revenue: $1,200/mo (premium features). Strong community engagement. But Aisha wants to expand to a general "Muslim lifestyle" brand while Mohammed wants to focus purely on the technology and add features. Family dynamics make the conversation impossible — their parents take sides.
**Key Insight:** Foundry's Product DNA should support "vision alignment scoring" — when co-founders have different mental models of what the product should become, the system should surface the divergence early by comparing their individual Product DNA responses rather than accepting a compromised consensus version.

### F-105: Lisa Park & Nicole Chen
**Background:** Both 36, former Google product managers. Korean-American and Chinese-American, respectively. Best friends since college.
**Product:** FeedbackLoop — continuous customer feedback platform for product teams (survey design, response analysis, prioritization scoring).
**Situation:** Revenue: $6,000/mo. Both are product-minded but neither is technical. They hired a CTO (employee, not co-founder) who is now making product decisions because they don't understand the technical constraints. The power dynamic has inverted — the hired CTO is the de facto founder.
**Key Insight:** Foundry's "key person dependency" detection (from F-033) should also flag "capability gap dependency" — when a non-co-founder employee fills a critical capability gap. The system should model the organizational impact and recommend mitigations: second technical hire, architectural documentation, code reviews by external advisors.

### F-106: Ryan Garcia & Matt Thompson
**Background:** Ryan: 27, first-time founder. Matt: 42, serial entrepreneur (3 exits). Equity: 50/50 despite asymmetric experience.
**Product:** CommitTracker — developer productivity analytics for engineering managers.
**Situation:** Matt treats Ryan like a junior employee. Every decision goes through Matt. Ryan has no autonomy despite equal equity. The 50/50 split was supposed to mean equal partnership, but in practice, experience dominates. Ryan is learning a lot but not being heard. He's considering walking away from his own company.
**Key Insight:** Foundry's decision audit log could serve double duty as a "decision attribution tracker" — showing which co-founder proposed vs. approved each decision. Over time, extreme imbalance (90% of decisions proposed by one founder) would be visible data, enabling a constructive conversation about decision-making equity.

### F-107: Dr. Sarah Kim & Dr. James Obi
**Background:** Both academic researchers. Sarah: materials science (MIT). James: computational chemistry (Stanford). Co-PIs on a grant that produced the technology.
**Product:** MolSim — molecular simulation platform for pharmaceutical companies.
**Situation:** The IP belongs to both universities. The licensing agreement took 18 months to negotiate. Now they disagree about whether to sell to pharma (James's preference — high ARPU, long sales cycles) or to academic labs (Sarah's preference — faster adoption, lower revenue). Neither has business experience.
**Key Insight:** Foundry's scenario modeling should support "market strategy A/B comparison" — running parallel scenarios for different market approaches and comparing projected outcomes over 6/12/24 months. For co-founders with strategic disagreements, the data should adjudicate, not the louder voice.

### F-108: Amanda & Derek Foster
**Background:** Married couple, both 45. Amanda: former journalist. Derek: former software engineer (20 years at IBM).
**Product:** StoryForge — AI writing assistant specifically for local newsrooms (generates story drafts from data releases, public records, meeting minutes).
**Situation:** 6 newsrooms using it. Revenue: $1,800/mo. The product serves a noble purpose (saving local journalism). But Amanda and Derek have fundamentally different risk tolerances — Amanda wants to burn savings to grow fast (she's seen newsrooms die from slow technology adoption), while Derek wants to bootstrap cautiously (he's seen startups die from spending too fast). Neither is wrong.
**Key Insight:** Foundry's scenario modeling should include "risk tolerance calibration" — explicitly modeling outcomes under aggressive vs. conservative spending assumptions. When co-founders have different risk profiles, the data should show the consequences of each approach rather than defaulting to either extreme.

### F-109: Mike Johnson & Sarah Williams
**Background:** Mike: 38, sales background (former Salesforce AE). Sarah: 35, engineering background (former Stripe engineer).
**Product:** LeadGenius — AI-powered lead scoring and enrichment for B2B sales teams.
**Situation:** Mike promised 50 features to close 10 deals. Sarah has to build them. The engineering backlog is 18 months deep. Mike keeps selling features that don't exist, Sarah keeps building features nobody asked for. They haven't aligned on product scope in 6 months.
**Key Insight:** Foundry's decision queue should enforce "scope commitment review" — when customer-facing commitments create engineering obligations, both should be tracked in the same system. The system should flag when sales commitments exceed engineering capacity by more than 3 months, triggering a Gate 3 prioritization discussion.

### F-110: Chen Wei & Liu Mei
**Background:** Husband and wife. Chen: 40, hardware engineer. Liu: 38, software engineer. Chinese, living in Shenzhen, building for the US market.
**Product:** SmartDock — USB-C docking station with intelligent power management and software-defined port allocation.
**Situation:** Hardware is done (manufactured 500 units). Software is done. But they can't agree on the go-to-market: Chen wants to sell through Amazon (fast, low margin), Liu wants to sell direct (slow, high margin). They've been arguing for 2 months while inventory sits in a warehouse depreciating.
**Key Insight:** Foundry's decision queue should detect "decision paralysis by consensus" — when a decision has been pending for an extended period because co-founders can't agree. The system should automatically escalate to Gate 3 (present options with scenarios) and set a deadline: "This decision has been pending for 45 days. Here are the scenarios. Choose by Friday or the system will recommend the highest-EV option."

### F-111: Kenji Matsuda & Alex Petrov
**Background:** Kenji: 33, Japanese engineer (former Sony). Alex: 35, Russian-American business development (former WeWork). Met at a co-working space in Bali.
**Product:** NomadBase — co-living/co-working space management platform.
**Situation:** Met 6 months ago. Built an MVP in 3 months. 8 co-living spaces using it. Revenue: $1,600/mo. But they barely know each other. They bonded over a shared dream in paradise, and now reality is setting in. Different work styles, different communication norms (Japanese indirectness vs. Russian bluntness), different definitions of "hard work." The cultural gap that seemed charming in Bali is exhausting in production.
**Key Insight:** Foundry's onboarding should offer a "co-founder alignment assessment" — a structured exercise in Product DNA where each co-founder answers independently, and the system identifies areas of agreement and divergence. This isn't therapy; it's alignment through data.

---

## Cohort 9: Vertical SaaS Founders (13 Personas)

### F-112: Patricia Morales
**Background:** 41, former dental practice manager. Mexican-American, lives in San Antonio. Managed 3 dental offices for 12 years.
**Product:** DentalFlow — patient scheduling + insurance verification platform for independent dental practices.
**Situation:** 18 practices ($149/mo). Revenue: $2,682/mo. Her competition is entrenched legacy software (Dentrix, Eaglesoft) that practices hate but won't leave because of data migration fear. She needs a migration tool more than she needs another feature.
**Key Insight:** Foundry's D8 (Competitive Defensibility) should evaluate "switching cost strategy" — when a product's competitor is entrenched legacy software, the primary competitive weapon is painless migration. The system should flag when a founder is building features instead of reducing switching costs.

### F-113: Dr. William Okonkwo
**Background:** 48, retired veterinary surgeon. Nigerian-British, lives in London. Ran a large animal practice for 20 years.
**Product:** VetTrack — practice management for large animal veterinary clinics (equine, livestock) — scheduling, medical records, farm visit logistics.
**Situation:** 8 clinics ($199/mo). Revenue: $1,592/mo. Large animal vet clinics operate differently from small animal clinics — they're mobile (driving to farms), work without internet frequently, and bill by visit rather than by procedure. Every "vet software" on the market is designed for small animal clinics in strip malls.
**Key Insight:** Foundry's audit should evaluate "offline capability" as a dimension for products serving field-based customers. D5 (Operational Readiness) should check for offline-first architecture, sync capabilities, and graceful degradation — not just uptime and scalability.

### F-114: Sarah Johansson
**Background:** 36, former yacht charter broker. Swedish, lives in Mallorca. 10 years in the luxury yacht industry.
**Product:** CharterFlow — charter yacht management platform (booking, crew management, provisioning, guest preferences, itinerary optimization).
**Situation:** 12 charter yachts ($499/mo). Revenue: $5,988/mo. High-ARPU, low-volume market. She knows every operator personally. Her growth ceiling is ~500 yachts worldwide that meet her product's requirements. She needs to decide: go deep (more features for existing yacht market) or go wide (extend to other luxury experiences).
**Key Insight:** Foundry's TAM ceiling analysis (from F-069) should include a strategic fork recommendation — when a founder approaches TAM saturation, the system should model "depth vs. breadth" scenarios with specific revenue projections and risk profiles for each path.

### F-115: James Abara
**Background:** 39, former church music director. Nigerian-American, lives in Nashville. Oversaw music production for a megachurch.
**Product:** WorshipFlow — worship service planning and media management for churches (setlist building, lyrics display, volunteer coordination, livestream integration).
**Situation:** 25 churches ($79/mo). Revenue: $1,975/mo. His users are passionate but technically unsophisticated — average age 55, many volunteer-run tech booths. Every "simple" feature needs to be simpler. He keeps simplifying and it's never simple enough.
**Key Insight:** Foundry's D10 (Stranger Test) evaluates first-time user success, but should weight "technical literacy" of the target user. When the ICP is low-technical-literacy users, the stranger test bar should be higher — not "can they figure it out?" but "can they figure it out in 60 seconds without reading anything?"

### F-116: Maria Ivanova
**Background:** 43, former construction project manager. Russian, lives in Dubai. 15 years managing luxury real estate construction projects.
**Product:** BuildTrack — construction project management for luxury residential builders (progress tracking, subcontractor coordination, client communication, change order management).
**Situation:** 7 builders ($299/mo). Revenue: $2,093/mo. Her clients are demanding (luxury builders serve ultra-wealthy homeowners who want real-time visibility). She's spending 40% of her time on white-glove customer support, manually configuring each builder's instance. She needs templating and self-serve configuration.
**Key Insight:** Foundry's D7 (Self-Sufficiency) should evaluate "configuration self-serve ratio" — what percentage of the product's setup and customization can the customer do themselves vs. requires founder/team involvement. When this ratio is low, it's a scalability blocker.

### F-117: Robert Nakamura
**Background:** 52, former funeral home director. Japanese-American, lives in Honolulu. 25 years in death care.
**Product:** EternalCare — funeral home management platform (arrangement conferences, pricing transparency, regulatory compliance, aftercare scheduling).
**Situation:** 10 funeral homes ($199/mo). Revenue: $1,990/mo. The death care industry is one of the last un-digitized industries. His competitors are software from 1998. But selling to funeral directors requires extreme sensitivity — they won't adopt technology that feels clinical or disruptive. They want "modern but respectful."
**Key Insight:** Foundry's D2 (Experience Coherence) should evaluate "tonal congruence" — whether the product's visual and interaction design matches the emotional register of the industry. A funeral management platform that looks like Notion is tonally wrong even if functionally right.

### F-118: Amira Khalil
**Background:** 35, former mosque administrator. Egyptian-American, lives in Dearborn, Michigan.
**Product:** MasjidManager — mosque management platform (donation tracking, prayer time management, community communication, facility booking, Zakat calculations).
**Situation:** 15 mosques ($49/mo). Revenue: $735/mo. The product is affordable because mosques have limited budgets. But Amira is building a "mosque management" platform when what she really has is a "religious community management" platform — temples, gurdwaras, and synagogues have similar needs. She's artificially limiting her market.
**Key Insight:** Foundry's Product DNA should include "market expansion readiness assessment" — evaluating how much of the product's value proposition is specific to the current vertical vs. transferable to adjacent verticals. The system should surface expansion opportunities when >70% of features are vertical-agnostic.

### F-119: Carlos Rivera
**Background:** 44, former auto body shop owner. Puerto Rican, lives in Orlando. Sold his shop to build software.
**Product:** ShopSync — auto body shop management platform (estimate creation, insurance claim tracking, parts ordering, customer communication).
**Situation:** 20 shops ($129/mo). Revenue: $2,580/mo. His churn is near-zero — shops that adopt don't leave. But acquiring new shops is slow and expensive (each requires a demo, a trial, and hand-holding through migration from paper/Excel). His CAC is $800, and his payback period is 6 months.
**Key Insight:** Foundry's stressor system should model "CAC-LTV health" as a continuous metric. When CAC payback exceeds 4 months, the system should surface it as a stressor and model strategies to reduce CAC (referral programs, partner channels, self-serve onboarding) or increase speed-to-value (faster time-to-first-value reduces trial-to-paid friction).

### F-120: Emily Bergstrom
**Background:** 38, former kindergarten teacher. Swedish-American, lives in Minneapolis. 12 years of early childhood education.
**Product:** LittleLedger — childcare center management platform (enrollment, billing, parent communication, attendance tracking, staff scheduling, regulatory compliance).
**Situation:** 22 childcare centers ($99/mo). Revenue: $2,178/mo. Her competitive landscape is dominated by one player (Procare) with 40% market share and 30+ years of entrenchment. She's David vs. Goliath. Her advantage: modern UX and mobile-first design. Her disadvantage: Procare has every feature ever requested by every childcare center ever.
**Key Insight:** Foundry's competitive analysis should model "feature surface area" competition — when an incumbent has decades of feature accumulation, the startup should compete on simplicity, not comprehensiveness. The system should help founders identify the "essential feature set" that serves 80% of users and resist the temptation to match the incumbent feature-for-feature.

### F-121: Mohammed Al-Farsi
**Background:** 40, Omani-American, former hotel revenue manager at Marriott. Lives in Dallas. MBA from Cornell Hotel School.
**Product:** RevSync — revenue management platform for independent hotels (dynamic pricing, channel management, demand forecasting).
**Situation:** 8 hotels ($399/mo). Revenue: $3,192/mo. His product competes with IDeaS and Duetto, which charge $2,000+/mo. He's positioning as "enterprise-grade revenue management at independent-hotel prices." But his customers keep asking for enterprise features he can't afford to build.
**Key Insight:** Foundry's decision queue should detect "pricing-tier mismatch" — when a product is priced for one segment (independent hotels) but customers expect features from another segment (enterprise). The system should model whether raising prices to fund enterprise features is viable, or whether the product should deepen its focus on the independent segment's unique needs.

### F-122: Diana Petrov
**Background:** 37, former insurance broker. Bulgarian, lives in London. 12 years in commercial property insurance.
**Product:** PolicyOS — commercial property insurance management for landlords with 10-50 properties (policy tracking, claim management, renewal optimization).
**Situation:** 30 landlords ($79/mo). Revenue: $2,370/mo. Low churn, steady growth. But her biggest opportunity isn't the landlords — it's the insurance brokers. If she can get brokers to recommend PolicyOS to their landlord clients, she has a channel that scales. But her product doesn't serve brokers' needs yet.
**Key Insight:** Foundry's Product DNA should detect "channel-as-product opportunity" — when a product's most scalable distribution channel requires product changes to activate. The system should model the ROI of building broker-facing features vs. continued direct acquisition.

### F-123: Kevin Tran
**Background:** 33, former optician. Vietnamese-American, lives in Houston. Managed a chain of optical stores.
**Product:** OptikFlow — optical store management (appointment scheduling, prescription management, frame inventory, insurance billing, lens ordering).
**Situation:** 8 stores ($179/mo). Revenue: $1,432/mo. His industry is being disrupted by online retailers (Warby Parker, Zenni). His customers are afraid they're going extinct. His platform needs to help brick-and-mortar optical stores compete with online, not just manage their operations.
**Key Insight:** Foundry's stressor system should recognize "industry disruption anxiety" in the founder's customer base. When a vertical's customers are facing existential threat from a different business model, the SaaS platform should adapt — shifting from "operational efficiency" to "competitive survival" positioning.

### F-124: Rachel Novak
**Background:** 46, former cemetery administrator. Czech-American, lives in Omaha. 20 years in the cemetery/memorial industry.
**Product:** MemorialMap — cemetery management and mapping platform (plot inventory, digital mapping, genealogy integration, online memorial pages).
**Situation:** 5 cemeteries ($249/mo). Revenue: $1,245/mo. The product is unique and competitors are ancient. Her real opportunity: genealogy enthusiasts who want to find ancestors' graves. She's sitting on a consumer growth engine (genealogy) but only sees the B2B side (cemetery management).
**Key Insight:** Foundry's scenario modeling should detect "hidden B2C opportunity" — when a B2B vertical SaaS product generates data or functionality that has independent consumer value. The system should model the B2C expansion scenario alongside the core B2B growth path.

---

## Cohort 10: Consumer Founders (13 Personas)

### F-125: Zoe Kim
**Background:** 25, former TikTok content creator (800K followers). Korean-American, lives in LA. No technical background.
**Product:** Duet — social music creation app where users collaborate on songs asynchronously (one person lays a beat, another adds vocals, another adds guitar).
**Situation:** 50,000 downloads. 2,000 MAU. Revenue: $0. She has distribution instincts (content virality) but no monetization instincts. The app is feature-rich but has no paywall, no ads, and no premium tier. She's afraid that monetizing will kill the "vibe."
**Key Insight:** Foundry's lifecycle system should include a "consumer monetization readiness" checkpoint — specifically for consumer apps that have traction but no revenue. The system should model monetization options (premium features, creator economics, brand partnerships) and their projected impact on retention, not just revenue.

### F-126: Marcus Johnson
**Background:** 30, former Nike product designer. African-American, lives in Portland. Sneakerhead culture maven.
**Product:** SoleVault — sneaker collection management and valuation app (track your collection, get real-time market values, set price alerts, connect with collectors).
**Situation:** 15,000 users. Revenue: $4,500/mo (premium tier). Strong community. But he's hitting the ceiling of the sneaker collector niche and needs to decide: expand to all collectibles (watches, trading cards) or go deeper into sneakers (authentication, marketplace, insurance).
**Key Insight:** Foundry's scenario modeling for consumer products should include "community dilution risk" — when expanding beyond a niche risks alienating the core community. The system should model retention impact on the existing user base under expansion scenarios, not just total user growth.

### F-127: Emma Larsson
**Background:** 28, Swedish-American, former peloton instructor. Lives in Austin. Fitness community builder.
**Product:** FitTribe — social fitness app focused on accountability groups (5-person "tribes" that work out together virtually, track goals, and compete in challenges).
**Situation:** 8,000 users. Revenue: $3,200/mo (premium tribes). The product has strong retention within active tribes but loses users when a tribe member drops out (cascading churn — one person leaving destabilizes the group). She needs to solve "social graph resilience."
**Key Insight:** Foundry's cohort analysis tracks individual retention, but for social products, the system should model "group retention" — tracking cohort survival at the group level and identifying the cascade dynamics (when does 1 departure become 5?). This requires a different churn model than individual SaaS.

### F-128: James O'Connor
**Background:** 35, former sports journalist. Irish-American, lives in Boston. Covered the NBA for 8 years.
**Product:** HoopIQ — basketball analytics app for recreational players (shot tracking via phone camera, game statistics, improvement recommendations).
**Situation:** 20,000 downloads. 3,000 MAU. Revenue: $1,500/mo (premium analytics). The app works well indoors but outdoor courts have lighting/background challenges that break the computer vision. 60% of recreational basketball happens outdoors. He's serving half his market.
**Key Insight:** Foundry's D1 (Functional Completeness) should evaluate "environmental coverage" for products that depend on physical conditions. The audit should identify what percentage of the product's use cases work reliably across all expected environments.

### F-129: Lily Chen
**Background:** 22, college senior at UCLA. Chinese-American. Built a side project that went viral on Campus.
**Product:** StudyBuddy — AI study group matching for college students (matches students in the same course based on study style, schedule, and academic level).
**Situation:** 5,000 users at UCLA. Zero revenue. She's about to graduate and has a job offer from Google ($185K). The product has traction but she's 22, has $80K in student loans, and the Google offer is life-changing money. Classic opportunity cost dilemma.
**Key Insight:** Foundry's scenario modeling should include "opportunity cost analysis" for founders weighing full-time commitment against employment. The system should model the expected value of continuing vs. taking a job, including the option value of working at Google for 2 years and returning to the startup with savings and experience.

### F-130: Diego Martinez
**Background:** 27, former barista and amateur mixologist. Mexican-American, lives in Chicago. Self-taught developer (4 months of coding experience).
**Product:** MixMaster — cocktail recipe and home bar management app (inventory tracking, recipe suggestions based on what you have, party planning).
**Situation:** 3,000 users. Revenue: $600/mo ($2/mo premium). The product is charming but technically fragile — Diego's code is held together with duct tape. He's learning to code and building a product simultaneously. Every new feature introduces 3 bugs.
**Key Insight:** Foundry's audit engine should have a "founder growth trajectory" dimension — when a founder is actively learning to code, the system should weight future capability, not just current code quality. Findings should distinguish between "you don't know this yet" (fixable with learning) and "this is architecturally wrong" (needs restructuring).

### F-131: Sarah Ahmed
**Background:** 32, former clinical social worker. Pakistani-American, lives in DC. 8 years of community mental health work.
**Product:** MindCheck — daily mental health check-in app with guided journaling, mood tracking, and anonymous peer support.
**Situation:** 12,000 users. Revenue: $2,400/mo (premium features). But user safety is a constant concern — what if someone expresses suicidal ideation in a journal entry? She's built basic keyword detection but it's not enough. She's one user crisis away from either saving a life or being liable for not saving one.
**Key Insight:** Foundry's audit should include a "user safety" dimension for consumer products that touch mental health, financial distress, or physical safety. This goes beyond compliance — it's about whether the product has adequate crisis detection, escalation pathways, and liability protections.

### F-132: Ryan Park
**Background:** 29, former game designer at Supercell. Korean-Finnish, lives in Helsinki. 7 years in mobile gaming.
**Product:** PetWorld — virtual pet simulation with real-world activity requirements (your virtual pet's health depends on your real-world steps, sleep, and screen time).
**Situation:** 100,000 downloads. 15,000 MAU. Revenue: $8,000/mo (in-app purchases). The product works beautifully for kids 8-14. But he accidentally built an app that collects data from minors without COPPA compliance. He needs to retroactively implement COPPA or restrict to 13+, either of which could devastate his user base.
**Key Insight:** Foundry's audit should include a "minor user compliance" check — detecting when a product's actual user demographics include minors, even if unintentionally. COPPA, GDPR-K, age verification requirements should trigger automatically based on product category and usage patterns.

### F-133: Amara Okafor
**Background:** 26, former fashion blogger. Nigerian-British, lives in London. Built a following of 200K on Instagram.
**Product:** StyleSwap — closet management and clothing swap platform for fashion-conscious women.
**Situation:** 5,000 users. Revenue: $2,000/mo (premium closet features). The swap marketplace is active but trust is a problem — users are afraid of receiving damaged or fake items. She needs a trust/authentication layer but doesn't have the resources to build one.
**Key Insight:** Foundry's D3 (Trust Density) evaluates whether a stranger would trust the product, but for marketplace products, trust between users is equally important. The audit should evaluate "peer trust infrastructure" — ratings, verification, dispute resolution, escrow — as a core product dimension.

### F-134: Tom Andersen
**Background:** 40, former professional poker player. Norwegian-American, lives in Las Vegas. Expert in probability and game theory.
**Product:** BetIQ — sports betting analytics platform for recreational bettors (expected value calculations, bankroll management, bet tracking).
**Situation:** 8,000 users. Revenue: $6,000/mo (premium insights). The product is popular but exists in a legal gray zone — sports betting regulations vary by state, and his app could be classified as a "gambling tool" in some jurisdictions. He's one attorney general letter away from a crisis.
**Key Insight:** Foundry's stressor system should include "regulatory classification risk" — when a product exists in a space where the regulatory classification is ambiguous. The system should model multiple classification outcomes and their impact on operations, recommending proactive legal positioning.

### F-135: Julia Santos
**Background:** 33, former yoga instructor and wellness influencer. Brazilian-American, lives in Sedona, Arizona.
**Product:** SoulSpace — meditation and spiritual practice app with AI-guided sessions personalized to your emotional state (detected through voice analysis).
**Situation:** 20,000 users. Revenue: $5,000/mo. The app makes wellness claims that border on health claims — "reduce anxiety," "improve sleep quality." She's not FDA-regulated (it's a wellness app, not a medical device) but one user lawsuit could change that classification overnight.
**Key Insight:** Foundry's D3 (Trust Density) should evaluate "claims accuracy" — are the product's marketing claims substantiated? For wellness/health-adjacent consumer apps, the gap between marketing language and evidence is a legal risk that the audit should flag.

### F-136: Kevin Huang
**Background:** 24, CS student at Carnegie Mellon. Taiwanese-American. Built the app as a class project.
**Product:** CampusEats — campus food ordering app that aggregates all dining options (cafeterias, food trucks, campus restaurants) into one platform with real-time wait times.
**Situation:** 4,000 users at CMU. Zero revenue. He's about to launch at 5 more universities. But each university is a separate negotiation with dining services, each with different POS systems, each with different policies. Scaling is operationally nightmarish, not technically challenging.
**Key Insight:** Foundry's lifecycle system should recognize "operational scaling complexity" — when growth requires per-customer operational work (negotiations, integrations, customizations) that doesn't get easier with scale. The system should model the operational cost curve, not just the revenue curve.

### F-137: Natasha Volkov
**Background:** 31, Russian-American, former barista and home coffee enthusiast. Lives in Portland. No tech background.
**Product:** BrewPerfect — coffee brewing guide app with recipe library, grind size calculator, water temperature optimizer, and bean-to-water ratio tools.
**Situation:** 25,000 downloads. Revenue: $1,200/mo (premium recipes). The app is niche but loved. Her problem: coffee enthusiasts are a $3/mo audience, not a $30/mo audience. She needs 10,000 premium subscribers to make a living, and she's at 400. The math doesn't work at her current price point.
**Key Insight:** Foundry's scenario modeling should include "price point viability analysis" — calculating the required subscriber count at different price points against realistic conversion rates and TAM. When the math doesn't work (required subscribers > realistic addressable market), the system should flag: "This price point requires implausible scale. Consider adjacent revenue streams."

---

## Cohort 11: Deep Tech Founders (13 Personas)

### F-138: Dr. Alisha Patel
**Background:** 36, PhD in computer vision from CMU. Indian-American, lives in Pittsburgh. Published 30+ papers on 3D reconstruction.
**Product:** ScanReal — real-time 3D scanning from phone cameras for real estate virtual tours (no specialized hardware needed).
**Situation:** 5 real estate agencies on pilot ($499/mo). Revenue: $2,495/mo. The technology is 2 years ahead of competitors. But she's spending all her time on research (improving scan quality) instead of shipping features that real estate agents actually need (auto-generated floor plans, measurement tools, MLS integration).
**Key Insight:** Foundry's decision queue should detect "research vs. product tension" in deep tech founders — when a founder's time allocation is disproportionately weighted toward technical improvement vs. customer-requested features. The system should model the marginal value of 10% better scan quality vs. floor plan generation for customer acquisition.

### F-139: Dr. James Chen
**Background:** 42, PhD in NLP from Stanford. Chinese-American, lives in Palo Alto. Former Google Brain researcher.
**Product:** LegalMind — AI contract analysis platform that identifies risks, inconsistencies, and missing clauses in legal agreements.
**Situation:** 15 law firms ($999/mo). Revenue: $14,985/mo. Strong traction, funded ($3M seed). But GPT-4/Claude advancement means his proprietary NLP models are losing their technical edge. The moat he spent 3 years building is eroding in months. He needs to shift his moat from technology to data/workflow.
**Key Insight:** Foundry's competitive monitoring should include "technology moat erosion" detection — when foundational model improvements from large labs compress a startup's technical advantage. The stressor should trigger a strategic review: "Your technical moat has narrowed from 2 years to 6 months. Where is your durable advantage?"

### F-140: Dr. Maya Johansson
**Background:** 38, PhD in robotics from ETH Zurich. Swedish, lives in Stockholm. World expert in soft robotics.
**Product:** FlexGrip — soft robotic gripper control software for food processing automation (handling delicate produce without damage).
**Situation:** 3 food processing plants on pilot. Revenue: $6,000/mo. The technology works. But each deployment requires on-site calibration (2-3 days per facility) and her team is 2 people. She can install at 2 facilities per month. The backlog is 15 facilities.
**Key Insight:** Foundry's scaling analysis should model "deployment capacity" as a growth constraint — when customer acquisition is not the bottleneck but deployment/installation/calibration is. The system should project growth based on deployment capacity, not pipeline size, and model the ROI of hiring field engineers vs. developing self-calibration.

### F-141: Dr. Robert Kim
**Background:** 45, PhD in quantum computing from MIT. Korean-American, lives in Boston. Former IBM Quantum researcher.
**Product:** QuantumSim — quantum circuit simulation on classical hardware (allows developers to test quantum algorithms without access to real quantum computers).
**Situation:** 20 users (mostly academic labs). Revenue: $4,000/mo. The product is too early — quantum computing is 5-10 years from commercial relevance. He's building for a market that doesn't fully exist yet. But if he waits, someone else will build it.
**Key Insight:** Foundry's lifecycle system should support "pre-market" products — where the market exists in early form but hasn't reached commercial maturity. The system should model "market readiness triggers" (specific events that would trigger market growth) and help the founder survive until those triggers fire.

### F-142: Dr. Sarah Obi
**Background:** 35, PhD in computational biology from Harvard. Nigerian-American, lives in Cambridge. Former Broad Institute researcher.
**Product:** GeneFlow — gene expression analysis platform for research labs (faster, cheaper alternative to existing tools like DESeq2/edgeR, with a GUI instead of command line).
**Situation:** 40 labs using the free tier. 5 paying ($199/mo). Revenue: $995/mo. The product has genuine scientific value but researchers are trained to use command-line tools and view GUIs as "not serious." She's fighting a cultural bias against usability.
**Key Insight:** Foundry's D4 (Value Legibility) should account for "audience cultural bias" — when the target user has a cultural preference that works against the product's design philosophy. The system should help founders navigate this: "Your users value X, but your product offers Y. Here's how to bridge the gap without compromising your vision."

### F-143: Dr. Wei Zhang
**Background:** 40, PhD in materials science from Caltech. Chinese-American, lives in LA. Expert in solid-state batteries.
**Product:** BatteryOS — battery management system software for electric vehicle manufacturers (cell balancing, thermal management, degradation prediction).
**Situation:** 2 EV startups using it. Revenue: $10,000/mo. The revenue is real but the sales cycle is 12-18 months, and each customer requires 6 months of integration work. At this rate, he can add 2 customers per year. His investors want 10.
**Key Insight:** Foundry's scenario modeling should distinguish between "revenue growth" and "customer growth" when products have high ARPU and long integration cycles. The system should model whether the path to investor expectations is (a) more customers at current ARPU, (b) higher ARPU from fewer customers, or (c) productizing the integration to shorten cycles.

### F-144: Dr. Elena Volkov
**Background:** 33, PhD in cryptography from Oxford. Russian-British, lives in London. Former GCHQ researcher.
**Product:** ZeroTrace — zero-knowledge proof toolkit for enterprise applications (privacy-preserving identity verification, age verification, credential checking without revealing underlying data).
**Situation:** 3 enterprise customers. Revenue: $9,000/mo. The technology is genuinely novel and the timing is right (privacy regulations + Web3 mainstream adoption). But enterprise sales at this level require a sales team, and she's doing everything herself. She's a world-class cryptographer doing her own cold outreach.
**Key Insight:** Foundry's "founder workload" detection should model "role-skill mismatch" — when a founder is spending significant time on activities far from their expertise (a cryptographer doing sales). The system should quantify the opportunity cost: "Every hour you spend on sales calls is an hour not spent on cryptographic innovation. Your comparative advantage is 100:1 in favor of research."

### F-145: Dr. Marcus Washington
**Background:** 47, PhD in computational fluid dynamics from Georgia Tech. African-American, lives in Atlanta. Former Boeing engineer.
**Product:** AeroSim — aerodynamic simulation for drone manufacturers (faster than ANSYS, specialized for small UAV form factors).
**Situation:** 5 drone companies ($1,500/mo). Revenue: $7,500/mo. His competition is general-purpose CAE tools (ANSYS, COMSOL) that cost $50K+/year. He's 10x cheaper and 5x faster for his specific use case. But ANSYS just launched a "startup program" offering free licenses to small companies — his price advantage just evaporated.
**Key Insight:** Foundry's competitive monitoring should detect "incumbent freemium response" — when a large competitor launches a free/discounted tier specifically targeting the startup's market segment. The system should immediately trigger a strategy review: "Your price advantage is neutralized. What's your non-price differentiation?"

### F-146: Dr. Priya Sharma
**Background:** 39, PhD in affective computing from MIT. Indian-American, lives in Cambridge. World expert in emotion recognition from speech.
**Product:** EmotiSense — emotion analytics API for call centers (real-time caller emotion detection to improve customer service outcomes).
**Situation:** 4 call centers using it. Revenue: $8,000/mo. The technology works. But the ethics are complex — employees feel surveilled, and the accuracy across demographics is uneven (works better for some accents than others). She's building technology that could harm the people it monitors.
**Key Insight:** Foundry's audit should include an "ethical impact assessment" for AI products — evaluating fairness across demographics, surveillance implications, consent mechanisms, and potential for misuse. This is distinct from compliance; it's about whether the product can be used responsibly.

### F-147: Dr. Alex Nakamura
**Background:** 34, PhD in ML from UC Berkeley. Japanese-American, lives in San Francisco. Former OpenAI researcher.
**Product:** SynthData — synthetic data generation platform for ML training (generates realistic, privacy-preserving training data for healthcare, finance, and autonomous driving).
**Situation:** 8 customers ($2,000/mo). Revenue: $16,000/mo. The business is growing. But the foundational model labs (OpenAI, Anthropic, Google) are all building internal synthetic data capabilities. His technology is excellent but the biggest potential customers are building it themselves.
**Key Insight:** Foundry's competitive monitoring should model "build vs. buy inflection" — the point at which large potential customers transition from buying a solution to building it internally. The system should help founders identify the "buy zone" (companies too small to build, too large to ignore) and focus there.

### F-148: Dr. Linda Thornton
**Background:** 50, PhD in optical engineering from MIT. American, lives in Tucson. Former Raytheon engineer.
**Product:** LidarLite — compact, low-cost LiDAR sensor with accompanying software for precision agriculture (crop height measurement, yield estimation, disease detection from canopy analysis).
**Situation:** Hardware + software product. 20 sensors deployed ($200/sensor + $50/mo software). Revenue: $1,000/mo recurring + $4,000 hardware revenue. She's subsidizing sensors to get software adoption, but the hardware costs are eating her alive. She needs to decide: become a hardware company, become a software company, or die in the middle.
**Key Insight:** Foundry's scenario modeling should include "hardware-software economics" analysis — modeling the long-term business under three scenarios: hardware-led (high upfront, low recurring), software-led (BYOD sensor, high recurring), and integrated (subsidy model with break-even projections). Deep tech founders often default to "both" when the market demands a choice.

### F-149: Dr. James Petrov
**Background:** 41, PhD in signal processing from Georgia Tech. Bulgarian-American, lives in Atlanta. Former Qualcomm engineer.
**Product:** SpectrumAI — RF spectrum analysis tool that uses ML to detect interference patterns and optimize wireless network performance.
**Situation:** 3 telecom companies on pilot ($5,000/mo). Revenue: $15,000/mo. The technology is differentiated. But his customers' procurement departments are slow (6-12 month cycles), and the pilots keep extending because "we need more data." He's in pilot purgatory — companies use his product but won't sign contracts.
**Key Insight:** Foundry's stressor system should detect "pilot purgatory" — when customer engagements stay in pilot/trial status beyond the expected conversion timeline. The system should flag it and recommend pilot-to-paid conversion strategies: sunset dates, success metrics, escalation to executive sponsors.

### F-150: Dr. Amara Chen
**Background:** 37, PhD in biomedical engineering from Johns Hopkins. Chinese-American, lives in Baltimore. Former Medtronic engineer.
**Product:** RehabAI — AI-powered physical rehabilitation platform that uses phone cameras to track patient movement and provide real-time form correction.
**Situation:** 8 physical therapy clinics on pilot. Revenue: $3,200/mo. The clinical evidence is strong (faster recovery times in pilot data). But she needs clinical trials to publish peer-reviewed results, which takes 18-24 months and $200K+. Without published evidence, clinicians won't adopt at scale. With published evidence, she'd need 2 years she can't afford.
**Key Insight:** Foundry's scenario modeling should model "evidence-gated markets" — where adoption requires published evidence, not just a working product. The system should map the evidence timeline and cost against the founder's runway, and recommend strategies: early-access programs, case studies, pre-print publications, and pilot data as interim evidence.

---

## Cohort 12: Climate/Impact Founders (12 Personas)

### F-151: Dr. Nina Okafor
**Background:** 40, environmental scientist. Nigerian-British, lives in Bristol. Former WWF researcher. 15 years in biodiversity conservation.
**Product:** BiodiversityIQ — biodiversity monitoring platform for land developers and corporations (species detection via acoustic/camera monitoring, regulatory compliance reporting, impact mitigation planning).
**Situation:** 5 corporate clients ($2,000/mo). Revenue: $10,000/mo. The product is needed (EU biodiversity regulations are incoming). But her hardware deployment (acoustic sensors) costs $5K per site, and each site needs custom calibration. She's running a hardware installation business, not a SaaS company.
**Key Insight:** Foundry's audit should evaluate "value chain position" — where in the hardware/software/services stack a product actually sits vs. where the founder thinks it sits. When hardware deployment is the primary cost and time sink, the product isn't SaaS yet regardless of what the pricing model says.

### F-152: Marcus Green
**Background:** 35, former Tesla energy division engineer. African-American, lives in Oakland. Solar and battery systems expert.
**Product:** GridBalance — energy storage optimization platform for commercial buildings with solar+battery systems (maximizes self-consumption, minimizes grid costs, manages demand response).
**Situation:** 10 buildings ($499/mo). Revenue: $4,990/mo. Each customer saves 20-40% on energy costs. The product is underpriced relative to value delivered. But his customers (building managers) think of software as a $99/mo expense, not a $499/mo investment. He's fighting budget mental models.
**Key Insight:** Foundry's D6 (Commercial Integrity) should include "value capture ratio" guidance — when a product demonstrably saves customers significant money, the pricing should capture a percentage of the savings. The system should model "gain-sharing" pricing structures as alternatives to flat subscriptions.

### F-153: Ava Johansson
**Background:** 29, environmental engineer. Swedish, lives in Stockholm. Former Vattenfall employee. Obsessed with decarbonizing heating.
**Product:** HeatMap — building energy efficiency assessment platform (thermal modeling, retrofit recommendations, carbon reduction projections, grant/incentive matching).
**Situation:** 20 property managers using it ($149/mo). Revenue: $2,980/mo. EU energy performance directives are creating massive demand. But the market is price-sensitive (property managers see this as a compliance cost, not a value investment), and government grant programs change constantly. Her product needs weekly regulatory updates.
**Key Insight:** Foundry's stressor system should model "regulatory tailwind volatility" — when a product benefits from regulation, but the regulations themselves change frequently. The system should track regulatory change frequency as a cost input and model the engineering burden of staying current.

### F-154: James Obi
**Background:** 38, former agricultural extension officer. Nigerian, lives in Abuja. 12 years helping smallholder farmers.
**Product:** FarmIQ — precision agriculture platform for smallholder farmers in Sub-Saharan Africa (satellite imagery, weather forecasting, crop advisory, market prices).
**Situation:** 2,000 farmers using the free tier. Revenue: $400/mo (from agricultural input companies placing ads). His users are subsistence farmers who can't pay. His real customers are agricultural input companies, NGOs, and government agencies who want to reach those farmers. He's a B2B2C business disguised as B2C.
**Key Insight:** Foundry's lifecycle system should recognize "proxy customer" models — where the end user never pays and the paying customer is someone who wants access to or impact on the end user. The Product DNA should support separate ICP profiles for the end user and the paying customer.

### F-155: Dr. Sarah Kim
**Background:** 43, climate scientist. Korean-American, lives in Seattle. Former NOAA researcher. Published extensively on urban heat islands.
**Product:** CoolCity — urban heat mitigation planning platform for city governments (heat island mapping, tree canopy analysis, cool roof planning, health impact modeling).
**Situation:** 3 city governments using it (free pilot). Revenue: $0. The product is excellent but city governments move at geological speed. Her 12-month pilot is in month 9 with no procurement decision in sight. She's funding the company from her NOAA pension.
**Key Insight:** Foundry's lifecycle system should have a "government SaaS" track with adjusted timelines for every metric — pilot duration, procurement cycles, revenue recognition, stressor thresholds. A 12-month unpaid pilot is normal for government SaaS, not a crisis.

### F-156: Chen Xiaoming
**Background:** 34, Chinese environmental engineer. Lives in Beijing, building for the global market. Former Alibaba Cloud sustainability team.
**Product:** CarbonAPI — carbon footprint calculation API for e-commerce platforms (per-product carbon impact, offset matching, carbon label generation).
**Situation:** 8 e-commerce platforms using it ($299/mo). Revenue: $2,392/mo. EU Digital Product Passport regulations will make this mandatory by 2028. He's early but the market is coming. His challenge: surviving 2 years until the regulatory mandate creates urgency.
**Key Insight:** Foundry's scenario modeling should model "regulatory mandate countdown" — when a specific regulation with a known effective date will create a market. The system should help founders plan their cash runway and customer development against the mandate date, and model the demand curve as the deadline approaches.

### F-157: Maria Santos
**Background:** 31, marine biologist. Brazilian, lives in Florianopolis. Former researcher at the Brazilian Institute of Marine Research.
**Product:** OceanWatch — ocean health monitoring platform for coastal communities and marine conservation organizations (water quality, species tracking, pollution detection via satellite + sensor data).
**Situation:** 5 conservation organizations using it. Revenue: $500/mo. The product monitors ocean health, but conservation organizations have no money. Her real customer might be the fishing industry (sustainable fishing certification), tourism industry (marine park management), or government (regulatory compliance). She needs to find who will pay to keep oceans healthy.
**Key Insight:** Foundry's Product DNA should include "willingness-to-pay mapping" — for impact products, systematically evaluating which stakeholder in the value chain has both the motivation AND the budget to pay. The system should map the entire stakeholder ecosystem and identify the optimal paying customer.

### F-158: Alex Rivera
**Background:** 40, former UN climate advisor. American, lives in Geneva. 15 years in international climate policy.
**Product:** ClimateScore — ESG scoring platform for institutional investors (real-time environmental performance tracking, greenwashing detection, regulatory compliance forecasting).
**Situation:** 4 investment firms using it ($3,000/mo). Revenue: $12,000/mo. Strong traction with institutional investors who are under pressure from regulators and LPs to demonstrate climate commitment. But ESG is politically charged in the US — "anti-ESG" legislation is spreading through state governments. His US market could evaporate.
**Key Insight:** Foundry's competitive monitoring should include "political risk" for products in politically charged categories. The system should track legislative activity that could affect the product's market and model scenarios: What if your largest market bans your product category?

### F-159: Fatima Al-Hassan
**Background:** 36, Jordanian water engineer. Lives in Amman. Former World Bank water infrastructure consultant.
**Product:** AquaSmart — water utility management platform for municipalities in water-scarce regions (leak detection, demand forecasting, conservation incentive management).
**Situation:** 3 municipalities using it. Revenue: $1,500/mo. Water scarcity is a growing crisis, but her customers are cash-strapped municipalities in developing countries. The World Bank and other development finance institutions fund water infrastructure but their procurement processes take 2-3 years. She's caught between urgent need and glacial funding.
**Key Insight:** Foundry's lifecycle system should support "development finance" timing — when a product's primary funding source is international development institutions. The system should map DFI funding cycles, propose grant applications, and model bridge financing strategies.

### F-160: Dr. Robert Thornton
**Background:** 48, soil scientist. American, lives in Iowa. Former USDA researcher. 20 years studying soil carbon sequestration.
**Product:** SoilCarbon — soil carbon measurement and verification platform for agricultural carbon credit markets (MRV: measurement, reporting, verification).
**Situation:** 12 farms enrolled. Revenue: $3,600/mo. The carbon credit market is booming but volatile — credit prices fluctuate wildly, and methodological standards keep changing. His technology measures carbon accurately, but the market can't decide how to price what he's measuring.
**Key Insight:** Foundry's stressor system should model "market infrastructure risk" — when a product depends on a market that's still building its own rules (carbon credits, crypto, prediction markets). The system should track market infrastructure maturity (standards bodies, price stability, regulatory clarity) as a macro risk factor.

### F-161: Grace Okafor
**Background:** 30, Nigerian-American environmental activist. Lives in Houston. Former Sierra Club organizer.
**Product:** PollutionWatch — community air quality monitoring platform (low-cost sensor deployment, real-time mapping, environmental justice data for advocacy).
**Situation:** 8 community organizations using it. Revenue: $0 (grant-funded). The product empowers communities near industrial facilities to document air quality violations. But her users are activists fighting polluters with political power. She's building a tool that threatens powerful interests.
**Key Insight:** Foundry's stressor system should recognize "adversarial market risk" — when a product's value proposition directly threatens a powerful incumbent or interest group. The system should model retaliation scenarios (legal threats, lobbying, regulatory capture) and recommend defensive strategies.

### F-162: Thomas Nakamura
**Background:** 42, Japanese-American architect. Lives in Portland. 18 years designing sustainable buildings. LEED AP.
**Product:** GreenSpec — sustainable building materials specification platform (matches performance requirements with sustainable alternatives, tracks embodied carbon, generates compliance documentation).
**Situation:** 15 architecture firms ($199/mo). Revenue: $2,985/mo. Architects love it. But the real decision-makers are developers and general contractors who care about cost, not sustainability. Architects specify; developers decide. He's selling to the wrong buyer.
**Key Insight:** Foundry's Product DNA should detect "specifier vs. decider" dynamics — when the product's user (who loves it) is different from the buyer (who pays for it). This is a variant of F-007's buyer-user misalignment, but specific to industries with specification workflows (architecture, healthcare, education).

---

## Cohort 13: Marketplace Founders (13 Personas)

### F-163: Kevin Williams
**Background:** 34, former Uber operations manager. African-American, lives in Atlanta. Expert in marketplace dynamics.
**Product:** HandyHub — marketplace connecting homeowners with vetted handymen for small repairs (under $500).
**Situation:** 200 handymen, 1,500 homeowners in Atlanta. Revenue: $3,200/mo (20% commission). The marketplace works but quality control is his nightmare — 1 bad handyman ruins the trust for the next 50 homeowners. He's spending 30% of his time on dispute resolution.
**Key Insight:** Foundry's audit should evaluate "marketplace trust infrastructure" as a core dimension — quality scoring, dispute resolution, guarantee programs, identity verification. For marketplace founders, trust IS the product, not a feature.

### F-164: Sarah Johansson
**Background:** 29, Swedish-American, former Etsy product manager. Lives in Brooklyn.
**Product:** LocalMade — marketplace for locally-made artisan goods (food, crafts, art) with same-day local delivery.
**Situation:** 80 makers, 2,000 buyers in Brooklyn. Revenue: $2,400/mo. The product only works with hyperlocal density. She's validated in one neighborhood but can't figure out how to expand without having to rebuild supply in each new neighborhood.
**Key Insight:** Foundry's scenario modeling should include "marketplace expansion unit economics" — modeling the cost and timeline to achieve liquidity in each new geography. The system should identify whether the marketplace has "portability" (supply follows demand) or requires "cold start" in each new market.

### F-165: Ahmed Hassan
**Background:** 37, Egyptian-American, former logistics manager. Lives in Houston.
**Product:** FreightMatch — marketplace matching small shippers with independent truckers for regional freight.
**Situation:** 50 truckers, 30 shippers. Revenue: $4,800/mo. Both sides are winning. But truckers are price-sensitive and will bypass the platform to avoid commissions once they establish relationships with shippers. Disintermediation is his biggest threat.
**Key Insight:** Foundry's competitive analysis should model "disintermediation risk" for marketplace founders — when the supply and demand sides have incentive to transact directly after initial matching. The system should recommend "stickiness strategies" (payments, insurance, dispatch tools, fleet management) that add value beyond matching.

### F-166: Priya Chakraborty
**Background:** 32, Indian-American, former TaskRabbit operations. Lives in SF.
**Product:** TutorNow — marketplace for in-person tutoring (matching students with local tutors, scheduling, payment, progress tracking).
**Situation:** 100 tutors, 500 families in SF Bay Area. Revenue: $5,600/mo (25% commission). Great retention on the student side. But tutors complain about the commission rate and the best tutors eventually leave to build their own client base. She's training her supply side to not need her.
**Key Insight:** Foundry's stressor system should detect "supply-side churn by success" — when the most successful participants on one side of a marketplace leave because they've outgrown the platform. The system should model "supply graduation rate" and recommend retention strategies (certification, volume guarantees, tools that only work on-platform).

### F-167: James Obi
**Background:** 45, Nigerian-British, former NHS administrator. Lives in Manchester.
**Product:** LocumLink — marketplace matching hospitals with locum (temporary) doctors for shift coverage.
**Situation:** 200 doctors, 15 hospitals. Revenue: $12,000/mo. High-stakes marketplace — a bad match could affect patient care. Regulatory requirements are intense (credential verification, indemnity insurance, right-to-work checks). Each new doctor requires 2-3 weeks of onboarding. His supply growth is bottlenecked by verification.
**Key Insight:** Foundry's scenario modeling should include "verification-constrained supply" analysis — modeling marketplace growth based on the verification pipeline capacity, not demand or marketing. The system should identify verification bottlenecks and model the ROI of automated verification tools.

### F-168: Lisa Chen
**Background:** 28, former Airbnb data scientist. Chinese-American, lives in Austin.
**Product:** ParkShare — marketplace for renting private parking spaces (homeowners near stadiums/airports rent their driveways).
**Situation:** 300 parking spots, 2,000 users. Revenue: $2,800/mo. Usage is extremely spiky — game days, concert nights, holiday travel. Off-peak usage is near zero. She has a perishable inventory problem (empty spots on a Tuesday are worthless).
**Key Insight:** Foundry's metric analysis should support "perishable inventory" marketplace metrics — tracking utilization rate, peak/off-peak ratio, and demand predictability. The stressor system should normalize for expected usage patterns rather than flagging off-peak dormancy as decline.

### F-169: Diego Ramirez
**Background:** 40, Mexican-American, former construction foreman. Lives in Phoenix.
**Product:** CrewBoard — marketplace matching construction companies with skilled tradespeople for project-based work.
**Situation:** 150 tradespeople, 25 construction companies. Revenue: $6,400/mo. The marketplace is active but safety is a concern — a worker injury on a job found through CrewBoard raises liability questions. Who's responsible? He's operating without clear legal frameworks.
**Key Insight:** Foundry's audit should evaluate "marketplace liability framework" as a dimension — who is liable when things go wrong? For marketplaces in physical services (construction, healthcare, transportation), unclear liability is an existential risk, not just a legal detail.

### F-170: Nina Petrov
**Background:** 35, Bulgarian, lives in Sofia. Former Booking.com product manager. Building for the US market remotely.
**Product:** ExpertHour — marketplace for booking 1:1 consultations with industry experts (from former CEOs to specialized engineers).
**Situation:** 80 experts, 400 clients. Revenue: $3,200/mo (20% commission). The marketplace works for high-priced experts ($200+/hr) but not for mid-range ($50-100/hr). Her unit economics only work at the high end, which limits her market.
**Key Insight:** Foundry's scenario modeling should include "price-tier viability" for marketplace products — modeling which price ranges produce viable unit economics and which don't. The system should recommend focus rather than trying to serve all price tiers.

### F-171: Tom Andersen
**Background:** 38, Norwegian-American, former farmer. Lives in Minnesota. Runs a 500-acre corn/soy operation.
**Product:** FarmSwap — marketplace for farmers to rent idle equipment to neighboring farms (combines, planters, sprayers).
**Situation:** 40 farmers, 80 equipment listings. Revenue: $1,800/mo (10% commission). The product solves a real problem (a $400K combine sits idle 50 weeks/year). But farmers are risk-averse and worry about equipment damage. Insurance and liability are the blockers, not technology.
**Key Insight:** Foundry's Product DNA should detect "trust blocker products" — marketplace products where the primary adoption barrier isn't value proposition or UX, but trust/insurance/liability. The system should recommend that the founder solve the trust problem before building more features.

### F-172: Keiko Tanaka
**Background:** 31, Japanese-American, former DoorDash operations. Lives in LA.
**Product:** HomeFeast — marketplace connecting home cooks with hungry neighbors (like Airbnb for home-cooked meals).
**Situation:** 30 cooks, 500 eaters. Revenue: $2,100/mo. The food is incredible — real home cooking from diverse cultures. But health department regulations require food handlers' permits, commercial kitchen standards, and inspections. Most of her cooks are operating illegally. She's running a marketplace that could be shut down by a single health inspector visit.
**Key Insight:** Foundry's stressor system should flag "regulatory compliance gap in supply" — when a marketplace's supply side operates in a regulatory gray zone. The system should classify this as "critical" severity and model the cost/timeline of compliance vs. the risk of enforcement.

### F-173: Marcus Rivera
**Background:** 36, Puerto Rican, former event promoter. Lives in Miami. Expert in nightlife and entertainment.
**Product:** GigBoard — marketplace connecting venues with live performers (musicians, comedians, DJs) for bookings.
**Situation:** 200 performers, 50 venues. Revenue: $3,600/mo. Both sides are happy. But the marketplace is geographically fragmented — a jazz guitarist in Miami is useless to a venue in Portland. He needs local density in every city, and each city is essentially a separate marketplace.
**Key Insight:** Foundry's scenario modeling should distinguish between "network effect marketplaces" (Uber — any driver serves any rider) and "local network marketplaces" (GigBoard — supply/demand must be co-located). The growth strategy and unit economics are fundamentally different.

### F-174: Rachel Kim
**Background:** 33, Korean-American, former wedding photographer. Lives in Seattle.
**Product:** PhotoMatch — marketplace connecting event hosts with photographers (weddings, corporate events, parties) with AI-powered style matching.
**Situation:** 60 photographers, 200 bookings completed. Revenue: $4,000/mo. The AI style matching is her differentiator — it analyzes a photographer's portfolio against the client's visual preferences. But training the model requires thousands of labeled examples, and she's running on 500. The matching accuracy is 70% — good enough to demo, not good enough to trust.
**Key Insight:** Foundry's audit should evaluate "AI confidence threshold" for products that use ML for core functionality — is the model accurate enough for the use case's tolerance for error? The system should model the data volume needed to reach target accuracy and whether the founder's current data acquisition rate can get there within runway.

### F-175: David Okafor
**Background:** 42, Nigerian-British, former NHS nurse turned entrepreneur. Lives in London.
**Product:** CareConnect — marketplace matching families with vetted home care workers for elderly care.
**Situation:** 100 care workers, 250 families. Revenue: $8,000/mo. The marketplace is growing steadily. But care work is emotionally intimate — families trust care workers with their vulnerable loved ones. One incident of abuse or neglect and the marketplace brand is destroyed. Quality control isn't a feature; it's survival.
**Key Insight:** Foundry's stressor system should model "catastrophic trust risk" for marketplaces operating in high-vulnerability contexts (elderly care, childcare, healthcare). A single safety incident has outsized reputational impact. The system should treat quality assurance investment as existential, not operational.

---

# Part II: Synthesized Insight Themes (14 Themes)

Across 175 founders, 13 cohorts, and hundreds of unique situations, the following 14 insight themes emerge. Each represents a systematic gap or opportunity in Foundry's current architecture that, if addressed, would make the platform more congruent with its mission of autonomous operational intelligence for every founder, regardless of their context.

---

## Theme 1: Founder-Level Intelligence (Beyond Product Metrics)

**Source personas:** F-004, F-012, F-033, F-054, F-055, F-076, F-086, F-087, F-088, F-091, F-144
**Pattern:** Foundry is product-intelligent but founder-blind. The system tracks MRR, cohorts, stressors, and competitive signals — but doesn't model the founder's personal constraints: financial runway, immigration status, co-founder dynamics, time availability, health, or motivation.

**Insight:** The most common reason a product dies isn't product-market fit — it's founder exhaustion, financial ruin, or personal crisis. Foundry's risk state engine needs a "Founder Health" layer that tracks:
- Personal financial runway (months of personal expenses covered)
- Time availability (hours/week dedicated to the product)
- Key person dependency (single points of failure in the team)
- Motivation signals (login frequency trends, decision response latency)
- Immigration/legal constraints

**Impact:** This transforms Foundry from a product intelligence platform to a founder intelligence platform — the original vision of "Architecture C → D."

---

## Theme 2: Sector-Aware Auditing

**Source personas:** F-001, F-003, F-009, F-020, F-021, F-024, F-035, F-037, F-039, F-045, F-061, F-070, F-113, F-115, F-117, F-130, F-142
**Pattern:** Foundry's 10-dimension audit applies the same rubric to a nuclear-grade infrastructure tool and a church management app. Dimensions like D5 (Operational Readiness), D6 (Commercial Integrity), and D10 (Stranger Test) need sector-specific calibration.

**Insight:** The audit engine should support "sector profiles" that adjust:
- Scoring weights (D6 matters more for fintech; D10 matters more for consumer)
- Passing thresholds (SOC 2 for B2B SaaS, HIPAA for healthcare, COPPA for kids)
- Remediation language (technical for developer tools, plain English for non-technical founders)
- Tone (encouraging for first-timers, direct for serial founders)

**Impact:** This makes the audit engine honest across contexts — an education SaaS with annual purchase orders shouldn't fail D6 because it doesn't have monthly credit card billing.

---

## Theme 3: Non-Code Founder Support

**Source personas:** F-003, F-009, F-031, F-032, F-034, F-036, F-038, F-039, F-042, F-043, F-044, F-045, F-060
**Pattern:** Foundry's core capabilities (GitHub audit, remediation PRs, code analysis) are useless for the significant population of founders building on no-code platforms, using dev agencies, or outsourcing development. These founders are often the deepest domain experts with the strongest customer relationships.

**Insight:** The platform needs a "non-code founder" track:
- Alternative audit intake (URL-based analysis, manual checklist, deployment platform hooks)
- Remediation as contractor/vendor recommendations instead of PRs
- Technical transition advisory (when to migrate from no-code to custom code)
- Vendor evaluation guidance (how to assess agency code quality)

**Impact:** This expands Foundry's addressable market from "technical SaaS founders" to "all SaaS founders" — which is the stated mission.

---

## Theme 4: Marketplace-Specific Intelligence

**Source personas:** F-010, F-038, F-052, F-066, F-096, F-133, F-163, F-164, F-165, F-166, F-167, F-168, F-169, F-170, F-171, F-172, F-173, F-174, F-175
**Pattern:** Marketplaces have fundamentally different dynamics than single-sided SaaS products: liquidity thresholds, chicken-and-egg problems, disintermediation risk, supply-side quality control, perishable inventory, local density requirements, and platform liability.

**Insight:** Foundry needs a "marketplace mode" that adds:
- Liquidity health metrics (supply/demand ratio, match rate, time-to-match)
- Disintermediation risk scoring (how easily do matched parties bypass the platform?)
- Supply-side quality and trust infrastructure audit
- Critical mass modeling (minimum supply per geography/category)
- Marketplace-specific stressors (supply churn, demand concentration, regulatory compliance gap)

**Impact:** Marketplaces represent a large and growing segment of SaaS products. Without marketplace-specific intelligence, Foundry's standard metrics will produce misleading signals for these founders.

---

## Theme 5: Regulatory Intelligence Layer

**Source personas:** F-011, F-026, F-056, F-059, F-061, F-064, F-065, F-070, F-077, F-079, F-132, F-134, F-153, F-155, F-156, F-158, F-159, F-172
**Pattern:** A surprising number of founders (>30 of 175) operate in regulated or soon-to-be-regulated markets. Their challenges aren't product challenges — they're regulatory navigation challenges. Compliance costs, certification timelines, licensing requirements, and political risk dominate their decision landscape.

**Insight:** Foundry needs a "Regulatory Intelligence" module:
- Regulatory classification advisor (is your product a medical device, a financial service, etc.?)
- Compliance pathway mapping (costs, timelines, requirements)
- Regulatory change monitoring (tracking incoming regulations and their impact)
- Political risk scoring (for products in politically charged categories)
- Jurisdiction mapping (multi-state/multi-country regulatory landscapes)

**Impact:** Regulatory navigation is one of the highest-leverage areas for AI assistance — the information exists, it's complex, and founders waste months discovering it. This module would be immediately valuable.

---

## Theme 6: Business Model Intelligence

**Source personas:** F-014, F-015, F-019, F-021, F-030, F-038, F-049, F-050, F-068, F-072, F-075, F-082, F-090, F-092, F-093, F-096, F-119, F-137, F-148, F-151, F-152, F-154, F-170
**Pattern:** Many founders are building the wrong business model for their market, and Foundry's current system doesn't evaluate business model fit. Services-disguised-as-SaaS, underpricing, open-core confusion, transaction-dependent revenue, subsidy-dependent growth, seasonal products, and currency exposure all represent business model issues, not product issues.

**Insight:** Foundry needs a "Business Model Health" dimension:
- Revenue model classification (subscription, transaction, usage-based, marketplace commission, freemium, open-core, grant-funded)
- Unit economics modeling (per-customer COGS, contribution margin, payback period)
- Pricing-to-value ratio analysis (are you capturing a fair share of the value you create?)
- Business model archetype matching (is your revenue model appropriate for your market?)
- Seasonal and currency-adjusted metrics

**Impact:** Product-market fit is only half the equation. Business model fit determines whether a product that works can sustain the company that builds it.

---

## Theme 7: Co-Founder Dynamics Engine

**Source personas:** F-018, F-099, F-100, F-101, F-102, F-103, F-104, F-105, F-106, F-107, F-108, F-109, F-110, F-111
**Pattern:** Co-founder conflict is the #1 startup killer, yet Foundry treats the product as if it has a single operator. 14 of 175 personas (8%) have co-founder conflicts that are actively degrading product outcomes — and these are the ones who are still together.

**Insight:** Foundry should offer a "co-founder alignment" module:
- Independent Product DNA responses from each co-founder (vision alignment scoring)
- Decision attribution tracking (who proposes/approves decisions; detecting imbalance)
- Divergence detection (when co-founders' decisions systematically disagree along an axis)
- Co-founder gate agreements (pre-defined autonomy levels per decision category)
- Conflict early warning (engagement pattern divergence, decision latency increases)

**Impact:** This addresses the biggest risk that no other startup tool handles. Co-founder alignment data could become one of Foundry's most valuable datasets.

---

## Theme 8: Intelligent Growth Stage Awareness

**Source personas:** F-006, F-010, F-017, F-029, F-036, F-041, F-048, F-050, F-057, F-069, F-091, F-097, F-114, F-129, F-136, F-141
**Pattern:** Foundry's current system doesn't strongly differentiate between growth stages. The advice for a product with 3 users should be radically different from a product with 3,000 users. Features, metrics, stressors, and digest focus should all adapt to stage.

**Insight:** The system needs explicit "stage gates" that adjust all behavior:
- **Pre-launch** (0 users): Focus on D1-D4, D9-D10. No metrics analysis. Ship velocity tracking.
- **Early traction** (1-50 customers): Hypothesis validation priority. Churn diagnosis. ICP refinement.
- **Growth** (50-500 customers): Unit economics. Scaling constraints. First hire analysis.
- **Scale** (500+ customers): Team dynamics. Market positioning. Category creation.
- **Mature** (stable growth): Efficiency optimization. Adjacent markets. Lifestyle-mode option.

**Impact:** Stage-appropriate intelligence prevents Foundry from overwhelming early founders with metrics they don't have yet, or under-serving growth-stage founders with pre-launch advice.

---

## Theme 9: Cross-Cultural and Global Founder Support

**Source personas:** F-073, F-074, F-075, F-076, F-078, F-079, F-080, F-081, F-082, F-083, F-084, F-085, F-089, F-090, F-092
**Pattern:** Immigrant founders and founders building across borders face unique challenges that Foundry doesn't address: cultural sales norms, timezone fragmentation, visa constraints, currency exposure, geopolitical risk, purchasing power parity, and offline-first communities.

**Insight:** Foundry needs a "Global Founder" mode:
- PPP-adjusted metrics and stressor thresholds
- Multi-currency MRR tracking
- Timezone-optimized workflow recommendations
- Cultural context for sales and positioning (regional norms)
- Immigration status as a founder risk variable
- Geopolitical risk monitoring for cross-border products

**Impact:** Immigrant founders start 25% of US companies and over 50% of billion-dollar startups. Serving them well isn't a niche — it's core market.

---

## Theme 10: AI Ethics and Safety Dimension

**Source personas:** F-070, F-131, F-132, F-134, F-135, F-146, F-174
**Pattern:** Consumer and AI products increasingly touch sensitive areas — mental health, surveillance, minors, demographic fairness, health claims. The current audit doesn't evaluate the ethical dimensions of AI-powered products.

**Insight:** Foundry should add ethical evaluation dimensions:
- Demographic fairness assessment (does the product work equally across populations?)
- Minor user compliance (COPPA, GDPR-K, age verification)
- Claims substantiation (are marketing claims supported by evidence?)
- Surveillance/consent evaluation (is data collection proportionate and consented?)
- Crisis safety (does the product handle user distress appropriately?)
- Social license assessment (is the product's category facing public trust challenges?)

**Impact:** As AI regulation increases globally, founders who proactively address ethics will have a regulatory advantage. Foundry positioning itself as ethics-aware differentiates it from all competitors.

---

## Theme 11: Competitive Intelligence Deepening

**Source personas:** F-005, F-027, F-030, F-039, F-094, F-112, F-120, F-123, F-139, F-145, F-147
**Pattern:** Foundry's competitive monitoring scans for signals, but founders need deeper strategic analysis: incumbent response probability, platform dependency risk, technology moat erosion, switching cost dynamics, and market migration patterns.

**Insight:** The competitive intelligence module should expand to include:
- Incumbent response modeling (probability, timeline, and form of competitive response)
- Platform dependency risk scoring (API deprecation, terms of service changes)
- Technology moat assessment (how fast is your technical advantage eroding?)
- Switching cost analysis (what does it cost your customers to leave you, and what does it cost them to leave the incumbent?)
- Market structure monitoring (is the customer segment itself shifting?)
- Feature surface area comparison (are you fighting a feature war you can't win?)

**Impact:** Competitive intelligence is one of the highest-value outputs an autonomous platform can provide, because founders consistently underestimate competitive dynamics.

---

## Theme 12: Time and Energy Economics

**Source personas:** F-025, F-029, F-050, F-060, F-086, F-088, F-089, F-097, F-116, F-140, F-143, F-144, F-167
**Pattern:** Foundry's scenario modeling projects revenue and customer metrics, but doesn't model the founder's most scarce resource: time. Many products are growing in revenue but consuming unsustainable founder time per customer.

**Insight:** The platform needs "Time Economics" analysis:
- Founder time per customer tracking (setup, support, customization hours)
- Scaling mode detection (linear scaling vs. leverage; if revenue doubles, does founder time double?)
- First hire ROI modeling (which role, what salary, what's the payback period?)
- Deployment capacity modeling (when growth is bottlenecked by installation/onboarding, not demand)
- Context-switching cost estimation (timezone splits, role multiplicity)

**Impact:** Revenue growth that requires proportional time growth isn't a real business — it's a job. Foundry should help founders identify and break linear scaling traps before burnout.

---

## Theme 13: Value Delivery Monitoring

**Source personas:** F-007, F-022, F-023, F-040, F-044, F-051, F-095, F-128, F-138, F-142
**Pattern:** Foundry monitors revenue health obsessively but doesn't directly measure whether customers are actually getting value. Products can have healthy MRR while delivering declining value — a leading indicator of churn that revenue metrics miss.

**Insight:** The platform needs a "Value Delivery Index":
- Engagement depth (not just logins — are users completing the core workflow?)
- Outcome tracking (did the customer achieve what they came for?)
- Feature utilization analysis (which features are used, which are ignored?)
- Problem-solution alignment (is the product solving what the Product DNA says it solves?)
- Value realization timeline (how long after purchase until the customer sees value?)

**Impact:** This closes the feedback loop between revenue and value — ensuring that Foundry doesn't celebrate healthy MRR on a product that's silently losing its customers' trust.

---

## Theme 14: Emotional and Psychological Intelligence

**Source personas:** F-011, F-017, F-018, F-020, F-034, F-042, F-046, F-047, F-052, F-054, F-073, F-087, F-098, F-106
**Pattern:** Founders are not rational actors. Trauma from past failures drives overcorrection. Empathy prevents saying no. Perfectionism prevents shipping. Imposter syndrome prevents pricing fairly. Loneliness saps motivation. Fear of success is as real as fear of failure.

**Insight:** Foundry's wisdom layer should develop "Founder Psychology" awareness:
- Overcorrection detection (serial founders swinging between extremes)
- Imposter syndrome indicators (underpricing, over-disclaiming, avoiding visibility)
- Perfectionism signals (high commit frequency, low release frequency)
- Empathy-driven scope creep (approving all requests, inability to prioritize)
- Isolation drift (declining engagement in solo founders)
- Trauma-based decision patterns (decisions driven by fear of repeating past failures)

**Impact:** The most powerful operational intelligence isn't "what should you do?" — it's "why aren't you doing what you already know you should do?" Foundry addressing psychological barriers makes it the only platform that treats founders as whole humans, not just operators.

---

# Part III: The Congruent Platform Roadmap

## Guiding Principle

Foundry's overarching purpose is to be **the autonomous operational layer that democratizes operational excellence for every SaaS founder**. "Every" is the operative word. The current platform serves technical, English-speaking, growth-oriented, single-product, US-based founders well. The roadmap below extends Foundry's congruence to the full spectrum of founders who need it.

---

## Tier 1: Foundation Reinforcement (0-3 months)
*Theme: Make what exists work for more founders*

### 1.1 Sector Profile System
**Feature:** Configurable audit sector profiles (B2B SaaS, Consumer, Marketplace, Healthcare, Education, Government, Climate/Impact, Developer Tools, Fintech)
**Target Cohorts:** All cohorts — this affects every audit, remediation, and score
**Build Approach:** Add a `sector_profile` column to `products` table. Create sector-specific scoring weight overrides, passing thresholds, and remediation language templates. Implement as a JSON config system, not hard-coded logic.
**Success Metrics:** 30% reduction in "false positive" blocking issues (issues flagged as critical that aren't relevant to the sector)

### 1.2 Growth Stage Detection
**Feature:** Automatic stage classification (Pre-launch, Early Traction, Growth, Scale, Mature) based on metrics, user count, and revenue. All system behavior adapts to stage.
**Target Cohorts:** First-Time Founders, Technical Founders, Solo Founders
**Build Approach:** Stage classification logic in `lifecycle/monitor.ts`. Update digest generator, stressor thresholds, decision queue ordering, and audit severity by stage. Add stage-specific empty states and guidance.
**Success Metrics:** 50% reduction in "overwhelming" feedback from pre-launch founders; 40% increase in actionable insight rating from growth-stage founders

### 1.3 Founder Health Dashboard
**Feature:** Optional founder-level health tracking — personal runway, time availability, key person mapping, motivation signals (auto-detected from engagement patterns).
**Target Cohorts:** Solo Founders, First-Time Founders, Immigrant Founders
**Build Approach:** New `founder_health` table. Engagement pattern analysis in `intelligence/`. Add to digest as a discreet section. Never share externally. Opt-in only.
**Success Metrics:** 25% earlier detection of founder burnout risk (measured by founder self-reported "I almost quit" surveys)

### 1.4 Lifestyle Mode
**Feature:** "Steady State" mode that adjusts all thresholds for founders optimizing for sustainability rather than growth. Flat revenue isn't a stressor. Weekly digests are lighter. Scenario modeling focuses on profitability, not scale.
**Target Cohorts:** Serial Founders (lifestyle businesses), Mature products
**Build Approach:** Boolean flag on `founders` table. Conditional thresholds in `intelligence/risk-state.ts`. Digest template variant. Scenario model variant.
**Success Metrics:** 20% increase in retention among founders with MRR > $5K and <10% monthly growth (currently the highest-churn segment)

---

## Tier 2: Market Expansion (3-6 months)
*Theme: Serve founders the current system can't reach*

### 2.1 Non-Code Founder Track
**Feature:** Alternative audit intake (URL analysis, manual checklist, deployment platform API). Remediation as vendor/contractor recommendations instead of PRs. Technical transition advisor.
**Target Cohorts:** Non-Technical Founders, Domain Expert Founders
**Build Approach:** New `audit/intake-web.ts` using Lighthouse API, page analysis, and structured questionnaire. New `remediation/vendor.ts` for non-code recommendations. Adjust lifecycle system to support non-GitHub products.
**Success Metrics:** 40% expansion of addressable founder market (currently ~0% non-code founders can use the audit)

### 2.2 Marketplace Intelligence Mode
**Feature:** Marketplace-specific metrics (liquidity, match rate, disintermediation risk), supply/demand balance tracking, critical mass modeling, trust infrastructure audit.
**Target Cohorts:** Marketplace Founders
**Build Approach:** New `intelligence/marketplace.ts` service. New tables: `marketplace_metrics`, `supply_demand_balance`. Extend audit engine with marketplace-specific dimensions. Add marketplace stressor types.
**Success Metrics:** Marketplace founders rate Foundry's insights as "highly relevant" at 70%+ (vs. current estimated 30% with generic SaaS metrics)

### 2.3 Co-Founder Alignment Module
**Feature:** Independent Product DNA from each co-founder, vision alignment scoring, decision attribution tracking, divergence detection, pre-defined co-founder gate agreements.
**Target Cohorts:** Co-Founder Conflict, all multi-founder teams
**Build Approach:** Multi-user Product DNA in `wisdom/dna.ts`. New `co_founder_alignment` table tracking per-founder responses and divergence scores. Decision audit log extended with proposer/approver fields. Alignment report in digest.
**Success Metrics:** 35% reduction in co-founder-related product stalls (measured by decision queue paralysis in multi-founder products)

### 2.4 Global Founder Support
**Feature:** PPP-adjusted metrics, multi-currency MRR, timezone-optimized workflow recommendations, geopolitical risk monitoring.
**Target Cohorts:** Immigrant Founders, Solo Founders building cross-border
**Build Approach:** Currency conversion layer in `intelligence/revenue.ts`. PPP adjustment in stressor thresholds. New `geopolitical_signals` table. Timezone analysis in digest scheduling.
**Success Metrics:** 30% increase in non-US founder activation rate

---

## Tier 3: Intelligence Deepening (6-12 months)
*Theme: Make Foundry's intelligence the best in the world for founders*

### 3.1 Business Model Intelligence
**Feature:** Revenue model classification, unit economics modeling (per-customer COGS, contribution margin, CAC payback), pricing-to-value analysis, seasonal normalization, business model archetype matching.
**Target Cohorts:** All cohorts — this is a universal blind spot
**Build Approach:** New `intelligence/business-model.ts`. Extend `metric_snapshots` with unit economics fields. New audit dimension: Business Model Health. Pricing-to-value analysis in wisdom layer using Product DNA + customer count + revenue.
**Success Metrics:** 50% of founders report discovering a business model issue they hadn't identified (pricing, unit economics, services-vs-SaaS)

### 3.2 Regulatory Intelligence Module
**Feature:** Regulatory classification advisor, compliance pathway mapping, regulatory change monitoring, political risk scoring, jurisdiction mapping.
**Target Cohorts:** Domain Expert Founders, Deep Tech Founders, Climate/Impact Founders
**Build Approach:** New `intelligence/regulatory.ts`. Regulatory database (initially curated, then AI-maintained). Integration with regulatory change feeds. New stressor types: regulatory_classification, compliance_gap, political_risk.
**Success Metrics:** 60% reduction in "I didn't know I needed X compliance" surprises among regulated-market founders

### 3.3 Competitive Intelligence 2.0
**Feature:** Incumbent response modeling, platform dependency risk scoring, technology moat assessment, switching cost analysis, market structure monitoring.
**Target Cohorts:** Technical Founders, Deep Tech Founders, all founders facing incumbents
**Build Approach:** Extend `intelligence/competitive.ts` with deeper analysis prompts. New fields in `competitive_signals`: response_probability, moat_erosion_rate. Platform dependency tracked as a persistent stressor.
**Success Metrics:** 40% increase in founders who adjust strategy in response to competitive intelligence (measured by decisions linked to competitive signals)

### 3.4 Value Delivery Index
**Feature:** Engagement depth tracking, outcome measurement, feature utilization analysis, value realization timeline, problem-solution alignment check.
**Target Cohorts:** All cohorts — addresses the gap between revenue health and actual value
**Build Approach:** New `value_delivery` table. Integration with product analytics (if available) or self-reported metrics. New health dimension alongside MRR health ratio. Incorporated into stressor identification.
**Success Metrics:** 25% improvement in churn prediction accuracy (by catching value-delivery decline before revenue decline)

---

## Tier 4: Autonomous Mastery (12-24 months)
*Theme: Fulfill the Architecture D vision — Foundry as an AI agent that can act*

### 4.1 Founder Psychology Engine
**Feature:** Overcorrection detection for serial founders, imposter syndrome indicators, perfectionism signals, empathy-driven scope creep detection, isolation drift monitoring, trauma-based decision pattern identification.
**Target Cohorts:** All cohorts — psychological barriers affect every founder
**Build Approach:** Pattern matching in `wisdom/patterns.ts` using decision history, engagement signals, and Product DNA analysis. New `founder_psychology` insights table. Surfaced as gentle, non-judgmental observations in digest: "We notice a pattern: you've approved every customer request this month. Here's which ones align with your positioning and which don't."
**Success Metrics:** 30% increase in founder self-awareness scores (survey-based); 20% increase in founders reporting "Foundry helped me see something I couldn't see myself"

### 4.2 Autonomous Market Expansion Advisor
**Feature:** TAM ceiling analysis, adjacent market identification, market expansion readiness assessment, expansion unit economics modeling.
**Target Cohorts:** Vertical SaaS Founders, Domain Expert Founders, Growth-stage products
**Build Approach:** New `intelligence/expansion.ts`. Cross-references Product DNA, market category, feature utilization, and competitive landscape to identify expansion opportunities. Models depth vs. breadth scenarios with revenue projections.
**Success Metrics:** 40% of growth-stage founders pursue an expansion strategy informed by Foundry's analysis

### 4.3 Cross-Product Wisdom Network
**Feature:** Anonymized, consented cross-product insights — "43 products in your market category saw 20% churn improvement after implementing X." Pattern library becomes a living knowledge base.
**Target Cohorts:** All cohorts (value increases with network size)
**Build Approach:** Extend `decision_patterns` with richer context. New `cross_product_insights` table. Wisdom injection pulls from anonymized network data. Consent management for participation.
**Success Metrics:** 50% of founders report cross-product insights as "highly valuable"; network effects create a retention moat for Foundry itself

### 4.4 Ethical AI Assessment
**Feature:** Demographic fairness evaluation, minor user compliance checking, claims substantiation analysis, surveillance/consent audit, crisis safety evaluation, social license assessment.
**Target Cohorts:** Consumer Founders, Deep Tech Founders, AI-powered products
**Build Approach:** New audit dimensions in `audit/scorer.ts`. Fairness testing framework. Compliance checklist by jurisdiction (COPPA, GDPR-K, AI Act). Claims analysis using Product DNA positioning vs. marketing language.
**Success Metrics:** 80% of AI-product founders pass an external ethics review within 6 months of onboarding (vs. estimated 30% baseline)

---

## Roadmap Summary

| Tier | Timeline | Themes Addressed | New Capabilities | Estimated Impact |
|------|----------|------------------|-------------------|------------------|
| **1: Foundation** | 0-3 mo | 2, 8, 1, 14 | Sector profiles, stage detection, founder health, lifestyle mode | 2x relevance for existing users |
| **2: Expansion** | 3-6 mo | 3, 4, 7, 9 | Non-code track, marketplace mode, co-founder alignment, global support | 3x addressable market |
| **3: Deepening** | 6-12 mo | 6, 5, 11, 13 | Business model intelligence, regulatory intelligence, competitive 2.0, value delivery | 5x insight quality |
| **4: Mastery** | 12-24 mo | 14, 8, 10, 11 | Psychology engine, expansion advisor, wisdom network, ethical AI | True Architecture D |

---

## Closing: The Through-Line

Every one of these 175 founders shares one thing: they're trying to build something real, and they're doing it with incomplete information, imperfect skills, and insufficient time. Foundry's genius is recognizing that the operational gap isn't about tools — it's about intelligence. The right information, at the right time, in the right context, with the right level of autonomy.

The roadmap above doesn't add features for features' sake. Each tier peels back another layer of assumption that limits who Foundry can serve and how deeply it can serve them. Sector-aware auditing means a church app and a fintech tool get the intelligence they actually need. Non-code founder support means the best domain experts aren't locked out because they can't connect a GitHub repo. Business model intelligence means Foundry catches the structural problems that product-level metrics miss. And the psychology engine means Foundry finally addresses the elephant in every startup room: the founder's own mind.

The through-line from Persona F-001 (Maya, the biology teacher scared to price her product) to Persona F-175 (David, the NHS nurse terrified that one safety incident could destroy his marketplace) is this: **every founder is managing complexity they weren't trained for, in a domain they can't fully see, on a timeline they can't control.** Foundry's job is to see what they can't, say what they need to hear, and act when they've given permission.

Architecture D isn't just an AI agent that monitors metrics. It's an AI agent that understands the full context of building a company — product, market, money, team, regulation, competition, psychology, and time — and navigates all of it on the founder's behalf.

These 175 founders told us what that looks like. Now we build it.
