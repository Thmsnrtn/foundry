from pathlib import Path

css = Path('src/public/owner.css')
source = css.read_text()

# The no-overflow contract deliberately allows only a tiny reviewed whitelist of
# nowrap selectors. Navigation does not need nowrap: the handoff's labels are
# short and the narrower phone composition changes the number of visible doors.
source = source.replace(
    'nav.places a{min-height:49px;padding:3px 1px;gap:2px;font-size:.51rem;line-height:1.05;white-space:nowrap;color:var(--ink-3)}',
    'nav.places a{min-height:49px;padding:3px 1px;gap:2px;font-size:.51rem;line-height:1.05;color:var(--ink-3)}',
)

marker = 'PRIVATE FOUNDRY UI HANDOFF V3 — NORTH STAR REFINEMENTS'
if marker not in source:
    source += r'''

/* =============================================================================
   PRIVATE FOUNDRY UI HANDOFF V3 — NORTH STAR REFINEMENTS
   Responsive corrections found by the existing owner-surface invariants.
   ============================================================================= */
.ask-door{color:inherit}

/* On the smallest phones the handoff resolves to the five high-frequency owner
   destinations: Home, Portfolio, Experiments, Inbox, Ask. The full institutional
   map returns as soon as width permits and is always present in the desktop rail. */
@media (max-width:410px){
  nav.places div{grid-template-columns:repeat(5,minmax(0,1fr))}
  nav.places a:nth-of-type(2),
  nav.places a:nth-of-type(4),
  nav.places a:nth-of-type(7),
  nav.places a:nth-of-type(8),
  nav.places a:nth-of-type(9){display:none}
  nav.places a:nth-of-type(6){display:flex}
  nav.places a{font-size:.62rem}
  nav.places a svg{width:20px;height:20px}
}
'''

css.write_text(source)
print('Refined Private Foundry UI handoff v3 responsive invariants')
