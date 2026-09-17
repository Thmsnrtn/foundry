from pathlib import Path


def replace_once(path: Path, old: str, new: str, label: str) -> None:
    source = path.read_text()
    if new in source:
        return
    if old not in source:
        raise SystemExit(f"{label}: source fragment not found in {path}")
    path.write_text(source.replace(old, new, 1))


# -----------------------------------------------------------------------------
# OWNER SHELL — the handoff is the visual North Star.
# Institutional state/authority remains untouched; only presentation/geography
# changes here.
# -----------------------------------------------------------------------------
shell = Path("src/views/owner/shell.ts")
s = shell.read_text()

s = s.replace(
    "export type Place = 'foundry' | 'decisions' | 'companies' | 'experiments' | 'inbox' | 'controls'\n  | 'advanced';",
    "export type Place = 'foundry' | 'decisions' | 'companies' | 'discover' | 'experiments' | 'inbox'\n  | 'activity' | 'money' | 'controls' | 'advanced';",
)

s = s.replace(
    '''return html`${object}<section class="more" aria-label="Also here">\n    <a href="/foundry/searching"${where?.scope.kind === 'searching' ? raw(' class="on"') : ''}>Discover</a>\n    <a href="/foundry/public-workshop">Workshop</a>\n    <a href="/foundry/money">Money</a>\n    <a href="/foundry/roadmap">Roadmap</a>\n  </section>`;''',
    '''return html`${object}<section class="more" aria-label="Also here">\n    <a href="/foundry/public-workshop">Workshop</a>\n    <a href="/foundry/roadmap">Roadmap</a>\n    <a href="/foundry/absence">Absence test</a>\n  </section>`;''',
)

s = s.replace(
    "  portfolio: '<svg viewBox=\"0 0 24 24\"><path d=\"M3 17c3-4 6 0 9-3s6 1 9-3\"/><path d=\"M3 12c3-4 6 0 9-3s6 1 9-3\"/></svg>',\n};",
    "  portfolio: '<svg viewBox=\"0 0 24 24\"><path d=\"M3 17c3-4 6 0 9-3s6 1 9-3\"/><path d=\"M3 12c3-4 6 0 9-3s6 1 9-3\"/></svg>',\n  discover: '<svg viewBox=\"0 0 24 24\"><circle cx=\"11\" cy=\"11\" r=\"6.5\"/><path d=\"m16 16 4 4M11 8v6M8 11h6\"/></svg>',\n  activity: '<svg viewBox=\"0 0 24 24\"><circle cx=\"12\" cy=\"12\" r=\"8\"/><path d=\"M12 7v5l3 2\"/></svg>',\n  money: '<svg viewBox=\"0 0 24 24\"><rect x=\"4\" y=\"6\" width=\"16\" height=\"12\" rx=\"2\"/><path d=\"M8 10h8M8 14h5\"/></svg>',\n  ask: '<svg viewBox=\"0 0 24 24\"><path d=\"M5 5h14v11H9l-4 3z\"/><path d=\"M9 9h6M9 12h4\"/></svg>',\n};",
)

s = s.replace(
    '<div class="brand"><b>F</b> Private Foundry</div>',
    '''<div class="brand"><span class="forge-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3v26M7 10c5 0 9 6 9 6s-4 6-9 6c0-6 4-12 9-12Zm18 0c-5 0-9 6-9 6s4 6 9 6c0-6-4-12-9-12Z"/></svg></span><span class="brand-copy"><b>Foundry</b><small>Private Lab for Digital Income Streams</small></span></div>''',
)

s = s.replace('<form class="ask" method="GET" action="/foundry">',
              '<form class="ask" id="ask-foundry" method="GET" action="/foundry">')

