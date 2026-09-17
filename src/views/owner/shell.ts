// =============================================================================
// FOUNDRY — the owner shell: one document, one geography, every screen.
//
// This lived inside a 5,975-line route file and was consumed by five modules,
// which is a design system in everything but packaging. It is now a module: the
// `Where` a screen computes, the `page()` that renders it into the same five
// slots every time — trail, title and local addresses, body, the Ask composer,
// the doors — and the stylesheet at /static/owner.css that every consumer
// shares and a browser caches once.
//
// THE DOORS ARE THE CANONICAL SET, AND ONLY THE ONES THAT OPEN. A door onto a
// page that does not exist yet is a dead end with a nice icon. On a phone five
// doors sit under the thumb; on a desk the rail carries the whole set. Nine
// tabs at 375px is forty pixels a tab, which is not a door.
//
// MONEY SHIPPED AND IS STILL NOT A DOOR. This note used to say Economics would
// get one when its surface existed. The surface exists — /foundry/money, the
// whole subtraction from what a buyer paid to what the owner may take — and it
// sits in "Also here" beside Discover and the Workshop, because a seventh tab
// costs every other door forty pixels and money is not a thing he needs under
// his thumb. It is one tap from Home, which is where the question starts.
//
// ONE SCRIPT, HASHED. The owner surface runs exactly the script in
// `owner-surface-script.ts`, so CSP can refuse every inline handler. Nothing
// here may add a second.
// =============================================================================

import { html, raw } from 'hono/html';
import { OWNER_STYLESHEET } from '../../lib/owner-stylesheet.js';
import type { HtmlEscapedString } from 'hono/utils/html';
import type { CompanyPlace, DimensionKey } from '../../services/founder/place.js';
import { OWNER_SURFACE_SCRIPT } from '../../lib/owner-surface-script.js';

/** Which door is lit. `foundry` is Home; `companies` is Portfolio. */
/**
 * The six doors — and one depth that is not a door.
 *
 * `advanced` is the Letter, reached from the footer as "Advanced — inspect the
 * system". It renders in this shell so there is ONE visual system, but it must
 * not light a door: it is a depth beneath all of them, not a seventh place. It
 * matches no key in the rail, so nothing lights, and the footer that points at
 * it is suppressed there rather than linking a page to itself.
 */
export type Place = 'foundry' | 'decisions' | 'companies' | 'discover' | 'experiments' | 'inbox'
  | 'activity' | 'money' | 'controls' | 'advanced';

type H = HtmlEscapedString | Promise<HtmlEscapedString>;

// THREE PLACES, BECAUSE PLACES WERE NEVER THE PROBLEM.
//
// The old product had thirty destinations and they were bad because they
// exposed MACHINERY — Ambient, Roster, Multi-Modal, Standing Orders. Reading
// "too technical" as "too much interface" was my error, and it left the owner
// with a chat box and nowhere to do anything. His companies, his money and what
// Foundry may do are his world, not the institution's internals, and each is
// worth being able to walk to.

/**
 * WHERE HE IS. Every owner screen can say it: the trail that got him here, the
 * object under his feet, what Ask will take as its subject, and the addresses
 * inside this object. Rendered by `page()` in the same slots on every screen,
 * so the geography is stable even where the content is not.
 */
export interface Where {
  eyebrow?: string;
  crumbs: Array<{ href: string; label: string }>;
  scope: {
    kind: 'foundry' | 'portfolio' | 'company' | 'decisions' | 'searching';
    id: string | null; name: string;
  };
  local: Array<{ href: string; label: string; count: number | null; on: boolean }>;
  chips: string[];
}

/** The frame for one company, with one of its dimensions underfoot. */
export function frameFor(place: CompanyPlace, on: DimensionKey): Where {
  const here = place.dimensions.find((d) => d.key === on) ?? place.dimensions[0];
  return {
    eyebrow: 'Company',
    crumbs: [
      { href: '/foundry', label: 'Foundry' }, { href: '/foundry/companies', label: 'Portfolio' },
      { href: `/foundry/companies/${place.id}`, label: place.name },
      ...(on !== 'overview' && here ? [{ href: here.href, label: here.label }] : []),
    ],
    scope: { kind: 'company', id: place.id, name: place.name },
    local: place.dimensions.map((d) => ({ href: d.href, label: d.label, count: d.count, on: d.key === on })),
    chips: place.chips,
  };
}

