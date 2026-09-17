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

# Door membership is contextual in V3, not positional. The hashed owner script
# knows whether the owner is at Home, a core leaf, a secondary place, or Ask;
# CSS cannot know that, and nth-child rules silently break whenever the canonical
# door order changes. Keep only the small-screen sizing fallback here. The script
# supplies the five/six/nine-column composition after it reads page state.
legacy_small_phone = r'''/* 375–390px-class phones keep the North Star's core five destinations under
   the thumb, while the full owner map remains available through the page/menu
   and appears directly on wider phones. */
@media (max-width:410px){
  nav.places div{grid-template-columns:repeat(5,minmax(0,1fr))}
  nav.places a:nth-of-type(2),
  nav.places a:nth-of-type(6),
  nav.places a:nth-of-type(7),
  nav.places a:nth-of-type(8){display:none}
  nav.places a{font-size:.62rem}
  nav.places a svg{width:20px;height:20px}
}
'''
small_phone_fallback = r'''/* Membership of the mobile doors is page-aware and is applied by the hashed
   owner script. CSS only supplies compact sizing before that script runs. */
@media (max-width:410px){
  nav.places a{font-size:.62rem}
  nav.places a svg{width:20px;height:20px}
}
'''
source = source.replace(legacy_small_phone, small_phone_fallback)

old_refinement = r'''/* =============================================================================
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
clean_refinement = r'''/* =============================================================================
   PRIVATE FOUNDRY UI HANDOFF V3 — NORTH STAR REFINEMENTS
   Responsive corrections found by the existing owner-surface invariants.
   ============================================================================= */
.ask-door{color:inherit}

/* Mobile door membership is intentionally absent here. The owner script derives
   it from page context, preserving the handoff's five/six/nine-door compositions
   without coupling navigation meaning to DOM position. */
'''
source = source.replace(old_refinement, clean_refinement)

marker = 'PRIVATE FOUNDRY UI HANDOFF V3 — NORTH STAR REFINEMENTS'
if marker not in source:
    source += '\n\n' + clean_refinement

css.write_text(source)
print('Refined Private Foundry UI handoff v3 responsive invariants')
