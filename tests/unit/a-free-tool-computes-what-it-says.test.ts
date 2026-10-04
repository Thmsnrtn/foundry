// =============================================================================
// A FREE TOOL COMPUTES WHAT IT SAYS, AND CAN DO NOTHING ELSE.
//
//   the owner allowed "a free tool beside a paid product" (PENDING 20, 31) →
//   the exchange becomes available in the change that can run it, and the
//   others stay unavailable → a tool is data, computed by one reviewed program
//   → the gate reproduces every worked example with the same arithmetic the
//   page runs, and refuses one that is wrong or breaks inside its range → a
//   formula can name only what it was given → the site serves that program
//   from its own text, never from the store Foundry writes → the page carries
//   the checked specification, escaped, and no script but the Workshop's own.
// =============================================================================

process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '7'.repeat(64);

import { beforeAll, describe, expect, it } from 'vitest';
import { runInNewContext } from 'node:vm';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { TOOL_EVALUATOR_JS, TOOL_RUNTIME_JS, checkToolQuality, compute, toolFrom, type ToolSpec } from '../../src/services/venture/products/tool.js';
import { WORKER_SOURCE } from '../../src/services/public-workshop/worker-source.js';
import { renderTool } from '../../src/services/public-workshop/site.js';
import { KINDS } from '../../src/services/venture/products/registry.js';
import { EXCHANGES_THE_HANDS_CARRY } from '../../src/services/venture/products/offer-composition.js';
import { BANNED_CLAIMS } from '../../src/services/venture/hand.js';

// A bid's worth: what a won job is worth to you, after the hours it takes to bid.
const MARKUP: ToolSpec = {
  title: 'Is this bid worth the hours?',
  explains: 'Works out what a bid is worth once you allow for how often you win and what your bidding hours cost.',
  inputs: [
    { id: 'value', label: 'Job value', unit: 'USD', min: 100, max: 1_000_000, step: 100, value: 20_000 },
    { id: 'margin', label: 'Your margin', unit: '%', min: 1, max: 60, step: 1, value: 15 },
    { id: 'win_rate', label: 'Chance you win it', unit: '%', min: 1, max: 100, step: 1, value: 25 },
    { id: 'hours', label: 'Hours to bid', unit: 'hours', min: 0.5, max: 200, step: 0.5, value: 6 },
    { id: 'rate', label: 'Your hour is worth', unit: 'USD', min: 0, max: 500, step: 5, value: 60 },
  ],
  outputs: [
    { id: 'expected', label: 'Expected profit', unit: 'USD', formula: 'value * margin / 100 * win_rate / 100', decimals: 0 },
    { id: 'cost', label: 'Cost of bidding', unit: 'USD', formula: 'hours * rate', decimals: 0 },
    { id: 'net', label: 'Worth it by', unit: 'USD', formula: 'expected - cost', decimals: 0 },
  ],
  examples: [
    { inputs: { value: 20_000, margin: 15, win_rate: 25, hours: 6, rate: 60 }, outputs: { expected: 750, cost: 360, net: 390 } },
    { inputs: { value: 5_000, margin: 10, win_rate: 20, hours: 4, rate: 50 }, outputs: { expected: 100, cost: 200, net: -100 } },
  ],
};

beforeAll(async () => { await runMigrations(); });

describe('the owner\'s word, and no further', () => {
  it('makes a free thing with a role available, and leaves the exchanges nothing can run yet', async () => {
    const rows = (await query('SELECT exchange, available FROM probe_exchanges', [])).rows as unknown as Array<{ exchange: string; available: number }>;
    const on = rows.filter((r) => Number(r.available) === 1).map((r) => r.exchange).sort();
    // 'subscription' since R19 (migration 381), when a subscription can be stopped.
    expect(on).toEqual(['free_with_role', 'subscription', 'upfront_price', 'value_first']);
    expect([...EXCHANGES_THE_HANDS_CARRY].sort()).toEqual(on);
    expect(KINDS.find((k) => k.kind === 'static_tool')!.canMake).toBe(true);
  });
});

