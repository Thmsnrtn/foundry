# Persona 09 — Devon

## Identity

- **Role:** Accessibility-dependent founder, screen reader + keyboard user
- **Background:** Blind since birth. Runs three profitable micro-SaaS products, all built with accessibility-first architecture. Expert-level screen reader user (NVDA on Windows, VoiceOver on Mac/iOS). Navigates entirely via keyboard and expects every interactive element to have proper ARIA roles, labels, and focus management. Has filed accessibility complaints against two other SaaS tools in the past year.
- **Current situation:** Devon signed up for Foundry after hearing about it on a podcast. The initial experience was promising — server-rendered HTML is generally more accessible than SPA frameworks — but Devon is encountering unlabeled buttons, focus traps in modals, and agent score visualizations that convey information solely through color.

## Profile

| Attribute | Value |
|-----------|-------|
| Technical comfort | 8/10 |
| Fleet size | 3 companies |
| Trust in autonomy | High — delegates willingly if the interface is navigable |
| Subscription tier | Growth ($199) |

## Abandonment Triggers

1. Icon-only buttons without `aria-label` — screen reader announces "button" with no context.
2. Agent health scores or risk states communicated only through color (red/yellow/green) without text equivalents.
3. Modal dialogs that trap focus or lack Escape-to-close behavior.

## Voice

> "If I can't tab to it and hear what it does, it doesn't exist to me."

> "The agent health chart is probably beautiful. I'll never know. Give me the numbers in a table."

> "I run three companies profitably without seeing a pixel. Don't make your UI the thing that slows me down."
