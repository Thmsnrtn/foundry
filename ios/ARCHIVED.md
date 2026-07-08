# ⚠️ ARCHIVED — not a shipping target

This directory contains ~3.6k lines of SwiftUI source **but no Xcode project**
(`.xcodeproj` / `.xcworkspace`), no API configuration, and no TestFlight setup.
It is **not buildable and not installable** as-is.

Status decision (Phase 5.4): **archived, not on the roadmap.** Mobile is served
today by the PWA + mobile bottom nav, which is real and marketed as the
"installable mobile app." The pricing page no longer claims a native iOS app,
voice briefings, or a Watch complication (Phase 1.7).

## If iOS is revived later

Reviving this is roughly a two-week effort:

1. Create an Xcode project and target; wire these sources into it.
2. Add API base-URL / auth configuration (the app currently has no backend
   config).
3. Set up signing + a TestFlight build.
4. Re-add any marketing claims to the pricing page **only after** a build ships.

Until someone commits to that, treat everything under `ios/Foundry/` as a
reference prototype, not production code. Do not wire it into CI or deploys.
