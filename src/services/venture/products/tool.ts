// =============================================================================
// FOUNDRY — a free tool: a calculator a stranger can use, beside a paid thing.
//
// THE TOOL IS DATA, NOT CODE. Foundry never writes a program that runs on the
// Workshop's site. A tool is a specification — inputs with ranges, outputs as
// formulas in a small arithmetic language, and worked examples — and ONE
// reviewed program, served by the Workshop's own worker at /tool.js, reads it.
// The site's policy admits that one script and nothing else, and it can reach
// no address (`connect-src` stays 'none'), so a tool can compute and cannot
// send what anybody types.
//
// ONE EVALUATOR, TWO PLACES. The arithmetic below is a single text. The page
// runs it in the reader's browser; the quality gate runs the same text here,
// in an isolated context, to check that the tool reproduces every worked
// example and stays finite across its whole range. A gate that checked a
// second implementation would prove the second implementation.
//
// WHAT THE GATE CANNOT KNOW: whether the formula is the right formula for the
// reader's world. It proves the tool says what it was designed to say, and the
// forge's own adversary is what argues about whether that is worth saying.
// =============================================================================

import { runInNewContext } from 'node:vm';

export interface ToolInput { id: string; label: string; unit: string | null; min: number; max: number; step: number; value: number }
export interface ToolOutput { id: string; label: string; unit: string | null; formula: string; decimals: number }
export interface ToolExample { inputs: Record<string, number>; outputs: Record<string, number> }
export interface ToolSpec { title: string; explains: string; inputs: ToolInput[]; outputs: ToolOutput[]; examples: ToolExample[] }

/**
 * THE ARITHMETIC, as the one text both sides run. Plain ES5 on purpose: it is
 * served to whatever browser a stranger has. Numbers, names, + - * / ^,
 * brackets, and min, max, abs, floor, ceil, round(x[, places]), sqrt. A name
 * is an input or an earlier output and nothing else, so no formula can reach
 * anything the page did not hand it.
 */
export const TOOL_EVALUATOR_JS = `function toolCompute(spec, values) {
  var env = {}, out = {}, i;
  for (i = 0; i < spec.inputs.length; i++) {
    var inp = spec.inputs[i];
    var raw = values[inp.id];
    var v = (raw === '' || raw === null || raw === undefined) ? NaN : Number(raw);
    if (!isFinite(v)) return { ok: false, error: 'Enter a number for ' + inp.label + '.' };
    if (v < inp.min || v > inp.max) return { ok: false, error: inp.label + ' must be between ' + inp.min + ' and ' + inp.max + '.' };
    env['$' + inp.id] = v;
  }
  for (i = 0; i < spec.outputs.length; i++) {
    var o = spec.outputs[i];
    var r = evaluate(o.formula, env);
    if (!r.ok) return r;
    var f = Math.pow(10, o.decimals);
    out[o.id] = Math.round(r.value * f) / f;
    env['$' + o.id] = r.value;
  }
  return { ok: true, outputs: out };

  function evaluate(src, env) {
    var t = [], p = 0, m, rest;
    while (p < src.length) {
      rest = src.slice(p);
      if ((m = /^\\s+/.exec(rest))) { p += m[0].length; continue; }
      if ((m = /^(\\d+(\\.\\d+)?|\\.\\d+)/.exec(rest))) { t.push({ k: 'n', v: Number(m[0]) }); p += m[0].length; continue; }
      if ((m = /^[a-z][a-z0-9_]*/.exec(rest))) { t.push({ k: 'id', v: m[0] }); p += m[0].length; continue; }
      if ('+-*/^(),'.indexOf(rest.charAt(0)) >= 0) { t.push({ k: rest.charAt(0) }); p += 1; continue; }
      return { ok: false, error: 'The formula has a character it cannot read.' };
    }
    var q = 0, err = null;
    function peek() { return t[q] ? t[q].k : null; }
    function fail(e) { if (!err) err = e; return NaN; }
    function expr() { var v = term(); while (peek() === '+' || peek() === '-') { var op = t[q++].k; var w = term(); v = op === '+' ? v + w : v - w; } return v; }
    function term() { var v = unary(); while (peek() === '*' || peek() === '/') { var op = t[q++].k; var w = unary(); if (op === '/' && w === 0) return fail('It would divide by zero.'); v = op === '*' ? v * w : v / w; } return v; }
    function unary() { if (peek() === '-') { q++; return -unary(); } if (peek() === '+') { q++; return unary(); } return power(); }
    function power() { var b = primary(); if (peek() === '^') { q++; var e = unary(); return Math.pow(b, e); } return b; }
    function primary() {
      var k = peek();
      if (k === 'n') return t[q++].v;
      if (k === '(') { q++; var v = expr(); if (peek() !== ')') return fail('A bracket is not closed.'); q++; return v; }
      if (k === 'id') {
        var name = t[q++].v;
        if (peek() === '(') {
          q++; var args = [];
          if (peek() !== ')') { args.push(expr()); while (peek() === ',') { q++; args.push(expr()); } }
          if (peek() !== ')') return fail('A bracket is not closed.');
          q++;
          return call(name, args);
        }
        if (!Object.prototype.hasOwnProperty.call(env, '$' + name)) return fail('It names something it was not given: ' + name + '.');
        return env['$' + name];
      }
      return fail('The formula is incomplete.');
    }
    function call(name, a) {
      if (name === 'min' && a.length >= 1) return Math.min.apply(null, a);
      if (name === 'max' && a.length >= 1) return Math.max.apply(null, a);
      if (name === 'abs' && a.length === 1) return Math.abs(a[0]);
      if (name === 'floor' && a.length === 1) return Math.floor(a[0]);
      if (name === 'ceil' && a.length === 1) return Math.ceil(a[0]);
      if (name === 'sqrt' && a.length === 1) { if (a[0] < 0) return fail('It would take the square root of a negative number.'); return Math.sqrt(a[0]); }
      if (name === 'round' && (a.length === 1 || a.length === 2)) { var f = Math.pow(10, a.length === 2 ? a[1] : 0); return Math.round(a[0] * f) / f; }
      return fail('It uses a calculation it does not know: ' + name + '.');
    }
    var value = expr();
    if (!err && q < t.length) err = 'The formula has something left over.';
    if (err) return { ok: false, error: err };
    if (!isFinite(value)) return { ok: false, error: 'The answer is not a finite number.' };
    return { ok: true, value: value };
  }
}`;

