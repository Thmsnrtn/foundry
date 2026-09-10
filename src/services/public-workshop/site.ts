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

function shell(f: PublicWorkshopFacts, title: string, current: string, body: string, description: string): string {
  const nav = [['/', 'Home'], ['/about', 'About'], ['/experiments', 'Experiments'], ['/contact', 'Contact']] as const;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(title === f.name ? f.name : `${title} · ${f.name}`)}</title>
<meta name="description" content="${esc(description)}">
<meta name="referrer" content="no-referrer">
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
  <p><strong>${esc(f.name)}</strong> is an independent digital workshop operated by ${esc(f.operator)}, ${esc(f.region)}.</p>
  <p><a href="/contact">Contact</a> · <a href="/privacy">Privacy</a> · <a href="/email">Email &amp; opt-out</a> · <a href="/refunds">Refunds</a> · <a href="/terms">Terms</a></p>
  ${f.postalAddress ? `<p>${postalLines(f.postalAddress).map(esc).join('<br />')}</p>` : ''}
</footer>
</body>
</html>
`;
}

const item = (x: PublicExperiment): string => `<a class="item" href="${x.path}">
  <div class="t">Experiment ${String(x.number).padStart(3, '0')} — ${esc(x.title)}<span class="pill">${x.statusLabel}</span></div>
  <div class="s">${esc(x.summary)}</div>
</a>`;

const listOf = (xs: PublicExperiment[], empty: string): string => xs.length ? `<div class="list">${xs.map(item).join('\n')}</div>` : `<p class="quiet">${empty}</p>`;

export function renderHome(f: PublicWorkshopFacts, registry: PublicExperiment[]): string {
  const listed = registry.filter((x) => x.listed);
  const body = `
<h1>${esc(f.name)}</h1>
<p class="lede">${esc(f.tagline.charAt(0).toUpperCase() + f.tagline.slice(1))}.</p>
${paras(f.statement)}
<h2>Open now</h2>
${listOf(listed, 'Nothing is open at the moment.')}
<h2>How this works</h2>
<p>Each thing here is one small, clearly labelled offering: a report, a monitor, a dataset, a small service. It has a fixed price, says exactly what you get, says what it does not cover, and gives you a way to reach me. Some turn out to be worth continuing and stay here. A few grow into a business of their own. The rest are closed, and their page stays up saying so.</p>
<p><a href="/experiments">All experiments</a> · <a href="/about">About ${esc(f.operator)}</a></p>`;
  return shell(f, f.name, '/', body, `${f.name}: ${f.tagline}. Small, clearly labeled experiments in useful niche products and services.`);
}

export function renderAbout(f: PublicWorkshopFacts): string {
  const body = `
<h1>About</h1>
<p class="lede">${esc(f.name)} is run by one person, ${esc(f.operator)}, from ${esc(f.region)}.</p>
${paras(f.statement)}
${f.about ? `<h2>A little more</h2>${paras(f.about)}` : ''}
<h2>How the workshop works</h2>
<p>I look for small, specific problems where a modest, well-made thing would help: a shortlist somebody would otherwise assemble by hand, a monitor for a deadline that is easy to miss, a dataset that is scattered across public sources. Before building anything larger I run a small experiment: a real offer, at a real price, to a small number of people for whom it is plausibly relevant.</p>
<p>Everything here states what you get, what it costs, whether it recurs (by default it does not), what it does not cover, and where its information comes from. If you buy something and it is not useful, you can have your money back. If you hear from me and would rather not, one message tells me so and I will not write again.</p>
<h2>Accountability</h2>
<p>I use software I have built to help with research and operations. The decisions, the offers and the responsibility are mine. If something on this site is wrong, <a href="/contact">tell me</a> and I will fix it.</p>
<h2>What happens to experiments</h2>
<dl>
  <dt>Pilot</dt><dd>A live first run, with a stated price and scope.</dd>
  <dt>Operating</dt><dd>It worked well enough to keep as a small product here.</dd>
  <dt>Graduated</dt><dd>It grew into a business of its own; its page here links to where it lives now.</dd>
  <dt>Closed</dt><dd>It was not worth continuing. The page stays, with a short honest note of why.</dd>
