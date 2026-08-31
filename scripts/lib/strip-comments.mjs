// =============================================================================
// STRIPPING COMMENTS WITHOUT STRIPPING CODE.
//
// Ten gates opened with the same line:
//
//     source.replace(/\/\*[\s\S]*?\*\//g, ' ')
//
// A route glob is a string containing `/*`. `app.use('/dashboard/*', mw)` opens
// what that regex reads as a block comment, and it closes at the next real
// `*/` — which may be hundreds of lines later, in a JSDoc block. Everything in
// between was blanked before any gate looked at it.
//
// MEASURED, NOT SUSPECTED: 715 lines of CODE across 7 files. The first count
// taken was 5,939 across 273 files, and that was wrong — it counted real
// comments alongside the swallowed code. The number that matters is the
// difference between the two rules, and it is this one.
//
// 314 of those lines are half of `src/index.ts`: the route mounting, the
// middleware wiring and the scheduler. The rest are in
// `calibration/voice-fingerprint.ts` (214), `dashboard/agents-briefings.ts`
// (130), and four smaller files. Every green tick from those gates over those
// files carried an unstated qualifier: over the part of it they could see.
//
// It also hid two modules from the reachability gate, which counted
// `middleware/csrf.ts` and `services/integrations/stripe-webhook.ts` as
// reachable through imports that had been blanked into nothing.
//
// THE RULE HERE. A block comment is recognised when `/*` begins a line, or when
// the whole `/* ... */` sits on one line. Neither can start inside a string on
// a line of code, because a route glob has no closing `*/` on its own line.
// Measured across `src/`: 1,278 block comments begin a line and 119 sit inline
// after code, and every one of the 119 is a single-line note. Nothing is left
// uncovered by drawing the line here.
//
// Whitespace is preserved so line numbers survive: a gate that reports a
// location must report the one in the file.
// =============================================================================

const blank = (m) => m.replace(/[^\n]/g, ' ');

/**
 * @param {string} source
 * @param {{ lineComments?: boolean }} [opts] `lineComments` also blanks `//`
 *   comments — whole-line ones always, and trailing ones only when the line
 *   holds no quote, since `//` appears inside URLs.
 */
export function stripComments(source, opts = {}) {
  let out = source
    // Block comments that begin a line. These may span lines.
    .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, blank)
    // Block comments contained in one line, after code.
    .replace(/\/\*[^\n]*?\*\//g, blank);
  if (opts.lineComments !== false) {
    out = out.split('\n').map((line) => {
      if (/^\s*\/\//.test(line)) return '';
      if (/['"`]/.test(line)) return line;
      const at = line.indexOf('//');
      return at < 0 ? line : line.slice(0, at);
    }).join('\n');
  }
  return out;
}
