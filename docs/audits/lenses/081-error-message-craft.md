# Lens 081 — Error Message Craft

**Distinct value:** Evaluates every error message in the application for actionability, human readability, and helpfulness. Are errors useful to founders, or are they raw technical messages, generic "something went wrong" text, or exposed stack traces?

**Tenancy-critical:** No. Error messages are per-user, but poorly crafted errors during critical flows (onboarding, billing) could cause founder churn.

## Executive Summary

Foundry's error messages fall into three categories: (1) inline script catch blocks that show "Something went wrong." with no detail, (2) JSON error responses that expose to the browser (e.g., `{ "error": "Not found" }`), and (3) a few well-crafted error messages in the onboarding flow. The AI reflection feature has the best error handling: "Unable to generate clarity right now. Trust what you know." — this is human, actionable, and maintains the product's voice. The worst errors are the JSON responses that appear when form validation fails in the browser, and the silent failures where no error message appears at all. There are no error pages (404, 500) with branded design or recovery guidance.

## Findings

### EM-01 "Something went wrong." Used Everywhere
- **Severity:** P2
- **Description:** Five different `catch` blocks across inline scripts show the identical text "Something went wrong." or "Something went wrong. Try again." This provides zero diagnostic value to the user. They cannot distinguish between: a network error, a server error, a timeout, an auth expiry, or a validation failure. All produce the same unhelpful message.
- **Evidence:** `src/routes/dashboard/decisions.ts:209,229,261` — three identical "Something went wrong." messages. `src/routes/dashboard/index.ts:300-301` — "Something went wrong. Try again." `src/routes/dashboard/onboarding-chat.ts:202-203` — "Something went wrong. Please try again."
- **Remediation:** Differentiate by error type: network error ("Unable to reach the server. Check your connection."), 401 ("Your session expired. Please log in again."), 429 ("Too many requests. Wait a moment and try again."), 500 ("Server error. This has been logged and we're looking into it."), timeout ("The request is taking too long. Try again.").
- **Target Phase:** 2

### EM-02 AI Reflection Error Is Excellent
- **Severity:** (Positive Finding)
- **Description:** When the AI reflection (decision clarity) call fails, the error message is: "Unable to generate clarity right now. Trust what you know." This is: human-readable, contextually appropriate, actionable (proceed without AI input), and maintains the product's authoritative voice. This is the best error message in the product.
- **Evidence:** `src/routes/dashboard/decisions.ts:413` — `return c.json({ clarity: 'Unable to generate clarity right now. Trust what you know.' })`.
- **Remediation:** N/A — use this as the model for all error messages. Every error should maintain the product's voice and provide a next action.
- **Target Phase:** N/A

### EM-03 JSON Error Responses Shown to Users
- **Severity:** P1
- **Description:** When validation fails or resources are not found, several routes return `c.json({ error: '...' }, status)`. For routes that serve HTML (all dashboard routes), this means the user sees raw JSON in their browser: `{"error":"Not found"}` or `{"error":"Missing code"}`. This is a fundamentally broken UX for a server-rendered application.
- **Evidence:** `src/routes/dashboard/decisions.ts:57` — `return c.json({ error: 'Not found' }, 404)` from a page route. `src/routes/dashboard/onboarding.ts:169` — `return c.json({ error: 'Missing code' }, 400)`. `src/routes/dashboard/onboarding.ts:177` — `return c.json({ error: 'Invalid or expired OAuth state' }, 400)`.
- **Remediation:** For HTML page routes, return rendered error pages: `return c.html(dashboardLayout(ctx, errorPage('Not Found', 'This decision could not be found.')))`. For API routes, JSON is correct.
- **Target Phase:** 1

### EM-04 No Custom 404 Page
- **Severity:** P2
- **Description:** There is no custom 404 page. When a user hits a non-existent route, they see Hono's default "404 Not Found" text response. There is no branded error page, no "back to dashboard" link, and no search/navigation to help them find what they were looking for.
- **Evidence:** No custom 404 handler found in route configuration. Hono returns plain text by default.
- **Remediation:** Add a catch-all route at the end of the route chain: `app.notFound((c) => c.html(publicLayout('Not Found', html\`<div class="empty-state"><h1>404</h1><p>Page not found.</p><a href="/dashboard" class="btn btn-primary">Back to dashboard</a></div>\`)))`.
- **Target Phase:** 2

### EM-05 No Custom 500 Error Page
- **Severity:** P2
- **Description:** There is no global error handler that renders a user-friendly 500 page. If a route handler throws an unhandled exception, the user sees a Hono default error response or a blank page. For a product handling business decisions, an unhandled error during a decision resolution could leave the founder uncertain about whether their action was recorded.
- **Evidence:** No `app.onError()` handler found in the index.ts route configuration.
- **Remediation:** Add: `app.onError((err, c) => { console.error(err); return c.html(publicLayout('Error', html\`...\`), 500); })` with a message: "Something went wrong on our end. Your data is safe. Try refreshing, or contact support if this persists."
- **Target Phase:** 2

### EM-06 Onboarding Errors Are Bare Technical Messages
- **Severity:** P2
- **Description:** The onboarding flow returns technical error messages: "Missing code" (GitHub OAuth callback without code parameter), "GitHub auth failed" (token exchange failure), "Invalid or expired OAuth state" (CSRF check failure). These are accurate but not helpful to a founder who is connecting their product for the first time. They need guidance on what to do.
- **Evidence:** `src/routes/dashboard/onboarding.ts:169,177,191` — technical error messages during the most critical user flow.
- **Remediation:** "Missing code" becomes "GitHub authorization was not completed. Please try connecting again." with a retry button. "GitHub auth failed" becomes "We couldn't connect to GitHub. Please try again. If this persists, check that your browser allows pop-ups." "Invalid or expired OAuth state" becomes "Your connection request expired. Please start the connection process again." + redirect back to step 1.
- **Target Phase:** 2

### EM-07 Billing Checkout Error Is Silently Ignored
- **Severity:** P2
- **Description:** When checkout fails, the settings route redirects to `/settings?checkout=error`. But the settings page never checks for `checkout=error` in the query params — the user is silently redirected to settings with no error message. The success case (`checkout=success`) is also not handled with a confirmation message.
- **Evidence:** `src/routes/dashboard/settings.ts:41` — `return c.redirect('/settings?checkout=error')`. No code reads `checkout=error` to display a message.
- **Remediation:** Add query param handling: `const checkoutStatus = c.req.query('checkout'); if (checkoutStatus === 'error') showErrorBanner("Checkout could not be completed. No charge was made. Please try again."); if (checkoutStatus === 'success') showSuccessBanner("Welcome! Your plan is now active.")`.
- **Target Phase:** 2

## Embarrassment Test
1. A founder during onboarding sees `{"error":"Invalid or expired OAuth state"}` as raw JSON in their browser when their GitHub connection times out.
2. A checkout failure redirects to the settings page with no message — the founder has no idea the payment failed.

## Recommendations (Priority Order)
1. Replace JSON error responses with rendered HTML error pages (P1, Phase 1)
2. Add custom 404 and 500 error pages (P2, Phase 2)
3. Differentiate error messages by type instead of generic "something went wrong" (P2, Phase 2)
4. Humanize onboarding error messages with retry guidance (P2, Phase 2)
5. Handle checkout success/error query params in settings page (P2, Phase 2)
6. Use AI reflection error message style as the model for all errors
