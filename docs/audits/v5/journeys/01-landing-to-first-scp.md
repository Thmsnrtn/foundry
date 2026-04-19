# Journey 01 — Landing to First Company Running SCP

## Goal

A new founder arrives at Foundry's public site, signs up, creates their first company, connects GitHub, completes the initial audit, and sees the SCP agents actively running and producing their first briefing.

## Starting State

- No account exists.
- Founder has a live SaaS product with a GitHub repository.
- May or may not have Stripe billing already configured.

## Steps (Happy Path)

1. Land on public marketing page → navigate to signup.
2. Clerk auth: email/password or OAuth (Google/GitHub).
3. Post-auth redirect to onboarding wizard.
4. Create first company: name, repo URL, description.
5. GitHub OAuth → grant repo access.
6. Initial 8-step audit pipeline runs (stack detection through dependency scan).
7. SCP provisioning: 12 agents instantiated for the company.
8. First agent cycle executes → signals generated → briefing assembled.
9. Founder lands on dashboard with live SCP data.

## Success Criteria

- Time from signup click to first live briefing is under 5 minutes.
- Every step has clear progress indication (no blank loading states).
- First briefing references the actual repo, not generic boilerplate.
- Founder understands what the 12 agents do and which ones acted.

## Abandonment Criteria

- Onboarding wizard fails silently or hangs during GitHub connection.
- First audit takes longer than 3 minutes with no progress feedback.
- Dashboard loads but shows empty/placeholder data.

## Fleet-Size Relevance

This journey is fleet-size 0→1. It establishes the baseline experience that every subsequent fleet-scaling journey depends on. If this journey is broken, no multi-company journey is reachable.
