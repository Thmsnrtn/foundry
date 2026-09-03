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
  + `    e.textContent=h<12?'Good morning':h<18?'Good afternoon':'Good evening';})();\n`;

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
