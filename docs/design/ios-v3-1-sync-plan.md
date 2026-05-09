# iOS V3.1 Sync — Plan

> Wave 4, action 28. Council 12 (iOS engineers). The 300-persona
> review flagged the iOS app shipped pre-V3.1; the new disciplines
> (briefing visual contract, weekly outcome metric, North Star,
> voice gate) haven't been ported. A founder reading the briefing
> on iOS gets a different shape than on the web.

> Status: plan. Implementation requires Swift / SwiftUI work in
> `ios/` which is outside the scope of this autonomous cycle.

---

## 1. The five gaps

| # | Gap | Impact | Fix size |
|---|-----|--------|---------|
| 1 | Briefing visual contract not reflected in iOS rendering | Inconsistent UX between web and iOS | Medium (Swift markdown rendering) |
| 2 | Voice briefings ignore the new hierarchy | Audio reads everything, not the headline+metric+decision | Small (audio script generator) |
| 3 | Push notifications fire on digest_time, not briefing-write event | Founder gets a push before the briefing exists | Small (event source change) |
| 4 | North Star / weekly outcome / peer signal not surfaced | Disciplines invisible on the highest-engagement surface | Medium (3 new SwiftUI views) |
| 5 | Voice fingerprint isn't pre-checked on iOS-drafted artifacts | Brand voice can leak through iOS-only flows | Medium (call gateway from iOS) |

## 2. Three implementation paths

### Path A — Native port (highest fidelity, highest cost)

Port each new V3.1 view to native SwiftUI. The briefing visual
contract becomes a native layout; the weekly outcome card a
SwiftUI `VStack`; the peer signal card its own `View`.

**Cost**: 2 operator-weeks (most of which is iOS-side work).
**Wins**: native feel, performant, accessible by default.
**Loses**: changes to web require parallel changes to iOS.

### Path B — WKWebView render with shared CSS (lowest cost)

The web briefing already renders the visual contract. Embed the
same HTML in a WKWebView, share the CSS, let the iOS app become a
thin shell over the web.

**Cost**: 2 operator-days (one to wire WKWebView, one to test
auth/cookie passing).
**Wins**: web changes ship to iOS for free.
**Loses**: native feel suffers; offline mode harder.

### Path C — Document the divergence (zero cost, alpha-friendly)

Acknowledge that web and iOS show different briefing shapes during
alpha; tell alpha founders explicitly. iOS continues to render
its current shape; the gap is closed when alpha validates the
wedge.

**Cost**: 30 minutes (a paragraph in the iOS app's About screen).
**Wins**: zero engineering risk to alpha.
**Loses**: founders who use both surfaces notice the inconsistency.

## 3. Recommendation

**Path C for alpha. Path B for the first month after alpha.
Path A only when the team grows enough to have ongoing iOS
attention.**

Reasoning:

- Path A's 2-week cost outweighs the alpha-risk benefit at this
  stage. The web is the primary surface; iOS is the secondary
  surface for most alpha founders.
- Path B's 2-day cost is reasonable post-alpha, when web changes
  are settling. WKWebView is a 90% solution.
- Path A pays back when iOS becomes a primary surface (mobile-only
  founders) or when offline / push-first workflows matter.

## 4. The three things alpha founders need to know about iOS

1. **The briefing on iOS is the older shape.** New visual contract
   is web-only for now. Apologize in the welcome email.
2. **Push notifications still fire on digest_time, not on briefing-
   write.** A push at 7am may be a moment before the briefing has
   actually generated; refreshing the dashboard a minute later
   shows the new briefing.
3. **Voice gate doesn't yet apply to iOS-drafted artifacts.** If
   alpha founders draft customer-reaching content on iOS, the
   voice gate doesn't review it until the artifact lands on the
   web side. (This is rare in practice; most drafting is web.)

This list ships in the alpha welcome email's day-0 template
(Wave 2, action 15). Update `src/services/founder/welcome-sequence.ts`
templateDay0 when iOS Path B ships and these caveats become
obsolete.

## 5. The Path B implementation sketch

When ready to ship:

1. Add a `WKWebView` to the briefing screen pointed at
   `https://foundry.app/dashboard?embedded=ios`.
2. Add an `?embedded=ios` query param recognition in the
   dashboard route — strips the nav header, expands the briefing
   card to fill, hides settings/account links the iOS app handles
   natively.
3. Use a session-cookie-passing shim (the iOS app already auths
   via Clerk; the cookie can be passed to the WKWebView).
4. Test: native `Approve` button in the briefing card fires HTMX
   POST that the web app handles; on success, web returns the
   updated briefing HTML; WKWebView swaps the DOM. Same flow as
   desktop.

**Total code**: ~150 lines of Swift + a 5-line route param check
on the web. Two operator-days.

## 6. What this is not

- Not an iOS feature roadmap. Voice briefings, watch complications,
  push categories — those evolve on their own arc.
- Not a permanent answer. Path C → Path B → Path A is the natural
  arc; this document just names where on that arc to be.

— end —
