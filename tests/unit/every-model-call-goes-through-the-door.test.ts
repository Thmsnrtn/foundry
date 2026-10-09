// =============================================================================
// EVERY MODEL CALL GOES THROUGH THE DOOR (F1, 9 October 2026).
//
// `services/ai/client.ts` is the one place Foundry pays a model: `callClaude`
// refuses a company that may not spend, reserves the spend atomically against
// the product, founder and global ceilings BEFORE the wire, settles what the
// provider reports, stops at the breaker, refuses a reply carrying the deploy
// marker, and marks a cache breakpoint for the provider's prompt cache. A call
// made anywhere else does none of that, so it is spend nobody bounded and
// nobody can read back.
//
// THE POPULATION IS THE WHOLE SOURCE TREE, not one file: every .ts, .mts, .js
// and .mjs under src/, enumerated here and held to a floor, so a gate that
// silently stopped reading a directory goes red rather than green. Each file
// is PARSED with the TypeScript compiler, never scanned: a comment that names
// a provider is never a call, and a parser never visits one.
//
// THE SHAPES a direct model call can take, each with a canary below that
// plants it and must be found:
//   host        a string or template naming a model provider's API host;
//   completion  a string naming a completion endpoint (any host — a call
//               through a proxy or a self-hosted gateway has the same path);
//   sdk         an import, require or dynamic import of a model SDK;
//   key         a read of a model key or the model base URL from an
//               environment object (you cannot call a paid model without it);
//   model-id    a literal model id: a call that names its own model chose its
//               own tier outside MODELS and outside the price table, so the
//               reservation would be priced at the fallback rate.
//
// THE COUNT OUTSIDE THE DOOR MAY ONLY SHRINK. It is zero; the exemptions are
// listed with their reason, each pinned to a shape AND a file, and an
// exemption that no longer matches anything fails as stale. No exemption is
// possible for `completion` or `sdk`: those are model calls by construction.
// =============================================================================

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

const ROOT = resolve(import.meta.dirname, '../..');
const SRC = join(ROOT, 'src');
const THE_DOOR = 'src/services/ai/client.ts';

type Shape = 'host' | 'completion' | 'sdk' | 'key' | 'model-id';
export const SHAPES: readonly Shape[] = ['host', 'completion', 'sdk', 'key', 'model-id'];

const HOSTS = /\b(openrouter\.ai|api\.anthropic\.com|api\.openai\.com|generativelanguage\.googleapis\.com|api\.mistral\.ai|api\.groq\.com|api\.together\.(xyz|ai)|api\.cohere\.(ai|com)|api\.deepseek\.com|api\.x\.ai|bedrock-runtime\.|aiplatform\.googleapis\.com|api-inference\.huggingface\.co|api\.fireworks\.ai|api\.perplexity\.ai)/i;
const COMPLETION = /(\/chat\/completions\b|\/v1\/messages\b|\/v1\/complete\b|\/v1\/completions\b|\/v1\/responses\b|:generateContent\b|:streamGenerateContent\b|\/api\/generate\b|\/api\/chat\b)/;
const SDKS = /^(@anthropic-ai\/|openai$|openai\/|@google\/generative-ai|@google\/genai|@google-cloud\/vertexai|@mistralai\/|groq-sdk|cohere-ai|ai$|@ai-sdk\/|@openrouter\/|langchain|@langchain\/|ollama|together-ai|@aws-sdk\/client-bedrock-runtime|replicate)/;
const KEYS = /^(OPENROUTER_API_KEY|OPENROUTER_BASE_URL|ANTHROPIC_API_KEY|ANTHROPIC_BASE_URL|OPENAI_API_KEY|OPENAI_BASE_URL|GEMINI_API_KEY|GOOGLE_API_KEY|MISTRAL_API_KEY|GROQ_API_KEY|COHERE_API_KEY|TOGETHER_API_KEY|DEEPSEEK_API_KEY|XAI_API_KEY)$/;
const MODEL_ID = /\b(anthropic\/claude-[a-z0-9]|claude-(opus|sonnet|haiku|instant|[0-9])[-a-z0-9.]*\d|gpt-[0-9][a-z0-9.-]*|o[134]-(mini|preview)|gemini-[0-9]|mistral-(large|medium|small)|llama-?[0-9])/i;

export interface Hit { file: string; line: number; shape: Shape; text: string }