/**
 * THE HEAD OF A PLACE: the title, what this object is in chips, and the
 * addresses inside it. Always in this order, so once a dimension exists its
 * position never moves.
 */
export function placeHead(where: Where | null, title: string): H {
  if (!where) return html`<h1>${title}</h1>`;
  const up = where.crumbs.length >= 2 ? where.crumbs[where.crumbs.length - 2] : null;
  const here = where.crumbs[where.crumbs.length - 1];
  return html`${up && where.crumbs.length > 3
    ? html`<p class="crumbline"><a href="${up.href}">← ${up.label}</a></p>` : ''}
    ${title ? html`<h1>${where.crumbs.length > 3 && here ? html`${title} <span class="dim">· ${here.label}</span>` : title}</h1>` : ''}
    ${where.chips.length ? html`<p class="chips">${where.chips.map((ch) => html`<span class="chip">${ch}</span>`)}</p>` : ''}
    ${where.local.length ? html`<nav class="local${where.scope.kind === 'company' ? ' rail' : ''}" id="places" aria-label="Within ${where.scope.name}">${where.local.map((l) =>
      html`<a href="${l.href}"${l.on ? raw(' class="on" aria-current="page"') : ''}>${l.label}${
        l.count !== null && l.count > 0 ? html` <b>${String(l.count)}</b>` : ''}</a>`)}</nav>` : ''}`;
}

/** The trail, for every screen below the first. */
function crumbsOf(where: Where | null): H | '' {
  if (!where || where.crumbs.length < 2) return '';
  return html`<p class="crumbs" aria-label="Where you are">${where.crumbs.map((cr, i) =>
    i === where.crumbs.length - 1
      ? html`<span aria-current="location">${cr.label}</span>`
      : html`<a href="${cr.href}">${cr.label}</a><i>›</i>`)}</p>`;
}

/**
 * ON A WIDE SCREEN THE RAIL CARRIES THE OBJECT. Under the three doors: the
 * object he is inside and its addresses, and the two places that are reached
 * from context rather than owning a door.
 */
function railExtra(where: Where | null): H {
  const object = where && where.scope.kind === 'company' && where.local.length
    ? html`<section class="sub" aria-label="Within ${where.scope.name}"><b>${where.scope.name}</b>${where.local.map((l) =>
      html`<a href="${l.href}"${l.on ? raw(' class="on"') : ''}>${l.label}${
        l.count !== null && l.count > 0 ? html` <span>${String(l.count)}</span>` : ''}</a>`)}</section>`
    : '';
  return html`${object}<section class="more" aria-label="Also here">
    <a href="/foundry/public-workshop">Workshop</a>
    <a href="/foundry/roadmap">Roadmap</a>
    <a href="/foundry/absence">Absence test</a>
  </section>`;
}

/**
 * INSIDE A COMPANY, THE BAR IS THE COMPANY'S. On a phone the three doors give
 * way to the places inside the object he is standing in — Portfolio to go up,
 * then Overview, Work and the rest in their fixed order — so moving between
 * what a company is, what is happening to it and what it earns is one thumb
 * away, the way it is in the products he finds easy. The doors are still one
 * tap away through Portfolio; the trail above the title still says where he
 * is. On a wide screen the rail carries all of this and the bar stays hidden.
 */
