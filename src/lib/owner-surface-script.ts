// =============================================================================
// FOUNDRY — the only script the owner's surface runs, and its hash.
//
// WHY THIS FILE EXISTS. The private surface renders text written by strangers:
// a Hacker News comment quoted verbatim beneath an opportunity is the whole
// point of the evidence discipline. One of those quotes reached the owner's
// first screen as live markup, because the card was built by string
// concatenation and handed to raw(). That is fixed at the point of rendering —
// and fixing one instance of a class is not the same as closing the class.
//
// The Content-Security-Policy could not help, because it carried
// 'unsafe-inline' for script-src, which permits exactly the inline event
// handler an injected tag would use. It carried it for a real reason: the
// application as a whole has fourteen inline scripts and thirty-seven inline
// handlers, and no directive edit fixes that.
//
// But the OWNER'S surface has one script and no handlers. That one is small,
// static, and here — so it can be hashed, and the surface that renders the
// internet can have a policy with no 'unsafe-inline' at all.
//
// The hash is computed from this exact constant at load, so the script and the
// policy cannot drift apart. Editing the script re-hashes it automatically;
// there is no second place to remember to update.
// =============================================================================

import { createHash } from 'node:crypto';

/**
 * THE TIME OF DAY BELONGS TO THE READER, NOT THE SERVER.
 *
 * This greeted him with "good morning" at eleven at night, because the machine
 * runs in UTC. It is the only thing on this surface that needs a browser.
 */
export const OWNER_SURFACE_SCRIPT =
  `\n  (function(){var e=document.getElementById('greet');if(!e)return;`
  + `var h=new Date().getHours();\n`
  + `    e.textContent=h<12?'Good morning':h<18?'Good afternoon':'Good evening';})();\n`
  // THE KEYBOARD SWALLOWED THE ENTRANCE.
  //
  // The composer is fixed to the bottom of the window. On iOS the software
  // keyboard does not resize the window, so the bar he is typing into sits
  // behind the keyboard — the one place on the surface he types a mandate,
  // covered by the act of typing. visualViewport reports what is actually
  // visible; the bar rides on top of it.
  + `  (function(){var v=window.visualViewport;if(!v)return;`
  + `var r=document.documentElement;\n`
  + `    function s(){r.style.setProperty('--kb',`
  + `Math.max(0,window.innerHeight-v.height-v.offsetTop)+'px');}\n`
  + `    v.addEventListener('resize',s);v.addEventListener('scroll',s);s();})();\n`
  // AND SOMETHING HAPPENS WHEN HE PRESSES THE BUTTON.
  //
  // Every page here is rendered by the server, so between the tap and the next
  // screen there was nothing at all: no spinner, no disabled button, no change
  // of any kind. On a slow connection that reads as a dead button, and the
  // honest response to a dead button is to press it again. The delay keeps a
  // fast submission from flickering.
  // AND THE PAGE RESERVED A GUESS FOR THE BARS THAT SIT ON TOP OF IT.
  //
  // The reserve at the bottom of every page was a constant — eleven rems plus
  // the safe-area inset — chosen to be about the height of the composer and
  // the tab bar. A constant is wrong in both directions: too large and it
  // wastes a fifth of a phone screen on nothing, too small and the last thing
  // on the page, which on a decision card is the buttons, sits underneath the
  // composer. It cannot be right for every text size, and at 200% it is not
  // close.
  //
  // So the bars measure themselves and the page reserves exactly that. The CSS
  // keeps its constant as the starting value, which is what a browser with no
  // script still gets.
  // The bar that is shown: inside a company the first bar in the document is
  // the hidden one and the company bar is the one over the page.
  + `  (function(){var a=document.querySelector('.ask'),n=document.querySelector('nav.places:not(.behind)');`
  + `var r=document.documentElement;\n`
  + `    function m(){var H=window.innerHeight,h=0;[a,n].forEach(function(el){if(!el)return;`
  + `if(getComputedStyle(el).position!=='fixed')return;`
  + `var b=el.getBoundingClientRect();\n`
  + `      if(b.height>H/2||b.bottom<H*0.6)return;h=Math.max(h,H-b.top);});\n`
  + `      if(h>0)r.style.setProperty('--chrome',Math.ceil(h)+'px');`
  + `else r.style.removeProperty('--chrome');}\n`
  + `    m();window.addEventListener('resize',m);\n`
  + `    if(window.ResizeObserver){var o=new ResizeObserver(m);`
  + `if(a)o.observe(a);if(n)o.observe(n);}})();\n`
  // THE DOORS ARE NOT ASSEMBLED HERE. A phone shows five doors, in markup,
  // styled by the stylesheet; the rest of the places sit in a sheet the More
  // door opens with a fragment. There is no membership to compute, so a script
  // that fails to run leaves exactly the bar the stylesheet drew.
  // AND A FORM THAT ASKS FIRST STILL ASKS.
  //
  // Three forms here confirm before they submit — disconnecting a credential,
  // granting the autopilot the right to act, and stopping it everywhere. Each
  // said so through an `onsubmit` attribute, which is the precise construct
  // `'unsafe-inline'` exists to permit and an injected tag would use. The
  // question moves onto the form as data and is asked here.
  //
  // The confirm runs BEFORE the busy marking, in the same listener rather than
  // a second one, because a cancelled submission that has already disabled its
  // own button is a dead page.
  + `  document.addEventListener('submit',function(e){var f=e.target;if(!f)return;\n`
  + `    var q=f.getAttribute&&f.getAttribute('data-confirm');`
  + `if(q&&!window.confirm(q)){e.preventDefault();return;}\n`
  + `    if(f.dataset.busy)return;f.dataset.busy='1';\n`
  + `    var b=f.querySelector('button[type=submit],button:not([type])');if(!b)return;\n`
  + `    setTimeout(function(){b.disabled=true;b.textContent='Working…';},120);},true);\n`
  // FOUR SMALL BEHAVIOURS THAT WERE FIFTEEN INLINE HANDLERS.
  //
  // A toggle that submits its own form; a read-only field that selects itself
  // so a long token can be copied on a phone; a Copy button; and a dialog that
  // opens and closes. Every one was an `on…=` attribute on the element, and
  // every one is the same shape as the attack: markup that arrives as content
  // and executes because the policy cannot tell the difference between a
  // handler the author wrote and one a stranger's comment carried in.
  //
  // Written as delegated listeners over data attributes, they are behaviour in
  // one hashed place and intent in the markup — and they keep working for
  // anything rendered after load, which the attributes also did.
  + `  document.addEventListener('change',function(e){var t=e.target;\n`
  + `    if(!t||!t.hasAttribute||!t.hasAttribute('data-submits'))return;\n`
  + `    var f=t.closest('form');if(!f)return;`
  + `if(f.requestSubmit)f.requestSubmit();else f.submit();});\n`
  + `  document.addEventListener('click',function(e){\n`
  + `    var t=e.target&&e.target.closest&&e.target.closest(`
  + `'[data-select],[data-copy],[data-open],[data-close]');if(!t)return;\n`
  + `    if(t.hasAttribute('data-select')){if(t.select)t.select();return;}\n`
  + `    var o=t.getAttribute('data-open');`
  + `if(o){var d=document.getElementById(o);if(d&&d.showModal)d.showModal();return;}\n`
  + `    if(t.getAttribute('data-close')!==null){`
  + `var p=t.closest('dialog');if(p&&p.close)p.close();return;}\n`
  + `    var g=document.getElementById(t.getAttribute('data-copy'));\n`
  + `    if(!g||!navigator.clipboard)return;\n`
  + `    navigator.clipboard.writeText(g.value).then(function(){var w=t.textContent;\n`
  + `      t.textContent='Copied';setTimeout(function(){t.textContent=w;},1500);});});\n`;

