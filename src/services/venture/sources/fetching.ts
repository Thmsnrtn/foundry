// =============================================================================
// FOUNDRY - how an eye reaches the world
//
// Every public source is read the same way: through the SSRF door, with a
// User-Agent that says who is asking and how to reach us, with a short
// timeout, and with the failure thrown rather than swallowed - a source that
// stopped answering must show up in the job's health, not as an empty finding.
// =============================================================================
import { safeFetch } from '../../outbound/ssrf.js';

/** Who is asking. Public APIs ask for this, and it is the honest thing to send. */
export const RESEARCH_USER_AGENT = 'FoundryResearch/1.0 (+https://apexmicro.ai; research@apexmicro.ai)';

export async function readJson<T>(url: string, headers: Record<string, string> = {}): Promise<T> {
  const res = await safeFetch(url, {
    headers: { 'user-agent': RESEARCH_USER_AGENT, accept: 'application/json', ...headers },
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${String(res.status)}`);
  return await res.json() as T;
}

/** HTML entities and tags, because people write links and quotes. */
export function readable(raw: string): string {
  return raw
    .replace(/<[^>]*>/g, ' ')
    .replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&#39;/g, "'").replace(/&#x2F;/g, '/')
    .replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Eighteen months. A thing untouched for longer is not being looked after. */
export const MAINTAINED_DAYS = 548;

export function maintainedSince(iso: string | null, now: Date = new Date()): boolean {
  if (iso === null) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && (now.getTime() - t) / 86_400_000 <= MAINTAINED_DAYS;
}