/**
 * THE ONE PROGRAM THE SITE RUNS, served by the worker at /tool.js. It reads the
 * page's own specification, computes as the reader types, and writes the
 * answers as text. It has no network, no storage and no other page to reach.
 */
export const TOOL_RUNTIME_JS = `${TOOL_EVALUATOR_JS}
(function () {
  var holder = document.getElementById('tool-spec');
  var form = document.getElementById('tool');
  if (!holder || !form) return;
  var spec;
  try { spec = JSON.parse(holder.textContent); } catch (e) { return; }
  function show() {
    var values = {}, i;
    for (i = 0; i < spec.inputs.length; i++) {
      var field = document.getElementById('tool-in-' + spec.inputs[i].id);
      values[spec.inputs[i].id] = field ? field.value : '';
    }
    var r = toolCompute(spec, values);
    var said = document.getElementById('tool-error');
    for (i = 0; i < spec.outputs.length; i++) {
      var o = spec.outputs[i];
      var cell = document.getElementById('tool-out-' + o.id);
      if (!cell) continue;
      cell.textContent = r.ok ? r.outputs[o.id].toLocaleString(undefined, { minimumFractionDigits: o.decimals, maximumFractionDigits: o.decimals }) : '—';
    }
    if (said) said.textContent = r.ok ? '' : r.error;
  }
  form.addEventListener('input', show);
  form.addEventListener('submit', function (e) { e.preventDefault(); show(); });
  show();
})();
`;

type Computed = { ok: true; outputs: Record<string, number> } | { ok: false; error: string };

/** The same text, run here, in a context that holds nothing but the arithmetic. */
export function compute(spec: ToolSpec, values: Record<string, number | string>): Computed {
  const sandbox: { toolCompute?: (s: unknown, v: unknown) => Computed } = {};
  runInNewContext(`${TOOL_EVALUATOR_JS}\nthis.toolCompute = toolCompute;`, sandbox, { timeout: 200 });
  // A plain copy crosses into the context, so nothing of this process does.
  return JSON.parse(JSON.stringify(sandbox.toolCompute!(JSON.parse(JSON.stringify(spec)), JSON.parse(JSON.stringify(values))))) as Computed;
}

const ID = /^[a-z][a-z0-9_]{0,23}$/;
const RESERVED = new Set(['min', 'max', 'abs', 'floor', 'ceil', 'round', 'sqrt']);
const ADDRESSY = /https?:\/\/|www\.|@[a-z0-9-]+\.[a-z]/i;
const text = (s: unknown, lo: number, hi: number): boolean => typeof s === 'string' && s.trim().length >= lo && s.trim().length <= hi;
const finite = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n) && Math.abs(n) <= 1e9;

/**
 * THE GATE A TOOL PASSES BEFORE ANYBODY SEES IT. An empty list means it may be
 * published; anything else is said back to whatever composed it, and nothing
 * is published.
 */
