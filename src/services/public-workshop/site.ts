// =============================================================================
// FOUNDRY — The public Workshop's pages, rendered from the projection.
//
// Pure functions from public facts to HTML. Nothing here reads a row; what a
// page can say is exactly what crossed the projection boundary. The voice is
// the owner's: a person, plain, specific about what is and is not claimed.
// One stylesheet, no scripts, no tracking of any kind, and every control large
// enough for a thumb, because a recipient opens an experiment link on a phone.
// =============================================================================
import type { PublicExperiment, PublicWorkshopFacts } from './projection.js';
import { postalLines } from './settings.js';

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const paras = (s: string): string => s.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, '<br>')}</p>`).join('\n');
const money = (p: NonNullable<PublicExperiment['price']>): string => p.label;
// A HEADING IS NOT A METADATA LINE. The dates beside "Opened" and "Closed" stay
// as the record spells them; a dated footnote reads as a sentence, so its date
// is written the way a sentence writes one. Parsed rather than formatted with a
// locale, because the day this renders differently in another region is the day
// two readers disagree about when a correction was made.
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
  'August', 'September', 'October', 'November', 'December'];
const longDate = (iso: string): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${String(Number(m[3]))} ${MONTHS[Number(m[2]) - 1] ?? m[2]} ${m[1]}`;
};
/**
 * JUST THE AMOUNT. `label` carries the terms as well ("$29, one time"), which
 * reads correctly on its own and badly inside a sentence — "the whole $29, one
 * time back", "Buy for $29, one time". The terms are stated once, on their own
 * line; everywhere else the page needs the number and nothing else.
 */
const amount = (p: NonNullable<PublicExperiment['price']>): string =>
  p.currency.toUpperCase() === 'USD'
    ? `$${(p.amountCents / 100).toFixed(p.amountCents % 100 === 0 ? 0 : 2)}`
    : `${(p.amountCents / 100).toFixed(2)} ${p.currency.toUpperCase()}`;

export const PUBLIC_PATHS = ['/', '/about', '/experiments', '/operating', '/graduated', '/closed', '/contact', '/privacy', '/email', '/email/done', '/thank-you', '/refunds', '/terms', '/404'] as const;
export type PublicPath = typeof PUBLIC_PATHS[number];
/** The two files that are not pages, served beside them with their own types. */
export const PUBLIC_FILES = ['/robots.txt', '/sitemap.xml'] as const;
/**
 * WHAT A CRAWLER IS TOLD NOT TO KEEP. The opt-out form, its receipt, the
 * answer receipt and the not-found page are for the person in front of them,
 * not for an index; the rest of the Workshop is meant to be found.
 */