function companyBar(where: Where | null): H | '' {
  if (!where || where.scope.kind !== 'company' || !where.local.length) return '';
  const ICON: Record<string, string> = {
    overview: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 8v4l3 2"/></svg>',
    work: '<svg viewBox="0 0 24 24"><path d="M4 7h16v11H4z"/><path d="M9 7V5h6v2M4 12h16"/></svg>',
    authority: '<svg viewBox="0 0 24 24"><path d="M4 16a8 8 0 0 1 16 0"/><path d="M12 16l4-5"/><circle cx="12" cy="16" r="1.5"/></svg>',
    economics: '<svg viewBox="0 0 24 24"><path d="M4 18 10 11l4 4 6-8"/><path d="M4 21h16"/></svg>',
    customers: '<svg viewBox="0 0 24 24"><circle cx="9" cy="8" r="3"/><circle cx="17" cy="10" r="2.5"/><path d="M3 19c0-3 3-5 6-5s6 2 6 5M14 19c0-2 1.5-3.5 3-3.5s4 1.5 4 3.5"/></svg>',
    experiments: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6L4 19h16l-6-10V3"/></svg>',
    evidence: '<svg viewBox="0 0 24 24"><path d="M6 3h9l5 5v13H6z"/><path d="M14 3v6h6M9 13h6M9 17h6"/></svg>',
  };
  const keyOf = (href: string): string => href.split('/').pop() ?? 'overview';
  const places = where.local.map((l) => ({ ...l, key: l.href.endsWith(where.scope.id ?? '') ? 'overview' : keyOf(l.href) }));
  const shown = places.slice(0, 4);
  const more = places.length > 4;
  return html`<nav class="places company" aria-label="Within ${where.scope.name}"><div>
    <a href="/foundry/companies"><svg viewBox="0 0 24 24"><path d="M3 17c3-4 6 0 9-3s6 1 9-3"/><path d="M3 12c3-4 6 0 9-3s6 1 9-3"/></svg>Portfolio</a>
    ${shown.map((l) => html`<a href="${l.href}"${l.on ? raw(' class="on" aria-current="page"') : ''}>${raw(ICON[l.key] ?? ICON.overview ?? '')}${l.label}${
      l.count !== null && l.count > 0 ? html`<b>${String(l.count)}</b>` : ''}</a>`)}
    ${more ? html`<a href="/foundry/companies/${where.scope.id ?? ''}#places"><svg viewBox="0 0 24 24"><circle cx="6" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="18" cy="12" r="1.5"/></svg>More</a>` : ''}
  </div></nav>`;
}

/** What Ask will take as its subject, said where he types. */
function askScope(where: Where | null): { placeholder: string; hidden: string; line: H | '' } {
  if (!where || where.scope.kind === 'foundry') {
    return { placeholder: 'Ask Foundry anything…', hidden: '', line: '' };
  }
  if (where.scope.kind === 'company' && where.scope.id) {
    return {
      placeholder: `Ask about ${where.scope.name}…`,
      hidden: `company:${where.scope.id}`,
      line: html`<p class="askwhere">Asking about <b>${where.scope.name}</b> · <a href="/foundry">everything instead</a></p>`,
    };
  }
  return {
    placeholder: `Ask about ${where.scope.name}…`, hidden: '',
    line: html`<p class="askwhere">Asking about <b>${where.scope.name}</b> · <a href="/foundry">everything instead</a></p>`,
  };
}

/**
 * THE MARKS THE INSTRUMENTS SHARE. One small outline per kind of fact, drawn
 * from the same stroke as the doors, so a tile on Home, a figure on Economics
 * and a row on Activity read as one system. Decorative only: every mark sits
 * beside the words it stands for and carries aria-hidden.
 */