old_nav = '''<nav class="places${where && where.scope.kind === 'company' && where.local.length ? ' behind' : ''}" aria-label="Places"><div>\n  ${door('/foundry', 'foundry', 'Home', ICONS.home, active, counts)}\n  ${door('/foundry/decisions', 'decisions', 'Decisions', ICONS.decisions, active, counts)}\n  ${door('/foundry/experiments', 'experiments', 'Experiments', ICONS.experiments, active, counts)}\n  ${door('/foundry/inbox', 'inbox', 'Inbox', ICONS.inbox, active, counts)}\n  ${door('/foundry/controls', 'controls', 'Controls', ICONS.controls, active, counts)}\n  ${door('/foundry/companies', 'companies', 'Portfolio', ICONS.portfolio, active, counts, true)}\n  ${railExtra(where)}\n</div></nav>'''
new_nav = '''<nav class="places${where && where.scope.kind === 'company' && where.local.length ? ' behind' : ''}" aria-label="Places"><div>\n  <header class="rail-brand"><span class="forge-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3v26M7 10c5 0 9 6 9 6s-4 6-9 6c0-6 4-12 9-12Zm18 0c-5 0-9 6-9 6s4 6 9 6c0-6-4-12-9-12Z"/></svg></span><span><b>Foundry</b><small>Private Lab for Digital Income Streams</small></span></header>\n  ${door('/foundry', 'foundry', 'Home', ICONS.home, active, counts)}\n  ${door('/foundry/decisions', 'decisions', 'Decisions', ICONS.decisions, active, counts)}\n  ${door('/foundry/companies', 'companies', 'Portfolio', ICONS.portfolio, active, counts)}\n  ${door('/foundry/searching', 'discover', 'Discover', ICONS.discover, where?.scope.kind === 'searching' ? 'discover' : active, counts, true)}\n  ${door('/foundry/experiments', 'experiments', 'Experiments', ICONS.experiments, active, counts)}\n  ${door('/foundry/inbox', 'inbox', 'Inbox', ICONS.inbox, active, counts)}\n  ${door('/foundry/activity', 'activity', 'Activity', ICONS.activity, active, counts)}\n  ${door('/foundry/money', 'money', 'Economics', ICONS.money, active, counts)}\n  ${door('/foundry/controls', 'controls', 'Controls', ICONS.controls, active, counts)}\n  <a class="ask-door" href="/foundry#ask-foundry">${raw(ICONS.ask)}Ask</a>\n  ${railExtra(where)}\n</div></nav>'''
if new_nav not in s:
    if old_nav not in s:
        raise SystemExit("owner shell navigation fragment not found")
    s = s.replace(old_nav, new_nav, 1)

shell.write_text(s)


# -----------------------------------------------------------------------------
# Route-level visual semantics. These do not touch business meaning or writers.
# -----------------------------------------------------------------------------
activity = Path("src/routes/dashboard/activity-place.ts")
a = activity.read_text().replace(
    "return c.html(page('Activity', body, 'foundry', frame));",
    "return c.html(page('Activity', body, 'activity', frame));",
)
activity.write_text(a)

money = Path("src/routes/dashboard/money-place.ts")
m = money.read_text().replace(
    "return c.html(page('Money', body, 'foundry', frame));",
    "return c.html(page('Money', body, 'money', frame));",
)
money.write_text(m)

absence = Path("src/routes/dashboard/absence-place.ts")
x = absence.read_text()
x = x.replace('return html`<div class="know">\n    <h2>${String(r.days)} days',
              'return html`<div class="know horizon horizon-${String(r.days)}">\n    <h2>${String(r.days)} days')
x = x.replace('    ${readings.map(horizon)}\n\n    <div class="know">\n      <h2>What thinking costs</h2>',
              '    <div class="absence-horizons">${readings.map(horizon)}</div>\n\n    <div class="know cognition-economics">\n      <h2>What thinking costs</h2>')
absence.write_text(x)

roadmap = Path("src/routes/dashboard/roadmap-place.ts")
r = roadmap.read_text()
r = r.replace('${open.length === 0 ? \'\' : html`<div class="know">\n      <h2>Under way</h2>',
              '${open.length === 0 ? \'\' : html`<div class="know roadmap-open">\n      <h2>Under way</h2>')
r = r.replace('${closed.length === 0 ? \'\' : html`<div class="know">\n      <h2>Finished, and what came of it</h2>',
              '${closed.length === 0 ? \'\' : html`<div class="know roadmap-closed">\n      <h2>Finished, and what came of it</h2>')
r = r.replace('    <div class="know">\n      <h2>Why you cannot add to this</h2>',
              '    <div class="know roadmap-note">\n      <h2>Why you cannot add to this</h2>')
roadmap.write_text(r)