export const UNINDEXED: ReadonlySet<string> = new Set(['/email', '/email/done', '/thank-you', '/404']);
const INDEXED_PATHS: readonly PublicPath[] = PUBLIC_PATHS.filter((x) => !UNINDEXED.has(x));
/** JSON inside a script element: the one sequence that could close the element is escaped. */
const jsonLd = (v: unknown): string => JSON.stringify(v).replace(/<\//g, '<\\/');

const CSS = `
:root{--bg:#f8f6f1;--ink:#1f1d1a;--soft:#5d5852;--line:#e2ddd3;--accent:#2f5d50;--card:#fffdf9}
@media (prefers-color-scheme:dark){:root{--bg:#171613;--ink:#efeae0;--soft:#aaa39a;--line:#2f2c27;--accent:#8fc4b4;--card:#1e1c18}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--bg);color:var(--ink);font:18px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Helvetica,Arial,sans-serif}
main,header,footer{max-width:40rem;margin:0 auto;padding:0 1.25rem}
header{padding-top:1.25rem;display:flex;flex-wrap:wrap;gap:.5rem 1.25rem;align-items:baseline;justify-content:space-between}
header a.name{font-weight:700;text-decoration:none;color:var(--ink);font-size:1.05rem}
nav{display:flex;flex-wrap:wrap;gap:.25rem 1rem}nav a{color:var(--soft);text-decoration:none;padding:.35rem 0;min-height:44px;display:inline-flex;align-items:center}
nav a[aria-current]{color:var(--ink);border-bottom:2px solid var(--accent)}
h1{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:2rem;line-height:1.2;margin:2rem 0 .5rem}
h2{font-family:Georgia,"Times New Roman",serif;font-weight:400;font-size:1.4rem;margin:2.25rem 0 .5rem}
p{margin:.6rem 0}.lede{font-size:1.15rem;color:var(--soft)}.quiet{color:var(--soft);font-size:.95rem}
a{color:var(--accent)}main{padding-bottom:3rem}
.pill{display:inline-block;font-size:.8rem;padding:.15rem .6rem;border:1px solid var(--line);border-radius:999px;color:var(--soft);vertical-align:middle;margin-left:.4rem}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:1rem 1.1rem;margin:1rem 0}
.list a.item{display:block;padding:1rem 0;border-top:1px solid var(--line);text-decoration:none;color:var(--ink)}.list a.item:last-child{border-bottom:1px solid var(--line)}
.item .t{font-weight:600}.item .s{color:var(--soft);font-size:.95rem}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:.6rem 1.2rem;border-radius:10px;background:var(--accent);color:#fff;text-decoration:none;font-weight:600}
dl{margin:1rem 0}dt{font-weight:600;margin-top:1rem}dd{margin:.25rem 0 0}
label{display:block;font-weight:600;margin-top:1rem}
fieldset{border:1px solid var(--line);border-radius:10px;margin:1rem 0;padding:.5rem 1rem 1rem}legend{font-weight:600;padding:0 .4rem}
label.choice{font-weight:400;display:flex;gap:.6rem;align-items:flex-start;min-height:44px;padding:.4rem 0}
textarea{width:100%;font:inherit;padding:.7rem .8rem;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);margin:.4rem 0 .8rem}input[type=email]{width:100%;font:inherit;padding:.7rem .8rem;border:1px solid var(--line);border-radius:10px;background:var(--card);color:var(--ink);margin:.4rem 0 .8rem}
button{font:inherit}footer{border-top:1px solid var(--line);padding:1.5rem 1.25rem 3rem;color:var(--soft);font-size:.9rem}
footer p{margin:.3rem 0}`;

function shell(f: PublicWorkshopFacts, title: string, current: string, body: string, description: string, at: { path: string; head?: string }): string {
  // The paths stay what they are; what a visitor reads is what a person calls it.
  const nav = [['/', 'Home'], ['/about', 'About'], ['/experiments', 'What I\'ve made'], ['/contact', 'Contact']] as const;
  // ONE ADDRESS PER PAGE. A crawler that reaches a page by any other route is
  // told which address is the page's own; a page that is not for an index says
  // so instead, and carries no canonical, which would contradict it.
  const found = UNINDEXED.has(at.path)
    ? '<meta name="robots" content="noindex">'
    : `<link rel="canonical" href="${esc(f.origin)}${esc(at.path)}">`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title === f.name ? f.name : `${title} · ${f.name}`)}</title>
<meta name="description" content="${esc(description)}">
<meta name="referrer" content="no-referrer">
${found}${at.head ? `\n${at.head}` : ''}
<style>${CSS}</style>
</head>
<body>
<header>
  <a class="name" href="/">${esc(f.name)}</a>
  <nav aria-label="Site">${nav.map(([href, label]) => `<a href="${href}"${href === current ? ' aria-current="page"' : ''}>${label}</a>`).join('')}</nav>
</header>
<main>
${body}
</main>
<footer>
  <p><strong>${esc(f.name)}</strong> is a small digital workshop in ${esc(f.region)}.</p>
  <p><a href="/contact">Contact</a> · <a href="/privacy">Privacy</a> · <a href="/email">Email &amp; opt-out</a> · <a href="/refunds">Refunds</a> · <a href="/terms">Terms</a></p>
  ${f.postalAddress ? `<p>${postalLines(f.postalAddress).map(esc).join('<br />')}</p>` : ''}
