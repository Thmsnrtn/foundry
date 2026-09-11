import { chromium } from 'playwright-core';
import { readFileSync, writeFileSync, existsSync } from 'fs';
const S = '/tmp/claude-0/-home-user-foundry/d4cb93cc-a320-524c-b78d-6d4f665eccbd/scratchpad/';
const doms = readFileSync(S + 'biz/domains2.txt', 'utf8').trim().split('\n')
  .map((l) => l.split('|')).filter((x) => x.length === 2);
const out = existsSync(S + 'biz/pw.json') ? JSON.parse(readFileSync(S + 'biz/pw.json', 'utf8')) : {};
const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const ctx = await b.newContext({ userAgent: 'Mozilla/5.0 (compatible; ApexMicroResearch/1.0)' });
for (const [name, dom] of doms) {
  if (out[dom]) continue;
  const rec = { name, emails: [], text: '', pages: [] };
  const p = await ctx.newPage();
  p.setDefaultTimeout(15000);
  const tryUrl = async (u) => {
    try {
      await p.goto(u, { waitUntil: 'domcontentloaded', timeout: 15000 });
      await p.waitForTimeout(1200);
      const body = await p.evaluate(() => document.body ? document.body.innerText : '');
      const mails = await p.evaluate(() => Array.from(document.querySelectorAll('a[href^="mailto:"]'))
        .map((a) => a.getAttribute('href').slice(7).split('?')[0]));
      const found = new Set(mails.map((m) => m.toLowerCase().trim()));
      for (const m of (body.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.(?:com|net|org|us)\b/g) || [])) found.add(m.toLowerCase());
      for (const m of found) if (m) rec.emails.push(m);
      rec.text += ' ' + body.slice(0, 6000);
      rec.pages.push(u);
      return body;
    } catch { return ''; }
  };
  const home = await tryUrl(`https://${dom}/`);
  if (home) {
    const links = await p.evaluate(() => Array.from(document.querySelectorAll('a[href]'))
      .map((a) => a.href).filter((h) => /contact|about|commercial|estimat|bid|project|market|team/i.test(h)));
    const uniq = [...new Set(links)].filter((u) => u.includes(dom)).slice(0, 6);
    for (const u of uniq) await tryUrl(u);
  }
  rec.emails = [...new Set(rec.emails)];
  out[dom] = rec;
  writeFileSync(S + 'biz/pw.json', JSON.stringify(out, null, 1));
  console.log(`${dom} :: ${rec.pages.length}p ${rec.emails.length}e ${rec.emails.slice(0,3).join(',')}`);
  await p.close();
}
await b.close();