export function checkToolQuality(spec: ToolSpec, bannedClaims: readonly string[] = []): string[] {
  const problems: string[] = [];
  if (!text(spec?.title, 3, 80)) problems.push('the tool needs a title of 3 to 80 characters');
  if (!text(spec?.explains, 10, 400)) problems.push('the tool needs a sentence of 10 to 400 characters saying what it works out');
  const inputs = Array.isArray(spec?.inputs) ? spec.inputs : [];
  const outputs = Array.isArray(spec?.outputs) ? spec.outputs : [];
  const examples = Array.isArray(spec?.examples) ? spec.examples : [];
  if (inputs.length < 1 || inputs.length > 8) problems.push('a tool takes 1 to 8 numbers');
  if (outputs.length < 1 || outputs.length > 6) problems.push('a tool gives 1 to 6 answers');
  if (examples.length < 2 || examples.length > 6) problems.push('a tool carries 2 to 6 worked examples');
  const seen = new Set<string>();
  for (const x of [...inputs, ...outputs]) {
    if (!ID.test(String(x?.id)) || RESERVED.has(String(x?.id))) problems.push(`"${String(x?.id)}" is not a usable name`);
    else if (seen.has(x.id)) problems.push(`"${x.id}" is named twice`);
    seen.add(String(x?.id));
    if (!text(x?.label, 1, 60)) problems.push(`"${String(x?.id)}" needs a label of 1 to 60 characters`);
    if (x?.unit !== null && x?.unit !== undefined && !text(x.unit, 1, 16)) problems.push(`the unit of "${String(x?.id)}" is not a short word`);
  }
  for (const i of inputs) {
    if (![i.min, i.max, i.step, i.value].every(finite)) { problems.push(`"${i.id}" needs a finite range, step and starting value`); continue; }
    if (!(i.min < i.max)) problems.push(`"${i.id}" has a range that is empty`);
    if (!(i.step > 0)) problems.push(`"${i.id}" needs a step above zero`);
    if (i.value < i.min || i.value > i.max) problems.push(`"${i.id}" starts outside its own range`);
  }
  for (const o of outputs) {
    if (!Number.isInteger(o.decimals) || o.decimals < 0 || o.decimals > 4) problems.push(`"${o.id}" shows 0 to 4 decimal places`);
    if (!text(o.formula, 1, 300)) problems.push(`"${o.id}" needs a formula of at most 300 characters`);
  }
  const words = [spec?.title, spec?.explains, ...inputs.map((i) => i?.label), ...outputs.map((o) => o?.label)].map((s) => String(s ?? '')).join(' ');
  if (ADDRESSY.test(words)) problems.push('a tool carries no addresses');
  const lower = words.toLowerCase();
  for (const b of bannedClaims) if (lower.includes(b.toLowerCase())) problems.push(`the tool claims "${b}"`);
  if (problems.length) return problems;

  // EVERY WORKED EXAMPLE, REPRODUCED by the same arithmetic the page runs.
  for (const [n, ex] of examples.entries()) {
    const r = compute(spec, ex.inputs ?? {});
    if (!r.ok) { problems.push(`example ${String(n + 1)} does not compute: ${r.error}`); continue; }
    for (const o of outputs) {
      const want = ex.outputs?.[o.id];
      if (!finite(want)) { problems.push(`example ${String(n + 1)} does not say what ${o.id} should be`); continue; }
      const f = 10 ** o.decimals;
      if (Math.round(want * f) / f !== r.outputs[o.id]) problems.push(`example ${String(n + 1)}: ${o.id} should be ${String(want)} but the tool says ${String(r.outputs[o.id])}`);
    }
  }
  // AND ITS WHOLE RANGE: the starting values, and every corner of the inputs
  // (or each input at its ends, when the corners would be too many), must all
  // give finite answers. A tool that breaks at its own limits is not published.
  const base: Record<string, number> = Object.fromEntries(inputs.map((i) => [i.id, i.value]));
  const points: Array<Record<string, number>> = [base];
  if (inputs.length <= 6) {
    for (let mask = 0; mask < 2 ** inputs.length; mask++) {
      points.push(Object.fromEntries(inputs.map((i, k) => [i.id, (mask >> k) & 1 ? i.max : i.min])));
    }
  } else {
    for (const i of inputs) { points.push({ ...base, [i.id]: i.min }); points.push({ ...base, [i.id]: i.max }); }
  }
  for (const pt of points) {
    const r = compute(spec, pt);
    if (!r.ok) { problems.push(`at ${JSON.stringify(pt)} it fails: ${r.error}`); break; }
  }
  return problems;
}

/** A specification as a composition sent it, read strictly: anything else is not a tool. */
export function toolFrom(raw: unknown): ToolSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const arr = (v: unknown): Array<Record<string, unknown>> => (Array.isArray(v) ? v.filter((x) => x && typeof x === 'object') as Array<Record<string, unknown>> : []);
  const unit = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const nums = (v: unknown): Record<string, number> => Object.fromEntries(Object.entries((v && typeof v === 'object' ? v : {}) as Record<string, unknown>).map(([k, x]) => [k, Number(x)]));
  return {
    title: String(r.title ?? '').trim(), explains: String(r.explains ?? '').trim(),
    inputs: arr(r.inputs).map((i) => ({ id: String(i.id ?? ''), label: String(i.label ?? '').trim(), unit: unit(i.unit),
      min: Number(i.min), max: Number(i.max), step: Number(i.step), value: Number(i.value) })),
    outputs: arr(r.outputs).map((o) => ({ id: String(o.id ?? ''), label: String(o.label ?? '').trim(), unit: unit(o.unit),
      formula: String(o.formula ?? ''), decimals: Number(o.decimals) })),
    examples: arr(r.examples).map((e) => ({ inputs: nums(e.inputs), outputs: nums(e.outputs) })),
  };
}