</footer>
</body>
</html>
`;
}

// THE THING'S OWN NAME COMES FIRST. It read "Experiment 001 — Massachusetts
// Millwork Bid Brief", which puts the filing reference in front of the product
// on the front page. The number is how this workshop keeps its own order and it
// still stands here, small, after the name.
const item = (x: PublicExperiment): string => `<a class="item" href="${x.path}">
  <div class="t">${esc(x.title)}<span class="pill">${x.statusLabel}</span></div>
  <div class="s">${esc(x.summary)}</div>
  <div class="s">No. ${String(x.number).padStart(3, '0')}</div>
</a>`;

const listOf = (xs: PublicExperiment[], empty: string): string => xs.length ? `<div class="list">${xs.map(item).join('\n')}</div>` : `<p class="quiet">${empty}</p>`;

export function renderHome(f: PublicWorkshopFacts, registry: PublicExperiment[]): string {
  const listed = registry.filter((x) => x.listed);
  // WHAT IS MADE HERE COMES BEFORE HOW THE PLACE WORKS. A visitor should not
  // have to follow a business model to find out what is for sale.
  const body = `
<h1>${esc(f.name)}</h1>
<p class="lede">${esc(f.tagline.charAt(0).toUpperCase() + f.tagline.slice(1))}.</p>
<h2>What's here now</h2>
${listOf(listed, 'Nothing\'s open at the moment.')}
<h2>About Apex Micro</h2>
${paras(f.statement)}
<p><a href="/experiments">Everything I've made</a> · <a href="/about">More about me</a></p>`;
  return shell(f, f.name, '/', body, `${f.name}: ${f.tagline}.`, { path: '/' });
}

export function renderAbout(f: PublicWorkshopFacts): string {
  const body = `
<h1>About</h1>
${paras(f.statement)}
${f.about ? `<h2>A little more</h2>${paras(f.about)}` : ''}
<h2>How the workshop works</h2>
<p>It looks for small, specific problems where a modest, well-made thing would help — a shortlist somebody would otherwise put together by hand, a deadline that's easy to miss, a set of facts scattered across public sources. Before building anything bigger it tries a small version for real: a proper offer, at a proper price, to a handful of people it might actually suit.</p>
<p>Everything here says what you get, what it costs, whether it repeats (it doesn't, unless a page says so), what it doesn't cover, and where its information comes from. If you buy something and it's no use to you, you can have your money back. If you hear from the workshop and would rather not, one line says so and it won't write again.</p>
<h2>Where the software fits</h2>
<p>Software built here does a lot of the research and the day-to-day running. A person makes the decisions, stands behind the offers and carries the responsibility. If something here is wrong, <a href="/contact">say so</a> and it will be fixed.</p>
<h2>What happens to things it tries</h2>
<dl>
  <dt>Open</dt><dd>You can buy it now, at the price on its page.</dd>
  <dt>Pilot</dt><dd>The first run of something, so nobody knows yet whether it will carry on.</dd>
  <dt>On its own now</dt><dd>It grew into a business of its own; its page here links to where it lives.</dd>
  <dt>Closed</dt><dd>It wasn't worth carrying on with. The page stays, with a short honest note of why.</dd>
</dl>`;
  return shell(f, 'About', '/about', body, `What ${f.name} is and how it works.`, { path: '/about' });
}

