# Condition Matrix — v5 Simulated User Runs

## Condition Axes

### A. Fleet Size (5 levels)

| Code | Description |
|------|-------------|
| `F0` | 0 companies (pre-onboarding) |
| `F1` | 1 company |
| `F2` | 2-3 companies |
| `F5` | 4-7 companies |
| `F15` | 8-15 companies |

### B. Network Conditions (3 levels)

| Code | Description |
|------|-------------|
| `NET-FAST` | Broadband (50+ Mbps, <30ms latency) |
| `NET-AVG` | Average connection (10 Mbps, 80ms latency) |
| `NET-SLOW` | Degraded (2 Mbps, 300ms latency, 1% packet loss) |

### C. Screen Size / Device (4 levels)

| Code | Description |
|------|-------------|
| `SCR-DESK` | Desktop 1920x1080 |
| `SCR-LAP` | Laptop 1440x900 |
| `SCR-TAB` | Tablet 1024x768 |
| `SCR-MOB` | Mobile 390x844 (iOS app or mobile web) |

### D. Accessibility Mode (2 levels)

| Code | Description |
|------|-------------|
| `A11Y-OFF` | Standard visual interaction |
| `A11Y-ON` | Screen reader active, keyboard-only navigation |

### E. Account State (3 levels)

| Code | Description |
|------|-------------|
| `ACCT-NEW` | Brand new account, no prior data |
| `ACCT-EST` | Established account, 2+ weeks of SCP data |
| `ACCT-AGED` | Mature account, 3+ months of data, potentially stale sessions |

### F. Subscription Tier (3 levels)

| Code | Description |
|------|-------------|
| `TIER-SOLO` | Solo ($79) — single company limit |
| `TIER-GROW` | Growth ($199) — multi-company |
| `TIER-INV` | Investor-Ready ($399) — full fleet + portfolio features |

### G. Error / Degradation Injection (4 levels)

| Code | Description |
|------|-------------|
| `ERR-NONE` | Happy path, all services healthy |
| `ERR-API` | External API failure (GitHub, Stripe, or Anthropic returns 500) |
| `ERR-DB` | Database latency spike (Turso responds in 5-10s instead of <100ms) |
| `ERR-AUTH` | Auth edge case (expired JWT, Clerk webhook delay, race condition) |

---

## Full Axis Cardinality

5 (fleet) x 3 (network) x 4 (screen) x 2 (a11y) x 3 (account) x 3 (tier) x 4 (error) = **4,320 possible combinations**

For 100 runs, we sample strategically with the following principles:

1. **Every journey appears at least 8 times** (80 runs minimum to cover 10 journeys x 8).
2. **Every persona appears at least 8 times** across different journeys.
3. **Fleet-size axis is overweighted**: F15 and F5 each get 25% of runs; F2 gets 20%; F1 gets 20%; F0 gets 10%.
4. **Every condition code appears at least 3 times** across the 100 runs.
5. **Accessibility mode appears in 15% of runs** (not just the Devon persona).
6. **Error injection appears in 30% of runs** (distributed across ERR-API, ERR-DB, ERR-AUTH).

---

## 100-Run Distribution Matrix