/** Every direct-call shape in one source text, from its parse tree. */
export function directCalls(file: string, source: string): Hit[] {
  const sf = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true,
    file.endsWith('.js') || file.endsWith('.mjs') ? ts.ScriptKind.JS : ts.ScriptKind.TS);
  const hits: Hit[] = [];
  const at = (n: ts.Node, shape: Shape, text: string): void => {
    hits.push({ file, line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1, shape, text: text.slice(0, 120) });
  };
  const textOf = (n: ts.Node): string | null => {
    if (ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) return n.text;
    if (ts.isTemplateHead(n) || ts.isTemplateMiddle(n) || ts.isTemplateTail(n)) return n.text;
    return null;
  };
  const moduleOf = (n: ts.Node): string | null => {
    if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier && ts.isStringLiteral(n.moduleSpecifier)) return n.moduleSpecifier.text;
    if (ts.isCallExpression(n) && n.arguments.length > 0 && ts.isStringLiteralLike(n.arguments[0]!)
      && (n.expression.kind === ts.SyntaxKind.ImportKeyword || (ts.isIdentifier(n.expression) && n.expression.text === 'require'))) return n.arguments[0].text;
    if (ts.isImportEqualsDeclaration(n) && ts.isExternalModuleReference(n.moduleReference) && ts.isStringLiteral(n.moduleReference.expression)) return n.moduleReference.expression.text;
    return null;
  };
  const visit = (n: ts.Node): void => {
    const m = moduleOf(n);
    if (m !== null && SDKS.test(m)) at(n, 'sdk', m);
    const t = textOf(n);
    if (t !== null) {
      if (HOSTS.test(t)) at(n, 'host', t);
      if (COMPLETION.test(t)) at(n, 'completion', t);
      if (MODEL_ID.test(t)) at(n, 'model-id', t);
    }
    // A key read: X.KEY or X['KEY'] — a name in a list of names is not a read.
    if (ts.isPropertyAccessExpression(n) && KEYS.test(n.name.text)) at(n, 'key', n.getText(sf));
    if (ts.isElementAccessExpression(n) && ts.isStringLiteralLike(n.argumentExpression) && KEYS.test(n.argumentExpression.text)) at(n, 'key', n.getText(sf));
    // const { OPENROUTER_API_KEY } = process.env
    if (ts.isBindingElement(n) && KEYS.test((n.propertyName ?? n.name).getText(sf))) at(n, 'key', n.getText(sf));
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return hits;
}

/** THE POPULATION: every script file under src/, at any depth. */
export function population(): string[] {
  const out: string[] = [];
  const walk = (dir: string): void => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(ts|mts|cts|js|mjs|cjs)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(relative(ROOT, p));
    }
  };
  walk(SRC);
  return out.sort();
}

/**
 * WHAT IS ALLOWED OUTSIDE THE DOOR, and why. Pinned to a file AND a shape; no
 * entry may name `completion` or `sdk`.
 */
export const EXEMPT: ReadonlyArray<{ file: string; shape: Shape; because: string }> = [
  { file: 'src/services/ai/model-door.ts', shape: 'host', because: 'reads the credit left on the account (/credits, /key): no completion, no spend' },
  { file: 'src/services/ai/model-door.ts', shape: 'key', because: 'authenticates the credit read with the key the door already uses' },
  { file: 'src/cli/index.ts', shape: 'host', because: 'the operator\'s doctor command lists /models to prove the key reaches the provider: no completion, no spend' },
  { file: 'src/cli/index.ts', shape: 'key', because: 'the doctor command checks the key is set and authenticates the /models read' },
  { file: 'src/routes/internal/health.ts', shape: 'key', because: 'reports whether a key is configured; the value is never read past truthiness' },
  { file: 'src/test/setup.ts', shape: 'key', because: 'DELETES both keys before every test, so no test can reach a paid model' },
  { file: 'src/types/ai.ts', shape: 'model-id', because: 'the AIModel type: the three tiers MODELS names, as a type, not a call' },
];

/** Direct calls outside the door: the ratcheted count, and what it is made of. */
export const BASELINE = 0;

function census(): { files: string[]; all: Hit[]; outside: Hit[]; exemptUsed: Set<string> } {
  const files = population();
  const all = files.flatMap((f) => directCalls(f, readFileSync(join(ROOT, f), 'utf8')));
  const exemptUsed = new Set<string>();
  const outside = all.filter((h) => {
    if (h.file === THE_DOOR) return false;
    const e = EXEMPT.find((x) => x.file === h.file && x.shape === h.shape);
    if (e) { exemptUsed.add(`${e.file}#${e.shape}`); return false; }
    return true;
  });
  return { files, all, outside, exemptUsed };
}

const C = census();

describe('the population is the whole source tree', () => {
  it('reads every script under src/, and there are at least as many as there were', () => {
    // 408 files on 9 October 2026. A floor, not an equality: it moves up freely.
    expect(C.files.length).toBeGreaterThanOrEqual(400);
    for (const dir of ['src/services/', 'src/routes/', 'src/jobs/', 'src/lib/', 'src/mcp/', 'src/cli/', 'src/middleware/']) {
      expect(C.files.some((f) => f.startsWith(dir)), dir).toBe(true);
    }
    expect(C.files).toContain(THE_DOOR);
  });

  it('the door itself is read and found: each shape it uses is seen in it (no shape is vacuous on real code)', () => {
    const door = C.all.filter((h) => h.file === THE_DOOR);
    for (const s of ['host', 'completion', 'key', 'model-id'] as const) expect(door.some((h) => h.shape === s), s).toBe(true);
  });
});