describe('one arithmetic, run where it is checked and where it is used', () => {
  it('the page\'s program carries the gate\'s arithmetic word for word', () => {
    expect(TOOL_RUNTIME_JS.startsWith(TOOL_EVALUATOR_JS)).toBe(true);
    const ctx: { toolCompute?: (s: unknown, v: unknown) => unknown } = {};
    runInNewContext(`${TOOL_EVALUATOR_JS}\nthis.toolCompute = toolCompute;`, ctx);
    for (const ex of MARKUP.examples) {
      expect(JSON.parse(JSON.stringify(ctx.toolCompute!(MARKUP, ex.inputs)))).toEqual(compute(MARKUP, ex.inputs));
    }
  });

  it('respects precedence, brackets, powers and its functions', () => {
    const one = (formula: string, decimals = 4): unknown => compute({ ...MARKUP, inputs: [{ id: 'a', label: 'a', unit: null, min: -10, max: 10, step: 1, value: 2 }],
      outputs: [{ id: 'r', label: 'r', unit: null, formula, decimals }] }, { a: 2 });
    expect(one('1 + 2 * 3')).toEqual({ ok: true, outputs: { r: 7 } });
    expect(one('(1 + 2) * 3')).toEqual({ ok: true, outputs: { r: 9 } });
    expect(one('2 ^ 3 ^ 2')).toEqual({ ok: true, outputs: { r: 512 } });
    expect(one('-a ^ 2')).toEqual({ ok: true, outputs: { r: -4 } });
    expect(one('2 ^ -1')).toEqual({ ok: true, outputs: { r: 0.5 } });
    expect(one('10 - 2 - 3')).toEqual({ ok: true, outputs: { r: 5 } });
    expect(one('12 / 3 / 2')).toEqual({ ok: true, outputs: { r: 2 } });
    expect(one('max(a, 5) + min(a, 1) + abs(-3) + round(2.345, 2) + sqrt(16) + floor(1.9) + ceil(1.1)')).toEqual({ ok: true, outputs: { r: 18.35 } });
  });

  it('refuses what it cannot compute, and says why in words', () => {
    const one = (formula: string, a = 2): { ok: boolean; error?: string } => compute({ ...MARKUP, inputs: [{ id: 'a', label: 'A', unit: null, min: -10, max: 10, step: 1, value: 2 }],
      outputs: [{ id: 'r', label: 'r', unit: null, formula, decimals: 2 }] }, { a }) as { ok: boolean; error?: string };
    expect(one('1 / (a - 2)').error).toMatch(/divide by zero/);
    expect(one('sqrt(a - 5)').error).toMatch(/square root/);
    expect(one('(1 + 2').error).toMatch(/bracket/);
    expect(one('1 +').error).toMatch(/incomplete/);
    expect(one('2 2').error).toMatch(/left over/);
    expect(compute(MARKUP, { ...MARKUP.examples[0]!.inputs, margin: 99 })).toMatchObject({ ok: false, error: expect.stringMatching(/between 1 and 60/) });
    expect(compute(MARKUP, { ...MARKUP.examples[0]!.inputs, hours: '' })).toMatchObject({ ok: false, error: expect.stringMatching(/Enter a number/) });
  });

  it('can name only what it was given: nothing of the page, the process or the language', () => {
    for (const reach of ['constructor', 'process', 'globalthis', 'this', 'tostring', 'eval', 'require', 'fetch', 'document']) {
      const r = compute({ ...MARKUP, outputs: [{ id: 'r', label: 'r', unit: null, formula: `${reach} + 1`, decimals: 0 }] }, MARKUP.examples[0]!.inputs);
      expect(r.ok, reach).toBe(false);
    }
    for (const call of ['constructor(1)', 'eval(1)', 'fetch(1)', 'tostring(1)']) {
      expect(compute({ ...MARKUP, outputs: [{ id: 'r', label: 'r', unit: null, formula: call, decimals: 0 }] }, MARKUP.examples[0]!.inputs).ok, call).toBe(false);
    }
    for (const odd of ['a["x"]', 'a.b', '`x`', "'x'", 'a;b', 'a=1', '[1]']) {
      expect(compute({ ...MARKUP, outputs: [{ id: 'r', label: 'r', unit: null, formula: odd, decimals: 0 }] }, MARKUP.examples[0]!.inputs).ok, odd).toBe(false);
    }
  });
});

