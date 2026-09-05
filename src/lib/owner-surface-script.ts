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
  + `  (function(){var a=document.querySelector('.ask'),n=document.querySelector('nav.places');`
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
  + `  document.addEventListener('submit',function(e){`
  + `var f=e.target;if(!f||f.dataset.busy)return;f.dataset.busy='1';\n`
  + `    var b=f.querySelector('button[type=submit],button:not([type])');if(!b)return;\n`
  + `    setTimeout(function(){b.disabled=true;b.textContent='Working…';},120);},true);\n`;

/** Its CSP source expression. Recomputed from the constant, never hand-written. */
export const OWNER_SURFACE_SCRIPT_HASH =
  `'sha256-${createHash('sha256').update(OWNER_SURFACE_SCRIPT, 'utf8').digest('base64')}'`;

/**
 * Whether a request is for the owner's own product rather than the older
 * commercial surfaces, which still carry inline scripts a hash cannot cover.
 */
export function isOwnerSurface(path: string): boolean {
  return path === '/foundry' || path.startsWith('/foundry/');
}