describe('nothing pays a model except the door', () => {
  it(`direct calls outside ${THE_DOOR}: ${String(BASELINE)} (may only shrink)`, () => {
    expect(C.outside.map((h) => `${h.file}:${String(h.line)} [${h.shape}] ${h.text}`)).toEqual([]);
    expect(C.outside.length).toBeLessThanOrEqual(BASELINE);
  });

  it('no exemption names a shape that is a model call by construction, and none is stale', () => {
    for (const e of EXEMPT) {
      expect(['completion', 'sdk']).not.toContain(e.shape);
      expect(e.because.length).toBeGreaterThan(20);
      expect(C.exemptUsed.has(`${e.file}#${e.shape}`), `stale exemption ${e.file}#${e.shape}`).toBe(true);
    }
  });

  it('every model is chosen by tier: each call names MODELS.* or a tier function, never a model of its own', () => {
    // The tier functions and callClaude with MODELS: anything else would have
    // been a model-id hit above. Here the callers are counted for the record.
    const callers = C.files.filter((f) => f !== THE_DOOR).map((f) => {
      const s = ts.createSourceFile(f, readFileSync(join(ROOT, f), 'utf8'), ts.ScriptTarget.Latest, true);
      let n = 0;
      const v = (x: ts.Node): void => {
        if (ts.isCallExpression(x) && ts.isIdentifier(x.expression) && /^call(Claude|Opus|Sonnet|Haiku)$/.test(x.expression.text)) n += 1;
        ts.forEachChild(x, v);
      };
      v(s);
      return n;
    });
    // 25 call sites on 9 October 2026; a floor so a parser that stopped seeing them goes red.
    expect(callers.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(20);
  });
});

describe('a canary per shape: each planted call is found, each comment is not', () => {
  const planted: Record<Shape, string> = {
    host: `await fetch('https://api.anthropic.com/v1/x', { method: 'POST' });`,
    completion: 'const u = `${base}/chat/completions`; await fetch(u);',
    sdk: `import Anthropic from '@anthropic-ai/sdk';`,
    key: `const k = process.env['OPENAI_API_KEY'];`,
    'model-id': `await callClaude({ model: 'anthropic/claude-sonnet-4-5' as AIModel, maxTokens: 1, systemPrompt: '', userPrompt: '' });`,
  };
  for (const s of SHAPES) {
    it(`${s}: found when planted`, () => {
      expect(directCalls('src/x.ts', planted[s]).map((h) => h.shape)).toContain(s);
    });
    it(`${s}: a comment naming it is not a call`, () => {
      expect(directCalls('src/x.ts', `// ${planted[s]}\n/* ${planted[s]} */\nexport const x = 1;`)).toEqual([]);
    });
  }
  it('the other spellings: a dynamic import, a require, a template with a host, a destructured key, a JS file', () => {
    expect(directCalls('src/x.ts', `const { default: OpenAI } = await import('openai');`).map((h) => h.shape)).toContain('sdk');
    expect(directCalls('src/x.js', `const g = require('@google/generative-ai');`).map((h) => h.shape)).toContain('sdk');
    expect(directCalls('src/x.ts', 'await fetch(`https://openrouter.ai/api/v1/${path}`);').map((h) => h.shape)).toContain('host');
    expect(directCalls('src/x.ts', 'const { ANTHROPIC_API_KEY } = process.env;').map((h) => h.shape)).toContain('key');
    expect(directCalls('src/x.mjs', `fetch(BASE + '/v1/messages', {})`).map((h) => h.shape)).toContain('completion');
  });
  it('a name in a list of names is not a read', () => {
    expect(directCalls('src/x.ts', `export const NEEDED = [{ name: 'OPENROUTER_API_KEY' }];`)).toEqual([]);
  });
});

describe('every way through the door says what the spend is for', () => {
  it('each exported call* in the door takes a SpendSubject, so no call is charged to nothing', () => {
    const sf = ts.createSourceFile(THE_DOOR, readFileSync(join(ROOT, THE_DOOR), 'utf8'), ts.ScriptTarget.Latest, true);
    const entries: Array<{ name: string; subject: boolean }> = [];
    sf.forEachChild((n) => {
      if (ts.isFunctionDeclaration(n) && n.name && /^call(Claude|Opus|Sonnet|Haiku)/.test(n.name.text)
        && n.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
        entries.push({ name: n.name.text, subject: n.parameters.some((p) => /\bSpendSubject\b/.test(p.type?.getText(sf) ?? '')) });
      }
    });
    expect(entries.length).toBeGreaterThanOrEqual(4);
    expect(entries.filter((e) => !e.subject).map((e) => e.name)).toEqual([]);
  });
});