| Run | Persona | Journey | Fleet | Network | Screen | A11Y | Account | Tier | Error |
|-----|---------|---------|-------|---------|--------|------|---------|------|-------|
| 001 | Alex | J01 | F0 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 002 | Alex | J01 | F0 | NET-SLOW | SCR-MOB | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-AUTH |
| 003 | Alex | J01 | F0 | NET-AVG | SCR-LAP | A11Y-ON | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 004 | Jamie | J02 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 005 | Jamie | J02 | F1 | NET-AVG | SCR-TAB | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-API |
| 006 | Jamie | J04 | F2 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 007 | Jamie | J08 | F2 | NET-SLOW | SCR-MOB | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 008 | Sam | J04 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 009 | Sam | J06 | F5 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 010 | Sam | J03 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-DB |
| 011 | Riley | J03 | F15 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 012 | Riley | J04 | F15 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 013 | Riley | J03 | F15 | NET-AVG | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-API |
| 014 | Riley | J05 | F15 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 015 | Morgan | J01 | F0 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 016 | Morgan | J05 | F1 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 017 | Morgan | J06 | F5 | NET-AVG | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 018 | Morgan | J05 | F1 | NET-SLOW | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-API |
| 019 | Jordan | J09 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 020 | Jordan | J09 | F5 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 021 | Jordan | J04 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 022 | Jordan | J06 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-DB |
| 023 | Taylor | J04 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 024 | Taylor | J04 | F5 | NET-AVG | SCR-MOB | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 025 | Taylor | J06 | F2 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 026 | Taylor | J05 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-API |
| 027 | Casey | J01 | F0 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 028 | Casey | J08 | F1 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 029 | Casey | J02 | F1 | NET-AVG | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 030 | Casey | J03 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-INV | ERR-NONE |
| 031 | Devon | J01 | F0 | NET-FAST | SCR-DESK | A11Y-ON | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 032 | Devon | J04 | F2 | NET-FAST | SCR-LAP | A11Y-ON | ACCT-EST | TIER-GROW | ERR-NONE |
| 033 | Devon | J02 | F1 | NET-AVG | SCR-DESK | A11Y-ON | ACCT-EST | TIER-GROW | ERR-NONE |
| 034 | Devon | J06 | F2 | NET-FAST | SCR-DESK | A11Y-ON | ACCT-EST | TIER-GROW | ERR-NONE |
| 035 | Robin | J10 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 036 | Robin | J07 | F2 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 037 | Robin | J10 | F1 | NET-FAST | SCR-MOB | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-API |
| 038 | Robin | J09 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 039 | Alex | J05 | F1 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 040 | Alex | J04 | F1 | NET-AVG | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 041 | Riley | J04 | F15 | NET-SLOW | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 042 | Riley | J06 | F15 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 043 | Riley | J07 | F15 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 044 | Sam | J04 | F5 | NET-SLOW | SCR-TAB | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 045 | Sam | J08 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 046 | Sam | J07 | F5 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 047 | Morgan | J04 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 048 | Morgan | J01 | F0 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-API |
| 049 | Jordan | J08 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 050 | Jordan | J05 | F1 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 051 | Riley | J08 | F15 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 052 | Sam | J09 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 053 | Alex | J02 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 054 | Alex | J08 | F1 | NET-SLOW | SCR-MOB | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 055 | Jamie | J06 | F2 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-DB |
| 056 | Jamie | J05 | F2 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 057 | Casey | J04 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-INV | ERR-NONE |
| 058 | Casey | J09 | F1 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 059 | Devon | J08 | F2 | NET-FAST | SCR-DESK | A11Y-ON | ACCT-EST | TIER-GROW | ERR-NONE |
| 060 | Devon | J03 | F2 | NET-AVG | SCR-LAP | A11Y-ON | ACCT-EST | TIER-GROW | ERR-NONE |
| 061 | Robin | J07 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 062 | Robin | J08 | F1 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 063 | Riley | J10 | F15 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 064 | Riley | J09 | F15 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 065 | Sam | J10 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 066 | Sam | J03 | F5 | NET-AVG | SCR-TAB | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 067 | Taylor | J01 | F0 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 068 | Taylor | J07 | F2 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 069 | Taylor | J09 | F1 | NET-AVG | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-DB |
| 070 | Casey | J07 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-INV | ERR-NONE |
| 071 | Casey | J10 | F1 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 072 | Alex | J07 | F2 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 073 | Alex | J09 | F1 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-DB |
| 074 | Jamie | J03 | F2 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 075 | Jamie | J07 | F2 | NET-SLOW | SCR-TAB | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 076 | Morgan | J09 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 077 | Morgan | J08 | F1 | NET-AVG | SCR-MOB | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 078 | Jordan | J01 | F0 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-NEW | TIER-GROW | ERR-NONE |
| 079 | Jordan | J10 | F1 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-AUTH |
| 080 | Devon | J09 | F2 | NET-FAST | SCR-DESK | A11Y-ON | ACCT-EST | TIER-GROW | ERR-NONE |
| 081 | Devon | J10 | F2 | NET-AVG | SCR-LAP | A11Y-ON | ACCT-AGED | TIER-GROW | ERR-NONE |
| 082 | Devon | J05 | F2 | NET-FAST | SCR-DESK | A11Y-ON | ACCT-EST | TIER-GROW | ERR-API |
| 083 | Robin | J09 | F1 | NET-SLOW | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 084 | Robin | J10 | F2 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-AUTH |
| 085 | Riley | J03 | F15 | NET-FAST | SCR-DESK | A11Y-ON | ACCT-AGED | TIER-INV | ERR-NONE |
| 086 | Riley | J05 | F15 | NET-AVG | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-DB |
| 087 | Sam | J02 | F5 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 088 | Sam | J05 | F5 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-API |
| 089 | Alex | J10 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-SOLO | ERR-NONE |
| 090 | Alex | J06 | F2 | NET-SLOW | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 091 | Jamie | J01 | F0 | NET-FAST | SCR-TAB | A11Y-OFF | ACCT-NEW | TIER-SOLO | ERR-NONE |
| 092 | Jamie | J09 | F2 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-NONE |
| 093 | Casey | J06 | F5 | NET-AVG | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-INV | ERR-NONE |
| 094 | Casey | J05 | F2 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-EST | TIER-GROW | ERR-AUTH |
| 095 | Taylor | J03 | F15 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-NONE |
| 096 | Taylor | J08 | F2 | NET-AVG | SCR-TAB | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 097 | Jordan | J03 | F5 | NET-FAST | SCR-LAP | A11Y-OFF | ACCT-AGED | TIER-INV | ERR-API |
| 098 | Jordan | J07 | F2 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-GROW | ERR-NONE |
| 099 | Morgan | J10 | F1 | NET-FAST | SCR-DESK | A11Y-OFF | ACCT-AGED | TIER-SOLO | ERR-NONE |
| 100 | Morgan | J03 | F5 | NET-SLOW | SCR-DESK | A11Y-OFF | ACCT-EST | TIER-INV | ERR-DB |