export function renderRegistry(f: PublicWorkshopFacts, registry: PublicExperiment[], which: 'all' | 'operating' | 'graduated' | 'closed'): string {
  const listed = registry.filter((x) => x.listed);
  const titles = { all: 'Everything I\'ve made', operating: 'Still going', graduated: 'On their own now', closed: 'Closed' } as const;
  const intro = {
    all: 'Everything I\'ve put in front of people, in the order I made it. Every page stays up, whatever happened to it.',
    operating: 'The ones that worked well enough to keep.',
    graduated: 'The ones that grew into a business of their own. Their page here stays, and points to where they live now.',
    closed: 'The ones that ended, because they didn\'t work well enough or I stopped them. Each keeps its page and a short note of why.',
  } as const;
  const xs = which === 'all' ? listed : listed.filter((x) => x.status === which);
  const empty = { all: 'Nothing\'s open at the moment.', operating: 'Nothing here yet.', graduated: 'Nothing yet.', closed: 'Nothing has closed yet.' } as const;
  const body = `
<h1>${titles[which]}</h1>
<p class="lede">${intro[which]}</p>
${listOf(xs, empty[which])}
${which === 'all' ? `<p class="quiet"><a href="/operating">Still going</a> · <a href="/graduated">On their own now</a> · <a href="/closed">Closed</a></p>` : `<p class="quiet"><a href="/experiments">Everything</a></p>`}`;
  return shell(f, titles[which], '/experiments', body, `${titles[which]}, at ${f.name}.`, { path: which === 'all' ? '/experiments' : `/${which}` });
}