export const MARK: Record<string, string> = {
  estate: '<svg viewBox="0 0 24 24"><path d="M3 12h4l2-5 3 10 2-6 2 3h5"/></svg>',
  autonomy: '<svg viewBox="0 0 24 24"><path d="M12 3 4 7.5v9L12 21l8-4.5v-9z"/><path d="M4 7.5 12 12l8-4.5M12 12v9"/></svg>',
  charter: '<svg viewBox="0 0 24 24"><path d="M6 3h9l4 4v14H6z"/><path d="M15 3v4h4M9 12h6M9 16h4"/></svg>',
  owner: '<svg viewBox="0 0 24 24"><circle cx="12" cy="8" r="3.5"/><path d="M5 20c0-3.5 3-6 7-6s7 2.5 7 6"/></svg>',
  experiment: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6L4 19h16l-6-10V3"/></svg>',
  cash: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M16 12h2M3 10h18"/></svg>',
  reserve: '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v12c0 1.7 3.1 3 7 3s7-1.3 7-3V6M5 12c0 1.7 3.1 3 7 3s7-1.3 7-3"/></svg>',
  watching: '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  changed: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
  mail: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
  sent: '<svg viewBox="0 0 24 24"><path d="M3 11 21 3l-6 18-3-8z"/></svg>',
  check: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="m8 12 3 3 5-6"/></svg>',
  warn: '<svg viewBox="0 0 24 24"><path d="M12 4 3 20h18z"/><path d="M12 10v4M12 17h.01"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><path d="M8 3h8l5 5v8l-5 5H8l-5-5V8z"/><path d="M12 8v5M12 16h.01"/></svg>',
  money: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8.5"/><path d="M12 7v10M9.5 9.5c0-1 1-1.5 2.5-1.5s2.5.6 2.5 1.6-1 1.4-2.5 1.6-2.5.6-2.5 1.6 1 1.6 2.5 1.6 2.5-.5 2.5-1.5"/></svg>',
  arrow: '<svg viewBox="0 0 24 24"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
  spark: '<svg viewBox="0 0 24 24"><path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z"/></svg>',
  box: '<svg viewBox="0 0 24 24"><path d="M4 7h16v11H4z"/><path d="M9 7V5h6v2M4 12h16"/></svg>',
};

/** A mark, rendered. */
export function mark(name: string): HtmlEscapedString {
  return raw(`<i class="mk" aria-hidden="true">${MARK[name] ?? MARK.box ?? ''}</i>`);
}

/**
 * HOW LONG AGO, IN THE WORDS A PERSON USES. "12m ago", "2h ago", "3d ago";
 * beyond a fortnight the date itself, because "23d ago" is a sum nobody wants.
 */
