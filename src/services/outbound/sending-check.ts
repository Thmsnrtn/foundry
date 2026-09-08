// =============================================================================
// BEFORE A SENDING ADDRESS IS ACCEPTED, THE PROVIDER IS ASKED.
//
// A key pasted into a form proves nothing about the domain it will send from.
// Resend lists the domains a key may send for and whether each is verified;
// an address whose domain is absent or unverified would be refused at the
// first send, so it is refused here instead, at the point of setup, in words.
// A read, not an effect: nothing is created at the provider.
// =============================================================================
import { withRetry } from '../resilience.js';

export interface DomainCheck { ok: boolean; reason: string }

export async function verifyResendDomain(credential: string, fromEmail: string, fetchImpl: typeof fetch = fetch): Promise<DomainCheck> {
  const domain = fromEmail.split('@')[1]?.toLowerCase();
  if (!domain) return { ok: false, reason: 'that is not an email address' };
  if (!credential) return { ok: false, reason: 'a provider API key is required' };
  let response: Response;
  try {
    response = await withRetry(() => fetchImpl('https://api.resend.com/domains', { headers: { Authorization: `Bearer ${credential}` } }), { timeoutMs: 10_000, maxRetries: 1 });
  } catch (e) {
    return { ok: false, reason: `the provider could not be reached: ${e instanceof Error ? e.message : String(e)}` };
  }
  if (response.status === 401 || response.status === 403) return { ok: false, reason: 'the provider rejected that API key' };
  if (!response.ok) return { ok: false, reason: `the provider answered ${response.status}` };
  const body = (await response.json().catch(() => ({}))) as { data?: Array<{ name?: string; status?: string }> };
  const match = (body.data ?? []).find((d) => String(d.name ?? '').toLowerCase() === domain || domain.endsWith(`.${String(d.name ?? '').toLowerCase()}`));
  if (!match) return { ok: false, reason: `the key can send for ${(body.data ?? []).length ? (body.data ?? []).map((d) => d.name).join(', ') : 'no domains'}, not for ${domain}. Add and verify ${domain} at the provider first.` };
  if (String(match.status) !== 'verified') return { ok: false, reason: `${domain} is ${String(match.status ?? 'not verified')} at the provider; finish its DNS verification first` };
  return { ok: true, reason: 'verified' };
}