experiments = Path("src/routes/dashboard/experiments-place.ts")
e = experiments.read_text()
e = e.replace('html`<a class="item" href="/foundry/experiments/${v.id}">',
              'html`<a class="item experiment-index-item" href="/foundry/experiments/${v.id}">', 1)
experiments.write_text(e)


# -----------------------------------------------------------------------------
# One canonical stylesheet. The handoff wins on hierarchy, density, visual
# character and responsive composition. No invented business facts are added.
# -----------------------------------------------------------------------------
css = Path("src/public/owner.css")
source = css.read_text()
marker = "PRIVATE FOUNDRY UI HANDOFF V3 — NORTH STAR CUTOVER"
if marker not in source:
    source += r'''

/* =============================================================================
   PRIVATE FOUNDRY UI HANDOFF V3 — NORTH STAR CUTOVER
   Visual source of truth: the supplied Foundry handoff. Existing institutional
   state remains authoritative for facts; the handoff is authoritative for the
   owner-facing composition, hierarchy, density and character.
   ============================================================================= */

:root{
  --v3-bg:#07100d;
  --v3-rail:#08120f;
  --v3-panel:#0b1713;
  --v3-panel-2:#0e1c17;
  --v3-line:rgba(151,210,184,.16);
  --v3-line-strong:rgba(151,210,184,.28);
  --v3-mint:#66e5b4;
  --v3-mint-soft:rgba(102,229,180,.11);
  --v3-gold:#e0b45e;
  --v3-gold-soft:rgba(224,180,94,.10);
  --v3-red:#ec766c;
  --v3-radius:10px;
  --v3-rail-w:15.6rem;
  --v3-shadow:0 14px 38px rgba(0,0,0,.22);
}

body{
  background:
    radial-gradient(ellipse at 70% -8%,rgba(190,147,72,.10),transparent 30rem),
    radial-gradient(ellipse at 58% 0%,rgba(52,113,88,.13),transparent 46rem),
    linear-gradient(180deg,#0a1512 0,#07100d 34rem,#050a08 100%);
  background-color:var(--v3-bg);
}

body::before{
  content:"";position:fixed;z-index:-1;inset:0 0 auto 0;height:min(25rem,44vh);pointer-events:none;
  opacity:.42;
  background:
    linear-gradient(180deg,transparent 0 56%,rgba(4,10,8,.92) 100%),
    radial-gradient(ellipse at 75% 65%,rgba(224,180,94,.08),transparent 13rem),
    linear-gradient(135deg,transparent 0 54%,rgba(81,111,93,.08) 54.2% 55%,transparent 55.2% 100%);
}

/* Brand language from the North Star: warm mark, editorial wordmark, quiet lab
   descriptor. */
.brand{display:flex;align-items:center;gap:.62rem;color:var(--ink)}
.forge-mark{width:30px;height:30px;display:grid;place-items:center;flex:0 0 auto;color:var(--v3-gold)}
.forge-mark svg{width:100%;height:100%;stroke:currentColor;fill:none;stroke-width:1.5;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 8px rgba(224,180,94,.16))}
.brand-copy{display:grid;gap:2px;min-width:0}
.brand-copy>b{font:400 1.25rem/1 var(--serif);letter-spacing:-.025em;color:var(--ink)}
.brand-copy>small{font:500 .52rem/1.25 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
.rail-brand{display:none}

/* Geometry: the handoff is architectural and compact, not pill/card heavy. */
.tile,.item,.card,.hero,.one,.standing,.noticed,.said-here,.facts.money,.launch,
.absence-horizons .horizon,.roadmap-open .sales>li{border-radius:var(--v3-radius)!important}
.tile,.item,.card,.hero,.one,.standing,.noticed,.said-here,.launch{
  background:linear-gradient(180deg,rgba(255,255,255,.018),transparent 50%),var(--v3-panel);
  border-color:var(--v3-line);
}

h1{font-weight:400;letter-spacing:-.035em;text-wrap:balance}
.lede{color:var(--ink-2);max-width:54rem}
.state.ok{color:var(--v3-mint);background:rgba(26,112,82,.32)}
.state.watch{color:var(--v3-gold);background:rgba(111,78,25,.26)}
.state.bad{color:var(--v3-red);background:rgba(119,42,37,.24)}

/* Home / Founder Cockpit. Six true glance facts become the dense state row seen
   in the handoff; Now/Next remains separately legible because it is causality,
   not another metric. */
main[data-place="foundry"]>.brand{margin-bottom:1.15rem}
main[data-place="foundry"]>h1{margin-bottom:.35rem}
main[data-place="foundry"]>.lede:first-of-type{margin-bottom:1.55rem}
main[data-place="foundry"]>.glance{position:relative;margin-top:2.15rem}
main[data-place="foundry"]>.glance::before{
  content:"ESTATE AT A GLANCE";position:absolute;left:1px;top:-1.45rem;
  font:600 .56rem/1 var(--sans);letter-spacing:.18em;color:var(--ink-3)
}
.glance{gap:8px}
.tile{min-height:7.25rem;padding:.82rem .9rem}
.tile dt.k{font-size:.64rem;letter-spacing:.06em;color:var(--ink-3)}
.tile dd.v{font-size:1.42rem;margin-top:.32rem}
.tile dd.d{font-size:.72rem;line-height:1.32;padding-top:.4rem}
.nownext{gap:8px;margin-top:-.3rem}
.nownext>div{border-radius:var(--v3-radius);background:rgba(12,27,22,.78);border-color:var(--v3-line);padding:.78rem .9rem}
.one{border-color:rgba(224,180,94,.44);box-shadow:0 0 0 1px rgba(224,180,94,.04),var(--v3-shadow)}
.one .act{color:var(--v3-gold)}

/* Decisions: consequence first. */
.one-in{padding:1rem 1.1rem}
.one h2{font-size:clamp(1.3rem,2vw,1.75rem);font-weight:400}
.facts{background:rgba(0,0,0,.08);border-color:var(--v3-line)}
.do{background:rgba(0,0,0,.08);border-color:var(--v3-line)}
.btn{border-radius:8px;border-color:var(--v3-line-strong);background:#102019}
.btn.go,.btn.btn-primary{background:#69e2b1;color:#07100d;border-color:#69e2b1}

/* Experiments: probes, not projects. */
.experiment-index-item{position:relative;overflow:hidden}
.experiment-index-item::before{content:"";position:absolute;inset:0 auto 0 0;width:2px;background:var(--v3-mint);opacity:.58}
.launch{border-color:rgba(224,180,94,.48);background:radial-gradient(circle at 100% 0,var(--v3-gold-soft),transparent 22rem),var(--v3-panel)}

/* Activity: an institutional timeline. */
main[data-place="activity"] .stream{max-width:66rem;border-color:var(--v3-line)}
main[data-place="activity"] .ev{padding:.85rem .15rem .85rem 1.3rem;border-color:var(--v3-line)}
main[data-place="activity"] .ev::before{background:var(--ink-3);box-shadow:0 0 0 4px var(--v3-panel)}
main[data-place="activity"] .ev.authority::before,
main[data-place="activity"] .ev.money::before{background:var(--v3-mint)}
main[data-place="activity"] .ev.boundary::before,
main[data-place="activity"] .ev.obligation::before{background:var(--v3-gold)}
main[data-place="activity"] .ev>p:nth-child(2){font-family:var(--serif);font-size:1.01rem;font-weight:400}

/* Economics: arithmetic first, explanations inspectable. */
main[data-place="money"] .facts.money{max-width:58rem;background:rgba(7,16,13,.55);border-color:var(--v3-line);padding:.2rem .95rem}
main[data-place="money"] .mline{padding:.72rem .08rem;border-color:var(--v3-line)}
main[data-place="money"] .mline dd{font-family:var(--serif);font-size:1.12rem}
main[data-place="money"] .mline.total{margin:.25rem -.65rem 0;padding:.95rem .65rem;border-top:1px solid rgba(102,229,180,.32);border-radius:7px;background:var(--v3-mint-soft)}

/* Controls / authority are reach maps, not implementation settings. */
.reach{border-top:1px solid var(--v3-line)}
.reach li{display:grid;grid-template-columns:minmax(9rem,.8fr) minmax(0,1.6fr);gap:.3rem 1rem;align-items:start;padding:.78rem 0;border-color:var(--v3-line)}
.reach li>p{grid-column:2}
.dial{padding:4px;border:1px solid var(--v3-line);border-radius:9px;background:rgba(0,0,0,.10)}
.dial .mark{border-color:transparent;background:transparent}
.dial .mark.on{background:#102019;border-color:var(--v3-line-strong);box-shadow:var(--v3-shadow)}

/* Portfolio / River: estate cross-section. */
.layer{position:relative;margin-left:.35rem;border-left:2px solid rgba(102,229,180,.24);border-radius:0 var(--v3-radius) var(--v3-radius) 0;background:var(--v3-panel)}
.layer:last-of-type{border-left-color:rgba(224,180,94,.58)}
.bar{height:6px;background:rgba(255,255,255,.04)}
.legend{font-size:.72rem;color:var(--ink-3)}

/* Absence and Roadmap: compare horizons / show load. */
.absence-horizons{display:grid;gap:9px;margin-top:1.15rem}
.absence-horizons .horizon{margin:0;padding:.9rem;border:1px solid var(--v3-line);background:var(--v3-panel)}
.absence-horizons .horizon>h2:first-child{font-family:var(--serif);font-size:1.12rem;font-weight:400;letter-spacing:-.02em;margin:0 0 .45rem;padding-bottom:.58rem;border-bottom:1px solid var(--v3-line)}
.absence-horizons .horizon>.lede{font-size:.82rem;line-height:1.42;margin:.5rem 0 .65rem}
.absence-horizons .horizon .sales>li{padding:.65rem 0}
.cognition-economics{max-width:64rem}
.roadmap-open .sales,.roadmap-closed .sales{list-style:none;padding:0;display:grid;gap:8px}
.roadmap-open .sales>li{padding:.9rem;border:1px solid var(--v3-line);background:var(--v3-panel)}
.roadmap-open .sales>li>b{font-family:var(--serif);font-weight:400;font-size:1rem}
.roadmap-closed{opacity:.78}.roadmap-note{max-width:var(--os-reading);opacity:.74}

/* Ask must not consume the phone viewport. It is a dedicated owner action on
   mobile and a compact command/search surface on desktop. */
@media (max-width:899px){
  .wrap{padding:13px 13px calc(5.2rem + env(safe-area-inset-bottom))}
  .brand{margin-bottom:.95rem;text-transform:none;letter-spacing:0}
  .brand-copy>b{font-size:1.18rem}.brand-copy>small{font-size:.48rem;max-width:14rem}
  h1{font-size:1.9rem;line-height:1.04}
  .glance{grid-template-columns:repeat(2,minmax(0,1fr));gap:7px}
  .tile{min-height:6.85rem;padding:.76rem}
  .tile dd.v{font-size:1.28rem}
  .tile dd.d{font-size:.68rem}

  .ask{display:none;position:fixed;z-index:10;left:10px;right:10px;bottom:calc(4.65rem + env(safe-area-inset-bottom));padding:8px;background:rgba(7,16,13,.96);border:1px solid var(--v3-line-strong);border-radius:12px;box-shadow:0 20px 50px rgba(0,0,0,.42)}
  .ask:target{display:block}
  .ask-in{max-width:none;border-radius:9px;padding:3px;background:#0b1713}
  .ask input{min-height:44px}.ask button{min-height:40px;border-radius:7px}

  nav.places{background:rgba(5,12,9,.97);border-color:var(--v3-line);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);padding:5px 4px calc(5px + env(safe-area-inset-bottom))}
  nav.places div{display:grid;grid-template-columns:repeat(9,minmax(0,1fr));max-width:none;margin:0}
  nav.places a{min-height:49px;padding:3px 1px;gap:2px;font-size:.51rem;line-height:1.05;white-space:nowrap;color:var(--ink-3)}
  nav.places a svg{width:18px;height:18px}
  nav.places a.on{color:var(--v3-mint)}
  nav.places .desk{display:none}
  nav.places .sub,nav.places .more{display:none!important}
  nav.places a b{top:0;right:calc(50% - 17px);transform:scale(.88)}
  .rail-brand{display:none}
  .reach li{grid-template-columns:1fr}.reach li>p{grid-column:1}
}

/* 375–390px-class phones keep the North Star's core five destinations under
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

/* Desktop: dense private-institution cockpit with the stable left rail seen in
   the handoff. */
@media (min-width:900px){
  .wrap{max-width:none;margin-left:var(--v3-rail-w);padding:1.45rem clamp(1.6rem,3vw,3.5rem) 4rem}
  .wrap>*{max-width:none}
  h1{font-size:clamp(2.55rem,3.7vw,3.65rem);line-height:1}
  .lede,.said,.know:not(.wide),.done>p{max-width:54rem}

  nav.places{width:var(--v3-rail-w);padding:.9rem .72rem;background:linear-gradient(180deg,rgba(255,255,255,.018),transparent 12rem),var(--v3-rail);border-color:var(--v3-line)}
  nav.places div{gap:2px}
  nav.places div::before{display:none!important;content:none!important}
  nav.places div::after{content:"OWNER CONTROLLED";display:block;order:99;margin:auto .55rem 0;padding-top:.8rem;border-top:1px solid var(--v3-line);font-size:.5rem;letter-spacing:.17em;color:var(--ink-3)}
  .rail-brand{display:flex;align-items:center;gap:.65rem;margin:.1rem .38rem .75rem;padding:.25rem .15rem .95rem;border-bottom:1px solid var(--v3-line)}
  .rail-brand>span:last-child{display:grid;gap:2px;min-width:0}
  .rail-brand b{font:400 1.35rem/1 var(--serif);letter-spacing:-.025em;color:var(--ink)}
  .rail-brand small{font:500 .48rem/1.25 var(--sans);letter-spacing:.08em;text-transform:uppercase;color:var(--ink-3)}
  .rail-brand .forge-mark{width:27px;height:27px}

  nav.places a{min-height:35px;padding:5px 8px;border-radius:7px;font-size:.8rem;gap:8px;color:var(--ink-3);border:1px solid transparent}
  nav.places a svg{width:16px;height:16px}
  nav.places a.on{background:linear-gradient(90deg,rgba(102,229,180,.10),transparent);border-color:rgba(102,229,180,.16);color:var(--ink)}
  nav.places .desk{display:flex}
  nav.places .sub,nav.places .more{border-color:var(--v3-line);margin-top:.55rem;padding-top:.55rem}
  nav.places .sub a,nav.places .more a{min-height:29px;padding:4px 7px 4px 20px;font-size:.73rem}
  nav.places .more a{padding-left:7px}

  .brand{display:none}
  .ask{display:block;position:static;width:min(42rem,100%);margin:0 0 1.45rem;padding:0;background:none;border:0;box-shadow:none;order:-1}
  .ask-in{border:1px solid var(--v3-line-strong);background:rgba(9,20,16,.86);border-radius:9px;padding:3px;box-shadow:none}
  .ask input{min-height:40px}.ask button{min-height:36px;border-radius:7px}

  .glance{grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-bottom:1.45rem}
  .tile{min-height:7.3rem;padding:.85rem .9rem}
  .tile dd.v{font-size:1.45rem}
  .numbers{grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
  .nownext{grid-template-columns:repeat(3,minmax(0,1fr));margin:-.3rem 0 1.5rem}
  .nownext>div.wide{grid-column:auto}
  .decide{grid-template-columns:minmax(0,1.7fr) minmax(18rem,1fr);gap:.8rem}
  .facts.money{max-width:58rem}
  .absence-horizons{grid-template-columns:repeat(3,minmax(0,1fr));max-width:78rem}
  .roadmap-open .sales{grid-template-columns:repeat(2,minmax(0,1fr));max-width:72rem}
  main[data-place="experiments"]>.experiment-index-item{max-width:68rem}
}

@media (min-width:1280px){
  :root{--v3-rail-w:16.1rem}
  .wrap{padding-left:3.5rem;padding-right:3.5rem}
  .glance{grid-template-columns:repeat(6,minmax(0,1fr))}
  .tile{min-height:7.75rem}
}

@media (prefers-reduced-motion:reduce){
  .tile,.item,.card,summary,.btn{transition:none!important;transform:none!important}
}
'''
    css.write_text(source)

# Hard invariant: there is still exactly one owner stylesheet.
owner_styles = [p.name for p in Path("src/public").glob("owner*.css")]
if owner_styles != ["owner.css"]:
    raise SystemExit(f"expected exactly one owner stylesheet, found {owner_styles}")

print("Applied Private Foundry UI handoff v3 North Star cutover")