/** Its CSP source expression. Recomputed from the constant, never hand-written. */
export const OWNER_SURFACE_SCRIPT_HASH =
  `'sha256-${createHash('sha256').update(OWNER_SURFACE_SCRIPT, 'utf8').digest('base64')}'`;

/**
 * EVERY PLACE THE OWNER SIGNS IN TO.
 *
 * This was `/foundry` alone, because the other authenticated paths still
 * carried inline handlers a hash cannot cover and a strict policy would have
 * broken them silently — a toggle that stops toggling, with nothing in the
 * page to say why.
 *
 * They do not carry them any more. `/talk` is retired; the fifteen handlers on
 * Controls, privacy, connections and the Letter are delegated listeners inside
 * the hashed script; the one remaining inline block, the dialog's Escape key,
 * is the browser's own behaviour now that the dialog is a `<dialog>`. So the
 * whole owner product gets the policy its first screen has had, and the
 * `'unsafe-inline'` that remains covers exactly the sign-in pages, which load
 * a vendor's SDK from a CDN and render nothing written by a stranger.
 *
 * Each entry is a mount point in `src/index.ts`, and a test holds them to each
 * other so a new owner surface cannot be added to one list and forgotten in
 * the other.
 */
export const OWNER_SURFACES = [
  '/foundry', '/letter', '/settings', '/privacy',
  '/autopilot', '/connections', '/onboarding',
] as const;

export function isOwnerSurface(path: string): boolean {
  return OWNER_SURFACES.some((p) => path === p || path.startsWith(`${p}/`));
}