</dl>`;
  return shell(f, 'About', '/about', body, `Who is behind ${f.name} and how its experiments work.`);
}

export function renderRegistry(f: PublicWorkshopFacts, registry: PublicExperiment[], which: 'all' | 'operating' | 'graduated' | 'closed'): string {
  const listed = registry.filter((x) => x.listed);
  const titles = { all: 'Experiments', operating: 'Operating', graduated: 'Graduated', closed: 'Closed' } as const;
  const intro = {
    all: 'Everything Apex Micro has offered to anybody, numbered in the order it began. Every page stays up, whatever happened to it.',
    operating: 'Things that worked well enough to keep as small products here.',
    graduated: 'Things that grew into a business of their own. Their record here stays, and links to where they live now.',
    closed: 'Things that ended — they did not work well enough to keep going, or they were stopped. Each keeps its page and a short note of why.',
  } as const;
  const xs = which === 'all' ? listed : listed.filter((x) => x.status === which);
  const empty = { all: 'Nothing is open at the moment.', operating: 'Nothing is operating here yet.', graduated: 'Nothing has graduated yet.', closed: 'Nothing has closed yet.' } as const;
  const body = `
<h1>${titles[which]}</h1>
<p class="lede">${intro[which]}</p>
${listOf(xs, empty[which])}
${which === 'all' ? `<p class="quiet"><a href="/operating">Operating</a> · <a href="/graduated">Graduated</a> · <a href="/closed">Closed</a></p>` : `<p class="quiet"><a href="/experiments">All experiments</a></p>`}`;
  return shell(f, titles[which], '/experiments', body, `${titles[which]} experiments at ${f.name}.`);
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
    ? `If it isn't useful, reply to the delivery email or use the link in it and you get the whole ${amount(x.price)} back. No time limit, and you do not have to explain.`
    : '';
  // The same promise at two sizes, not twice at full length: five words where a
  // person is deciding, the whole sentence under the heading they would scroll
  // to if they wanted the terms. Saying it fully in both places is how a page
  // starts sounding like it is trying to convince itself.
  const shortRefund = x.price ? `Refundable in full, no time limit.` : '';
  const pay = x.payUrl && x.price ? `<div class="card">
  <p><strong>${esc(priceLine)}</strong></p>
  <p><a class="btn" href="${esc(x.payUrl)}" rel="nofollow">Buy for ${esc(amount(x.price))}</a></p>
  <p class="quiet">${esc(shortRefund)}</p>
</div>` : x.status === 'testing' ? '<p class="quiet">The offer is not open at the moment.</p>'
    : priceLine ? `<p><strong>${esc(priceLine)}</strong></p>` : '';
  // A SPECIMEN BEATS A DESCRIPTION. Three paragraphs about the shape of the
  // thing tell a buyer less than one item of the thing itself, and the item
  // cannot overstate what it is, because it is what arrives.
  const sample = x.sample ? `<div class="card">
  <p class="quiet">One of them, exactly as it appears in the brief:</p>
${paras(x.sample)}
</div>` : '';
  const body = `
<h1>${esc(x.title)}</h1>
<p class="lede">${esc(x.summary)}</p>
<p><span class="pill">${esc(x.statusLabel)}</span> <strong>${esc(x.statusLine)}</strong></p>
<p class="quiet">${esc(f.operator)} · ${esc(f.name)} · ${esc(f.region)}</p>
${x.graduatedTo ? `<p>It now lives at <a href="${esc(x.graduatedTo)}">${esc(x.graduatedTo.replace(/^https?:\/\//, ''))}</a>.</p>` : ''}
${x.successor ? `<p>It was reframed as <a href="/experiments/${x.successor.slug}">${esc(x.successor.title)}</a>.</p>` : ''}
${x.supersedes ? `<p class="quiet">This continues an earlier design, <a href="/experiments/${x.supersedes.slug}">${esc(x.supersedes.title)}</a>.</p>` : ''}
${pay}
<h2>What you get</h2>
${paras(x.what)}
${sample}
<h2>Why I wrote to you</h2>
${paras(x.selection)}
<p>If you would rather not hear from ${esc(f.name)} again, <a href="/email">say so here</a> and you will not.</p>
<h2>Who it's for</h2>
${paras(x.who)}
<h2>What it doesn't cover</h2>
${paras(x.limits)}
<h2>Where the information comes from</h2>
${paras(x.sources)}
<h2>Who I am</h2>
${paras(x.note)}
${asking ? `<h2>What would you like next?</h2>
<p>If you received this and have a view, one answer here is enough. What you say is read before ${esc(f.name)} writes to anybody again, and a no here is honoured everywhere, not just for this.</p>
<form method="POST" action="${x.path}/continue" class="card">
  <label for="c-email">Your email address</label>
  <input id="c-email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="320">
  <fieldset>
    <legend>What should happen next</legend>
    <label class="choice"><input type="radio" name="wants" value="never" required> Do not contact me again</label>
    <label class="choice"><input type="radio" name="wants" value="nothing"> Nothing further, no objection</label>
    <label class="choice"><input type="radio" name="wants" value="more_like_this"> Send me more of this kind of thing</label>
    <label class="choice"><input type="radio" name="wants" value="only_unusual"> Only when something unusually relevant appears</label>
    <label class="choice"><input type="radio" name="wants" value="would_pay_regularly"> I would pay for this on an ongoing basis</label>
    <label class="choice"><input type="radio" name="wants" value="will_explain"> I will tell you what would make it more useful</label>
  </fieldset>
  <label for="c-said">Anything you want to say (optional)</label>
  <textarea id="c-said" name="said" rows="3" maxlength="2000"></textarea>
  <button class="btn" type="submit">Send</button>
</form>` : ''}

<h2>Refunds, privacy and how to reach me</h2>
${refundLine ? `<p>${esc(refundLine)}</p>` : ''}
<p>If you buy, Stripe takes the payment and passes me your email address so I can send you the brief. I use it for that and nothing else. No tracking pixels, no click tracking, no analytics — not on the email and not on this site, so the only thing I know is what you choose to tell me. More in <a href="/privacy">privacy</a>.</p>
<p>Anything else, <a href="/contact">write to me</a>; replies to any ${esc(f.name)} email reach me directly.</p>
<p class="quiet">Experiment ${number} in ${esc(f.name)}'s record${x.openedOn ? ` · Opened ${esc(x.openedOn)}` : ''}${x.closedOn ? ` · Closed ${esc(x.closedOn)}` : ''} · Updated ${esc(x.updatedOn)}</p>
<p class="quiet"><a href="/experiments">Everything ${esc(f.name)} has tried</a></p>`;
  return shell(f, x.title, '/experiments', body, x.summary);
}

export function renderContact(f: PublicWorkshopFacts): string {
  const body = `
<h1>Contact</h1>
<p class="lede">Email <a href="mailto:${esc(f.contactEmail)}">${esc(f.contactEmail)}</a>. It reaches ${esc(f.operator)} directly.</p>
<p>Replies to any experiment email arrive at the same place. If you bought something and want a refund, the delivery email has a link; replying works too.</p>
<p>If you would rather not hear from ${esc(f.name)} again, use the <a href="/email">opt-out page</a> or say so in a reply.</p>
${f.postalAddress ? `<p>Post: ${postalLines(f.postalAddress).map(esc).join('<br />')}</p>` : ''}`;
  return shell(f, 'Contact', '/contact', body, `How to reach ${f.operator} at ${f.name}.`);
}

export function renderPrivacy(f: PublicWorkshopFacts): string {
  const body = `
<h1>Privacy</h1>
<p class="lede">Plainly: this site collects nothing on its own, and experiments collect only what delivering them requires.</p>
<h2>This site</h2>
<p>No cookies, no analytics, no tracking pixels, no scripts. Pages are served from an edge network which, like any web server, sees requests as they arrive; nothing is stored about you here.</p>
<h2>When you buy something</h2>
<p>Payment is handled by Stripe. Stripe passes me your email address so I can deliver what you bought and refund it if you ask. I do not keep a customer database of my own; the address lives in Stripe's records and in the delivery email.</p>
<h2>When I email you</h2>
<p>An experiment may write once to a business whose public website suggests the experiment is relevant, using a contact address the business has published. The message says which experiment and why. It contains no tracking. I send no follow-ups.</p>
<h2>When you opt out</h2>
<p>Your address is kept on a do-not-contact list so that no future experiment of this workshop writes to it. That is the only reason it is kept.</p>
<h2>Asking</h2>
<p>To see, correct or delete anything I hold about you, <a href="/contact">contact me</a>.</p>`;
  return shell(f, 'Privacy', '/privacy', body, `What ${f.name} collects, which is very little.`);
}

export function renderEmail(f: PublicWorkshopFacts): string {
  const body = `
<h1>Email &amp; opt-out</h1>
<p class="lede">If you hear from ${esc(f.name)}, it is one message about one experiment, sent by ${esc(f.operator)}, with no follow-ups.</p>
<p>To make sure no future experiment writes to you, enter the address below. It is kept only on the do-not-contact list, and applies across everything this workshop does.</p>
<form method="POST" action="/email/opt-out">
  <label for="email">Your email address</label>
  <input id="email" name="email" type="email" inputmode="email" autocomplete="email" required maxlength="320">
  <button class="btn" type="submit">Do not contact me</button>
</form>
<p class="quiet">Replying to any email from me with "stop" does the same thing.</p>`;
  return shell(f, 'Email & opt-out', '/email', body, `How ${f.name} uses email, and how to opt out.`);
}

export function renderEmailDone(f: PublicWorkshopFacts): string {
  const body = `
<h1>Done</h1>
<p class="lede">That address is on the do-not-contact list. No experiment of ${esc(f.name)} will write to it.</p>
<p><a href="/">Back to ${esc(f.name)}</a></p>`;
  return shell(f, 'Opted out', '/email', body, 'Your address is on the do-not-contact list.');
}

export function renderThankYou(f: PublicWorkshopFacts): string {
  const body = `
<h1>Thank you</h1>
<p class="lede">That is recorded, and it is what decides whether you hear from ${esc(f.name)} again.</p>
<p>If you asked not to be contacted, no experiment of this workshop will write to you. If you said nothing further was wanted, nothing further is sent. Anything else you said is kept in your own words and read before the next experiment goes out.</p>
<p><a href="/">Back to ${esc(f.name)}</a></p>`;
  return shell(f, 'Thank you', '', body, 'Your answer is recorded.');
}

export function renderRefunds(f: PublicWorkshopFacts): string {
  const body = `
<h1>Refunds</h1>
<p class="lede">If something you bought from an experiment is not useful to you, you get your money back.</p>
<p>Reply to the delivery email, or use the refund link inside it. The payment is refunded in full through Stripe, and you keep what was sent. There is no form to fill in and no reason required.</p>
<p>Refunds are honored whether or not the experiment is still running. Closing an experiment stops new sales; it does not cancel what was promised to people who already bought.</p>`;
  return shell(f, 'Refunds', '/refunds', body, `How refunds work at ${f.name}.`);
}

export function renderTerms(f: PublicWorkshopFacts): string {
  const body = `
<h1>Terms</h1>
<p class="lede">Short, because the experiments are.</p>
<p><strong>Who you are dealing with.</strong> ${esc(f.name)} is an independent digital workshop operated by ${esc(f.operator)}, ${esc(f.region)}. It is not a company, and it does not claim to be one.</p>
<p><strong>What you are buying.</strong> Exactly what the experiment page describes, with the limits it states. Experiments are pilots: they are made carefully and described honestly, and they do not claim completeness or accuracy beyond what their page says.</p>
<p><strong>Price and renewal.</strong> The price on the page, once. Nothing renews unless a page says so explicitly, and none does today.</p>
<p><strong>Refunds.</strong> In full, on request, as described on the <a href="/refunds">refunds page</a>.</p>
<p><strong>Your information.</strong> As described on the <a href="/privacy">privacy page</a>.</p>
<p><strong>Changes.</strong> Experiment pages record when they were last updated. Closing an experiment stops new sales and leaves existing obligations in force.</p>`;
  return shell(f, 'Terms', '/terms', body, `Terms for experiments at ${f.name}.`);
}

export function renderNotFound(f: PublicWorkshopFacts): string {
  const body = `
<h1>Not here</h1>
<p class="lede">There is no page at that address.</p>
<p><a href="/">${esc(f.name)}</a> · <a href="/experiments">Experiments</a></p>`;
  return shell(f, 'Not found', '', body, 'No page at that address.');
}

/** Every page of the site at once, keyed by path. Experiment pages included. */
export function renderSite(f: PublicWorkshopFacts, registry: PublicExperiment[]): Map<string, string> {
  const pages = new Map<string, string>();
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