describe('the gate a tool passes before anybody sees it', () => {
  it('passes a tool whose worked examples are right and whose range holds', () => {
    expect(checkToolQuality(MARKUP, BANNED_CLAIMS)).toEqual([]);
  });

  it('refuses a worked example the arithmetic does not reproduce', () => {
    const wrong = { ...MARKUP, examples: [MARKUP.examples[0]!, { ...MARKUP.examples[1]!, outputs: { expected: 100, cost: 200, net: 100 } }] };
    expect(checkToolQuality(wrong).join(' ')).toMatch(/example 2: net should be 100 but the tool says -100/);
  });

  it('refuses a tool that breaks inside its own range', () => {
    const breaks = { ...MARKUP, outputs: [...MARKUP.outputs, { id: 'per_hour', label: 'Per hour', unit: null, formula: 'net / rate', decimals: 2 }],
      examples: MARKUP.examples.map((e) => ({ ...e, outputs: { ...e.outputs, per_hour: e.outputs.net! / e.inputs.rate! } })) };
    expect(checkToolQuality(breaks).join(' ')).toMatch(/divide by zero/);
  });

  it('refuses a formula that reaches for an answer not yet worked out', () => {
    const early = { ...MARKUP, outputs: [{ ...MARKUP.outputs[0]!, formula: 'net + 1' }, ...MARKUP.outputs.slice(1)] };
    expect(checkToolQuality(early).join(' ')).toMatch(/names something it was not given: net/);
  });

  it('refuses addresses, banned claims, bad names and too much', () => {
    expect(checkToolQuality({ ...MARKUP, explains: 'See https://example.com for more on whether a bid is worth it.' }).join(' ')).toMatch(/no addresses/);
    expect(checkToolQuality({ ...MARKUP, title: 'Guaranteed bid winner' }, BANNED_CLAIMS).join(' ')).toMatch(/claims "guarantee/);
    expect(checkToolQuality({ ...MARKUP, inputs: [{ ...MARKUP.inputs[0]!, id: 'Value' }, ...MARKUP.inputs.slice(1)] }).join(' ')).toMatch(/not a usable name/);
    expect(checkToolQuality({ ...MARKUP, inputs: [{ ...MARKUP.inputs[0]!, id: 'max' }, ...MARKUP.inputs.slice(1)] }).join(' ')).toMatch(/not a usable name/);
    const many = Array.from({ length: 9 }, (_, i) => ({ ...MARKUP.inputs[0]!, id: `x${String(i)}` }));
    expect(checkToolQuality({ ...MARKUP, inputs: many }).join(' ')).toMatch(/1 to 8 numbers/);
    expect(checkToolQuality({ ...MARKUP, examples: [MARKUP.examples[0]!] }).join(' ')).toMatch(/2 to 6 worked examples/);
  });

  it('reads a composition strictly: anything not a tool is not one', () => {
    expect(toolFrom(null)).toBeNull();
    expect(toolFrom('a tool')).toBeNull();
    expect(checkToolQuality(toolFrom({ title: 'x' })!).length).toBeGreaterThan(0);
    expect(checkToolQuality(toolFrom(JSON.parse(JSON.stringify(MARKUP)))!, BANNED_CLAIMS)).toEqual([]);
  });
});

describe('the site runs one program, its own', () => {
  type Worker = { fetch: (r: Request, env: unknown) => Promise<Response> };
  let worker: Worker;
  const store = new Map<string, string>([['page:/tool.js', 'alert("not reviewed")'], ['page:/404', 'nope']]);
  const env = { PAGES: { get: async (k: string) => store.get(k) ?? null, put: async () => undefined } };
  beforeAll(async () => {
    worker = (await import(`data:text/javascript,${encodeURIComponent(WORKER_SOURCE)}`) as { default: Worker }).default;
  });

  it('serves /tool.js from its reviewed text, never from the store Foundry writes', async () => {
    const r = await worker.fetch(new Request('https://apexmicro.ai/tool.js'), env);
    expect(r.status).toBe(200);
    expect(r.headers.get('content-type')).toMatch(/^text\/javascript/);
    expect(await r.text()).toBe(TOOL_RUNTIME_JS);
  });

  it('admits same-origin script only, and still lets nothing connect anywhere', async () => {
    const r = await worker.fetch(new Request('https://apexmicro.ai/tool.js'), env);
    const csp = r.headers.get('content-security-policy') ?? '';
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/connect-src|unsafe-eval|script-src[^;]*unsafe-inline/);
    expect(r.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('serves any other path as a page, not as a script', async () => {
    const r = await worker.fetch(new Request('https://apexmicro.ai/tool'), env);
    expect(r.headers.get('content-type')).toMatch(/^text\/html/);
  });

  it('the program has no way to send anything', () => {
    expect(TOOL_RUNTIME_JS).not.toMatch(/fetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket|localStorage|sessionStorage|document\.cookie|new Image|\.src\s*=|innerHTML|eval\s*\(|Function\s*\(/);
  });
});

describe('the page carries the tool, and only the tool', () => {
  it('renders the form, the checked specification, the worked examples and the one script', () => {
    const html = renderTool(MARKUP);
    expect(html).toContain('<form id="tool" novalidate>');
    for (const i of MARKUP.inputs) expect(html).toContain(`id="tool-in-${i.id}"`);
    for (const o of MARKUP.outputs) expect(html).toContain(`id="tool-out-${o.id}"`);
    expect(html).toContain('<script src="/tool.js" defer></script>');
    expect(html).toContain('Nothing you type is sent anywhere');
    const data = /<script type="application\/json" id="tool-spec">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(data)).toEqual(MARKUP);
  });

  it('cannot be closed from inside by anything a composition wrote', () => {
    const hostile = { ...MARKUP, title: 'Bid check </script><script>alert(1)</script>' };
    const html = renderTool(hostile);
    expect(html.match(/<script/g)!.length).toBe(2);
    expect(html).not.toContain('<script>alert');
    const data = /<script type="application\/json" id="tool-spec">([\s\S]*?)<\/script>/.exec(html)![1]!;
    expect(JSON.parse(data).title).toBe(hostile.title);
  });
});