export function renderExperiment(f: PublicWorkshopFacts, x: PublicExperiment): string {
  const number = String(x.number).padStart(3, '0');
  const asking = x.status === 'testing' || x.status === 'operating';
  // THE PRICE IS NOT A REVEAL. It used to sit under its own heading four
  // sections down, which on a phone is two and a half screens below the fold —
  // and a price you have to hunt for reads as a price somebody hoped you would
  // not check. It is said once, plainly, where anyone can see it.
  const priceLine = x.price ? `${amount(x.price)}, once. No subscription, nothing renews.` : '';
  const refundLine = x.price
    ? `If it's no use to you, reply to the delivery email or use the link in it and you get your ${amount(x.price)} back. No time limit, and you don't have to explain.`
    : '';
  // The same promise at two sizes, not twice at full length: five words where a
  // person is deciding, the whole sentence under the heading they would scroll
  // to if they wanted the terms. Saying it fully in both places is how a page
  // starts sounding like it is trying to convince itself.
  const shortRefund = x.price ? `Refundable in full, no time limit.` : '';
  // A MATERIAL TERM IS NOT A FEATURE OF ONE LIFECYCLE STATE.
  //
  // This branch used to replace the price line with "The offer is not open at
  // the moment" whenever the experiment was testing without a payment link —
  // which silently removed "No subscription, nothing renews" from the page, and
  // with it the fact the publication gate and the readiness check both require.
  // An internal state change made the page less honest and nobody said
  // anything. So the terms are printed whenever there is a price, and being
  // closed is said IN ADDITION to them rather than INSTEAD of them.
  const closed = x.status === 'testing'
    ? '<p class="quiet">The offer is not open at the moment.</p>' : '';
  const pay = x.payUrl && x.price ? `<div class="card">
  <p><strong>${esc(priceLine)}</strong></p>
  <p><a class="btn" href="${esc(x.payUrl)}" rel="nofollow">Buy for ${esc(amount(x.price))}</a></p>
  <p class="quiet">${esc(shortRefund)}</p>
</div>` : priceLine ? `<p><strong>${esc(priceLine)}</strong></p>${closed}` : closed;
  // A SPECIMEN BEATS A DESCRIPTION. Three paragraphs about the shape of the
  // thing tell a buyer less than one item of the thing itself, and the item
  // cannot overstate what it is, because it is what arrives.
  const sample = x.sample ? `<div class="card">
  <p class="quiet">Here's one of them, as it appears in the brief:</p>
${paras(x.sample)}
</div>` : '';
  const body = `
<h1>${esc(x.title)}</h1>
<p class="lede">${esc(x.summary)}</p>
<p class="quiet">${x.status === 'testing' ? `A small pilot from ${esc(f.name)}. ` : `<span class="pill">${esc(x.statusLabel)}</span> ${esc(x.statusLine)} `}${esc(f.name)}, ${esc(f.region)}.</p>
${x.graduatedTo ? `<p>It now lives at <a href="${esc(x.graduatedTo)}">${esc(x.graduatedTo.replace(/^https?:\/\//, ''))}</a>.</p>` : ''}
${x.successor ? `<p>It was reframed as <a href="/experiments/${x.successor.slug}">${esc(x.successor.title)}</a>.</p>` : ''}
${x.supersedes ? `<p class="quiet">This continues an earlier design, <a href="/experiments/${x.supersedes.slug}">${esc(x.supersedes.title)}</a>.</p>` : ''}
${pay}
<h2>What you get</h2>
${paras(x.what)}
${sample}
<h2>Why I wrote to you</h2>
${paras(x.selection)}
<p>If you'd rather not hear from me again, <a href="/email">say so here</a> and you won't.</p>
<h2>Who it's for</h2>
${paras(x.who)}
<h2>What it doesn't cover</h2>
${paras(x.limits)}
<h2>Where it comes from</h2>
${paras(x.sources)}
<h2>Who I am</h2>
${paras(x.note)}
${x.clarification ? `<hr>
<h2>Clarification, ${esc(longDate(x.clarification.on))}</h2>
${paras(x.clarification.text)}` : ''}
${asking ? `<h2>Anything you'd like to say?</h2>
<p>If you've got a view, one answer here is enough. I read them before writing to anyone else, and a no here applies to everything I do, not just this.</p>
<form method="POST" action="${x.path}/continue" class="card">
  <label for="c-email">Your email address</label>
  <input id="c-email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="320">
  <fieldset>
    <legend>What should happen next</legend>
    <label class="choice"><input type="radio" name="wants" value="never" required> Don't write to me again</label>
    <label class="choice"><input type="radio" name="wants" value="nothing"> Nothing more, but no hard feelings</label>
    <label class="choice"><input type="radio" name="wants" value="more_like_this"> Send me more like this</label>
    <label class="choice"><input type="radio" name="wants" value="only_unusual"> Only if something really relevant comes up</label>
    <label class="choice"><input type="radio" name="wants" value="would_pay_regularly"> I'd pay for this regularly</label>
    <label class="choice"><input type="radio" name="wants" value="will_explain"> I'll tell you what would make it better</label>
  </fieldset>
  <label for="c-said">Anything you'd like to add (optional)</label>
  <textarea id="c-said" name="said" rows="3" maxlength="2000"></textarea>
  <button class="btn" type="submit">Send</button>
</form>` : ''}

<h2>Refunds, privacy and how to reach me</h2>
${refundLine ? `<p>${esc(refundLine)}</p>` : ''}
<p>Stripe handles the payment and passes me your email address so I can send you the brief. That's all I use it for. There's no tracking in the email or on this site, so the only thing I know is what you choose to tell me — more on the <a href="/privacy">privacy page</a>.</p>
<p>Anything else, <a href="/contact">just write to me</a>.${f.replyRouteProven ? ' Replies to anything I send come straight back to me.' : ''}</p>
<p class="quiet">${x.openedOn ? `Opened ${esc(x.openedOn)}` : 'Not open yet'}${x.closedOn ? ` · Closed ${esc(x.closedOn)}` : ''} · Page updated ${esc(x.updatedOn)}</p>
<p class="quiet"><a href="/experiments">Everything I've made</a></p>`;
  // WHAT IS FOR SALE, SAID IN THE FORM AN INDEX READS. Only while the thing is
  // actually offered: a closed page describes a product no one can buy, and
  // saying otherwise in machine words would be the one lie on the page.
  const product = asking && x.price ? `<script type="application/ld+json">${jsonLd({
    '@context': 'https://schema.org', '@type': 'Product', name: x.title, description: x.summary,
    brand: { '@type': 'Organization', name: f.name },
    offers: { '@type': 'Offer', price: (x.price.amountCents / 100).toFixed(2), priceCurrency: x.price.currency.toUpperCase(), availability: 'https://schema.org/InStock', url: `${f.origin}${x.path}` },
  })}</script>` : undefined;
  return shell(f, x.title, '/experiments', body, x.summary, { path: x.path, head: product });
}

export function renderContact(f: PublicWorkshopFacts): string {
  const body = `
<h1>Contact</h1>
<p class="lede">Email <a href="mailto:${esc(f.contactEmail)}">${esc(f.contactEmail)}</a>. A person reads it.</p>
<p>Replies to anything the workshop sends arrive at the same place. If you bought something and want your money back, there's a link in the delivery email — replying works just as well.</p>
<p>If you'd rather not hear from the workshop again, use the <a href="/email">opt-out page</a> or just say so in a reply.</p>
${f.postalAddress ? `<p>Post: ${postalLines(f.postalAddress).map(esc).join('<br />')}</p>` : ''}`;
  return shell(f, 'Contact', '/contact', body, `How to reach ${f.name}.`, { path: '/contact' });
}

export function renderPrivacy(f: PublicWorkshopFacts): string {
  const body = `
<h1>Privacy</h1>
<p class="lede">This site doesn't collect anything about you. Anything I sell collects only what delivering it needs.</p>
<h2>This site</h2>
<p>No cookies, no analytics, no tracking pixels, no scripts. The pages come off a content network which, like any web server, sees requests as they arrive. Nothing about you is kept here.</p>
<h2>When you buy something</h2>
<p>Stripe handles the payment and passes me your email address so I can send you what you bought, and refund it if you ask. I don't keep a customer database of my own — your address lives in Stripe's records and in the delivery email.</p>
<h2>If I email you</h2>
<p>I write once to a business whose own website suggests something here might be useful to it, at the address that business publishes. The message says what it's about and why you got it. There's no tracking in it, and I don't follow up.</p>
<h2>When you opt out</h2>
<p>Your address goes on a do-not-contact list so nothing from this workshop writes to it again. That's the only reason it's kept.</p>
<h2>Asking</h2>
<p>To see, correct or delete anything I hold about you, <a href="/contact">write to me</a>.</p>`;
  return shell(f, 'Privacy', '/privacy', body, `What ${f.name} collects, which is very little.`, { path: '/privacy' });
}

export function renderEmail(f: PublicWorkshopFacts): string {
  const body = `
<h1>Email &amp; opt-out</h1>
<p class="lede">If you hear from me, it's one message about one thing, and no follow-ups.</p>
<p>To make sure nothing writes to you again, put the address in below. It's kept only on the do-not-contact list, and it covers everything I do.</p>
<form method="POST" action="/email/opt-out">
  <label for="email">Your email address</label>
  <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="320">
  <button class="btn" type="submit">Don't contact me</button>
</form>
<p class="quiet">Replying "stop" to any email from me does the same thing.</p>`;
  return shell(f, 'Email & opt-out', '/email', body, `How ${f.name} uses email, and how to opt out.`, { path: '/email' });
}

export function renderEmailDone(f: PublicWorkshopFacts): string {
  const body = `
<h1>Done</h1>
<p class="lede">That address is on the do-not-contact list. Nothing from me will write to it.</p>
<p><a href="/">Back to ${esc(f.name)}</a></p>`;
  return shell(f, 'Opted out', '/email', body, 'Your address is on the do-not-contact list.', { path: '/email/done' });
}

export function renderThankYou(f: PublicWorkshopFacts): string {
  const body = `
<h1>Thank you</h1>
<p class="lede">That's noted, and it's what decides whether you hear from me again.</p>
<p>If you asked not to be contacted, nothing here will write to you. If you said nothing further was wanted, nothing further gets sent. Anything else you wrote is kept in your own words and read before I write to anyone else.</p>
<p><a href="/">Back to ${esc(f.name)}</a></p>`;
  return shell(f, 'Thank you', '', body, 'Your answer is recorded.', { path: '/thank-you' });
}

export function renderRefunds(f: PublicWorkshopFacts): string {
  const body = `
<h1>Refunds</h1>
<p class="lede">If something you bought is no use to you, you get your money back.</p>
<p>Reply to the delivery email, or use the refund link inside it. Stripe refunds it in full and you keep what was sent. No form, no time limit, and you don't have to explain.</p>
<p>That holds whether or not the thing is still on sale. Closing something stops new sales; it doesn't cancel what was promised to people who already bought.</p>`;
  return shell(f, 'Refunds', '/refunds', body, `How refunds work at ${f.name}.`, { path: '/refunds' });
}

export function renderTerms(f: PublicWorkshopFacts): string {
  const body = `
<h1>Terms</h1>
<p class="lede">Short, because the work is.</p>
<p><strong>Who you're dealing with.</strong> ${esc(f.name)} is a small digital workshop run by ${esc(f.legalOperator)} in ${esc(f.region)}. It isn't a company and doesn't claim to be one.</p>
<p><strong>What you're buying.</strong> Exactly what the page describes, with the limits it states. These are small, early things: made carefully and described honestly, and claiming nothing beyond what their page says.</p>
<p><strong>Price and renewal.</strong> The price on the page, once. Nothing renews unless a page says so, and none does.</p>
<p><strong>Refunds.</strong> In full, on request, as described on the <a href="/refunds">refunds page</a>.</p>
<p><strong>Your information.</strong> As described on the <a href="/privacy">privacy page</a>.</p>
<p><strong>Changes.</strong> Every page says when it was last updated. Closing something stops new sales and leaves what was already promised in force.</p>`;
  return shell(f, 'Terms', '/terms', body, `Terms for experiments at ${f.name}.`, { path: '/terms' });
}

export function renderNotFound(f: PublicWorkshopFacts): string {
  const body = `
<h1>Not here</h1>
<p class="lede">There is no page at that address.</p>
<p><a href="/">${esc(f.name)}</a> · <a href="/experiments">Experiments</a></p>`;
  return shell(f, 'Not found', '', body, 'No page at that address.', { path: '/404' });
}

/** Every page of the site at once, keyed by path. Experiment pages included. */
/** What a crawler may keep: every indexable page and every listed experiment; the unlisted resolve but are not announced. */
export function renderSitemap(f: PublicWorkshopFacts, registry: PublicExperiment[]): string {
  const paths = [...INDEXED_PATHS, ...registry.filter((x) => x.listed).map((x) => x.path)];
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${paths.map((p) => `  <url><loc>${esc(f.origin)}${esc(p)}</loc></url>`).join('\n')}
</urlset>
`;
}

export function renderRobots(f: PublicWorkshopFacts): string {
  return `User-agent: *
Allow: /
Disallow: /email
Disallow: /thank-you
Sitemap: ${f.origin}/sitemap.xml
`;
}

export function renderSite(f: PublicWorkshopFacts, registry: PublicExperiment[]): Map<string, string> {
  const pages = new Map<string, string>();
  pages.set('/robots.txt', renderRobots(f));
  pages.set('/sitemap.xml', renderSitemap(f, registry));
  pages.set('/', renderHome(f, registry));
  pages.set('/about', renderAbout(f));
  pages.set('/experiments', renderRegistry(f, registry, 'all'));
  pages.set('/operating', renderRegistry(f, registry, 'operating'));
  pages.set('/graduated', renderRegistry(f, registry, 'graduated'));
  pages.set('/closed', renderRegistry(f, registry, 'closed'));
  pages.set('/contact', renderContact(f));
  pages.set('/privacy', renderPrivacy(f));
  pages.set('/email', renderEmail(f));
  pages.set('/email/done', renderEmailDone(f));
  pages.set('/thank-you', renderThankYou(f));
  pages.set('/refunds', renderRefunds(f));
  pages.set('/terms', renderTerms(f));
  pages.set('/404', renderNotFound(f));
  for (const x of registry) pages.set(x.path, renderExperiment(f, x));
  return pages;
}