export function ago(iso: string, now: Date = new Date()): string {
  const at = new Date(String(iso).replace(' ', 'T') + (/[zZ]|[+-]\d\d:?\d\d$/.test(String(iso)) ? '' : 'Z'));
  const ms = now.getTime() - at.getTime();
  if (!Number.isFinite(ms)) return String(iso).slice(0, 10);
  const m = Math.floor(ms / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${String(m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${String(h)}h ago`;
  const d = Math.floor(h / 24);
  if (d < 15) return `${String(d)}d ago`;
  return String(iso).slice(0, 10);
}

/** How many things wait behind a door, when the screen knows. */
export type DoorCounts = Partial<Record<Place, number>>;

const ICONS = {
  home: '<svg viewBox="0 0 24 24"><path d="M3 11.5 12 4l9 7.5"/><path d="M5 10v10h14V10"/></svg>',
  decisions: '<svg viewBox="0 0 24 24"><path d="M4 12l5 5L20 6"/></svg>',
  experiments: '<svg viewBox="0 0 24 24"><path d="M9 3h6M10 3v6L4 19h16l-6-10V3"/></svg>',
  inbox: '<svg viewBox="0 0 24 24"><path d="M3 12v6h18v-6"/><path d="M3 12l3-7h12l3 7"/><path d="M3 12h5l2 3h4l2-3h5"/></svg>',
  controls: '<svg viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--bg)"/><circle cx="15" cy="12" r="2" fill="var(--bg)"/><circle cx="8" cy="17" r="2" fill="var(--bg)"/></svg>',
  portfolio: '<svg viewBox="0 0 24 24"><path d="M3 17c3-4 6 0 9-3s6 1 9-3"/><path d="M3 12c3-4 6 0 9-3s6 1 9-3"/></svg>',
  discover: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4M11 8v6M8 11h6"/></svg>',
  activity: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><path d="M12 7v5l3 2"/></svg>',
  money: '<svg viewBox="0 0 24 24"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h8M8 14h5"/></svg>',
  ask: '<svg viewBox="0 0 24 24"><path d="M5 5h14v11H9l-4 3z"/><path d="M9 9h6M9 12h4"/></svg>',
};

/** One door. `deskOnly` doors render only where the rail has room. */
function door(href: string, key: Place, label: string, icon: string, active: Place, counts: DoorCounts, deskOnly = false): H {
  const n = counts[key] ?? 0;
  return html`<a href="${href}" class="${[active === key ? 'on' : '', deskOnly ? 'desk' : ''].filter(Boolean).join(' ')}"${active === key ? raw(' aria-current="page"') : ''}>${raw(icon)}${label}${n > 0 ? html`<b>${String(n)}</b>` : ''}</a>`;
}

export const page = (title: string, body: HtmlEscapedString | Promise<HtmlEscapedString>,
  active: Place = 'foundry', where: Where | null = null, counts: DoorCounts = {},
) => html`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>${title}</title>
<!-- ON THE HOME SCREEN, IT IS HIS PRODUCT. The owner's surface was the one
     place not wired to the installable app: no manifest, no icon, no theme
     colour — so adding it to a phone gave a browser chrome bar in the wrong
     colour and a generic icon, while the manifest it would have used described
     the commercial product and its dark palette. -->
<link rel="manifest" href="/manifest.json" />
<link rel="apple-touch-icon" href="/static/icon-192.png" />
<meta name="apple-mobile-web-app-capable" content="yes" />
<meta name="apple-mobile-web-app-title" content="Foundry" />
<meta name="theme-color" content="#0B100E" media="(prefers-color-scheme: dark)" />
<meta name="theme-color" content="#F3F4F1" media="(prefers-color-scheme: light)" />
<link rel="stylesheet" href="${OWNER_STYLESHEET}" />
</head>
<body>
<main class="wrap" data-place="${active}">
<div class="brand"><span class="forge-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3v26M7 10c5 0 9 6 9 6s-4 6-9 6c0-6 4-12 9-12Zm18 0c-5 0-9 6-9 6s4 6 9 6c0-6-4-12-9-12Z"/></svg></span><span class="brand-copy"><b>Foundry</b><small>Private Lab for Digital Income Streams</small></span></div>
${crumbsOf(where)}
${body}
${active === 'advanced' ? '' : html`<footer><a href="/letter">Advanced — inspect the system</a></footer>`}
<form class="ask" id="ask-foundry" method="GET" action="/foundry">
  ${askScope(where).line}
  ${askScope(where).hidden ? html`<input type="hidden" name="scope" value="${askScope(where).hidden}" />` : ''}
  <div class="ask-in">
    <label for="q" class="sr">${askScope(where).placeholder}</label>
    <input id="q" name="q" type="search" enterkeyhint="search" autocorrect="on"
      autocapitalize="sentences" spellcheck="true" placeholder="${askScope(where).placeholder}" />
    <button type="submit">Ask</button>
  </div>
</form>
</main>
${companyBar(where)}
<nav class="places${where && where.scope.kind === 'company' && where.local.length ? ' behind' : ''}" aria-label="Places"><div>
  <header class="rail-brand"><span class="forge-mark" aria-hidden="true"><svg viewBox="0 0 32 32"><path d="M16 3v26M7 10c5 0 9 6 9 6s-4 6-9 6c0-6 4-12 9-12Zm18 0c-5 0-9 6-9 6s4 6 9 6c0-6-4-12-9-12Z"/></svg></span><span><b>Foundry</b><small>Private Lab for Digital Income Streams</small></span></header>
  ${door('/foundry', 'foundry', 'Home', ICONS.home, active, counts)}
  ${door('/foundry/decisions', 'decisions', 'Decisions', ICONS.decisions, active, counts)}
  ${door('/foundry/companies', 'companies', 'Portfolio', ICONS.portfolio, active, counts)}
  ${door('/foundry/searching', 'discover', 'Discover', ICONS.discover, where?.scope.kind === 'searching' ? 'discover' : active, counts, true)}
  ${door('/foundry/experiments', 'experiments', 'Experiments', ICONS.experiments, active, counts)}
  ${door('/foundry/inbox', 'inbox', 'Inbox', ICONS.inbox, active, counts)}
  ${door('/foundry/activity', 'activity', 'Activity', ICONS.activity, active, counts)}
  ${door('/foundry/money', 'money', 'Economics', ICONS.money, active, counts)}
  ${door('/foundry/controls', 'controls', 'Controls', ICONS.controls, active, counts)}
  <a class="ask-door" href="/foundry#ask-foundry">${raw(ICONS.ask)}Ask</a>
  ${railExtra(where)}
</div></nav>
<script>${raw(OWNER_SURFACE_SCRIPT)}</script>
</body>
</html>`;