---

## Coverage Verification

### Persona Distribution (target: 8-12 each)

| Persona | Runs |
|---------|------|
| Alex | 10 (001-003, 039-040, 053-054, 072-073, 089-090) |
| Jamie | 10 (004-007, 055-056, 074-075, 091-092) |
| Sam | 10 (008-010, 044-046, 052, 065-066, 087-088) |
| Riley | 10 (011-014, 041-043, 051, 063-064, 085-086) |
| Morgan | 10 (015-018, 047-048, 076-077, 099-100) |
| Jordan | 10 (019-022, 049-050, 078-079, 097-098) |
| Taylor | 10 (023-026, 067-069, 095-096) |
| Casey | 10 (027-030, 057-058, 070-071, 093-094) |
| Devon | 10 (031-034, 059-060, 080-082) |
| Robin | 10 (035-038, 061-062, 083-084) |

### Journey Distribution (target: 8-12 each)

| Journey | Runs |
|---------|------|
| J01 — Landing to first SCP | 10 (001-003, 015, 027, 031, 048, 067, 078, 091) |
| J02 — Adding second company | 8 (004-005, 029, 033, 053, 074, 087) |
| J03 — Scaling to 15 | 10 (010-011, 013, 030, 060, 066, 085, 095, 097, 100) |
| J04 — Daily triage | 12 (006, 008, 012, 021, 023-024, 032, 040-041, 044, 047, 057) |
| J05 — Remediation PR review | 10 (014, 016, 018, 026, 039, 050, 056, 082, 086, 088, 094) |
| J06 — Cross-company intelligence | 10 (009, 017, 022, 025, 034, 042, 055, 090, 093) |
| J07 — Company retirement | 8 (036, 043, 046, 061, 068, 070, 072, 075, 098) |
| J08 — Settings + billing | 10 (007, 028, 045, 049, 051, 054, 059, 062, 077, 096) |
| J09 — Compliance export | 10 (019-020, 038, 052, 058, 064, 069, 073, 076, 080, 083, 092) |
| J10 — Full org deletion | 10 (035, 037, 063, 065, 071, 079, 081, 084, 089, 099) |

### Fleet-Size Distribution (target: F0=10%, F1=20%, F2=20%, F5=25%, F15=25%)

| Fleet | Runs | Pct |
|-------|------|-----|
| F0 | 10 | 10% |
| F1 | 20 | 20% |
| F2 | 20 | 20% |
| F5 | 25 | 25% |
| F15 | 25 | 25% |

### Error Injection Distribution (target: 30% with errors)

| Error | Runs |
|-------|------|
| ERR-NONE | 70 |
| ERR-API | 10 (005, 013, 018, 037, 048, 082, 088, 094, 097) |
| ERR-DB | 8 (010, 022, 055, 069, 073, 086, 100) |
| ERR-AUTH | 5 (002, 079, 084) |
| **Total error runs** | **30 (30%)** |

### Accessibility Mode Distribution (target: 15%)

| A11Y | Runs |
|------|------|
| A11Y-ON | 15 (003, 031-034, 059-060, 080-082, 085) |
| A11Y-OFF | 85 |

### Screen Size Distribution

| Screen | Runs |
|--------|------|
| SCR-DESK | 48 |
| SCR-LAP | 31 |
| SCR-TAB | 8 |
| SCR-MOB | 7 |

### Tier Distribution

| Tier | Runs |
|------|------|
| TIER-SOLO | 22 |
| TIER-GROW | 40 |
| TIER-INV | 38 |

---

## Weighting Rationale

1. **Fleet-size overweight (F5 + F15 = 50%):** The v5 directive positions Foundry as a multi-company control plane. Most existing users are at F1. The greatest risk of defects and UX failure is at fleet scale.

2. **Error injection at 30%:** External dependency failures (Anthropic, GitHub, Stripe, Turso, Clerk) have zero retry/circuit-breaker coverage per the orientation audit. Error runs will expose whether users see helpful error states or blank screens.

3. **Accessibility at 15%:** Devon is the primary accessibility persona, but accessibility defects affect all users (keyboard navigation, focus management, semantic HTML). Non-Devon personas with A11Y-ON runs catch structural issues.

4. **Desktop-heavy screen distribution:** Foundry is a daily operational tool, not a consumer app. Founders primarily use it on desktop/laptop. Mobile runs (7%) test the iOS app critical path and responsive degradation.

5. **Tier balance toward Growth + Investor-Ready:** Multi-company journeys require Growth or Investor-Ready. The matrix ensures tier-gating is tested (Solo users attempting multi-company) while focusing run budget on the tiers where fleet features are available.
