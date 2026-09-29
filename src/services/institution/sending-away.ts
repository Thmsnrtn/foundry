// =============================================================================
// FOUNDRY - a copy that leaves the machine.
//
// Every daily copy lives on the same volume as the database (`keeping.ts` says
// so plainly): the right defence against a bad migration or a mistaken delete,
// and no defence at all against losing the volume or the machine. The
// executive review of 29 September 2026 named this the institution's single
// point of failure (O-1). This sends each copy AWAY — after, and only after,
// the day's restore rehearsal has shown it would serve a recovery — to
// Cloudflare R2, which speaks the S3 protocol.
//
// WHAT LEAVES IS SEALED. The copy is encrypted here with AES-256-GCM under
// BACKUP_ENCRYPTION_KEY, a key of its own: a leaked bucket credential yields
// ciphertext, and the application's own key never leaves the machine. The
// owner keeps a copy of the backup key somewhere that is not this machine, or
// the copy away is a locked box with the key inside the house that burned.
//
// NOT CONFIGURED IS NOT A FAILURE. Until the owner creates the bucket and sets
// the five secrets, this says so and does nothing; the local copy and its
// rehearsal are untouched. A configured send that fails DOES fail the job, so
// the Brief and the health reading say so.
//
// No dependency: SigV4 is a few HMACs, written here and checked against AWS's
// published example, and every request goes through `safeFetch`.
// =============================================================================

import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { query } from '../../db/client.js';
import { safeFetch } from '../outbound/ssrf.js';

export const AWAY_SECRETS = ['R2_ACCOUNT_ID', 'R2_BUCKET', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'BACKUP_ENCRYPTION_KEY'] as const;

export interface AwayConfig {
  accountId: string; bucket: string; accessKeyId: string; secretAccessKey: string; key: Buffer;
}

/** The configuration, or which secrets are missing or malformed — named, never shown. */
export function awayConfig(env: NodeJS.ProcessEnv = process.env): { config: AwayConfig } | { notConfigured: string } {
  const missing = AWAY_SECRETS.filter((n) => !(env[n] ?? '').trim());
  if (missing.length) return { notConfigured: `not configured: ${missing.join(', ')} ${missing.length === 1 ? 'is' : 'are'} not set` };
  const accountId = env.R2_ACCOUNT_ID!.trim(); const bucket = env.R2_BUCKET!.trim();
  const keyHex = env.BACKUP_ENCRYPTION_KEY!.trim();
  if (!/^[0-9a-f]{32}$/.test(accountId)) return { notConfigured: 'R2_ACCOUNT_ID is not a Cloudflare account id' };
  if (!/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(bucket)) return { notConfigured: 'R2_BUCKET is not a bucket name' };
  if (!/^[0-9a-fA-F]{64}$/.test(keyHex)) return { notConfigured: 'BACKUP_ENCRYPTION_KEY is not 64 hex characters' };
  if (keyHex.toLowerCase() === (env.ENCRYPTION_KEY ?? '').trim().toLowerCase()) {
    return { notConfigured: 'BACKUP_ENCRYPTION_KEY must not be the application key' };
  }
  return { config: { accountId, bucket, accessKeyId: env.R2_ACCESS_KEY_ID!.trim(), secretAccessKey: env.R2_SECRET_ACCESS_KEY!.trim(), key: Buffer.from(keyHex, 'hex') } };
}

// ─── Sealing ─────────────────────────────────────────────────────────────────

const MAGIC = Buffer.from('FNDB1');

/** MAGIC, a 12-byte nonce, the ciphertext, and the 16-byte tag. */
export function sealCopy(plain: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', key, iv);
  c.setAAD(MAGIC);
  const body = Buffer.concat([c.update(plain), c.final()]);
  return Buffer.concat([MAGIC, iv, body, c.getAuthTag()]);
}

/** The plain bytes, or a throw: a copy that fails its tag is not a copy. */
export function openCopy(sealed: Buffer, key: Buffer): Buffer {
  if (sealed.length < MAGIC.length + 12 + 16 || !sealed.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error('not a sealed Foundry copy');
  }
  const iv = sealed.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = sealed.subarray(sealed.length - 16);
  const d = createDecipheriv('aes-256-gcm', key, iv);
  d.setAAD(MAGIC);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(sealed.subarray(MAGIC.length + 12, sealed.length - 16)), d.final()]);
}

// ─── AWS Signature Version 4 ─────────────────────────────────────────────────

const sha256hex = (b: Buffer | string): string => createHash('sha256').update(b).digest('hex');
const hmac = (k: Buffer | string, s: string): Buffer => createHmac('sha256', k).update(s).digest();
const encode = (s: string): string => encodeURIComponent(s).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);

export interface SignInput {
  method: string; host: string; path: string; query?: Record<string, string>;
  headers?: Record<string, string>; payloadHash: string;
  accessKeyId: string; secretAccessKey: string; region: string; service: string; now: Date;
}

/** The headers a request needs, Authorization included. */
export function signV4(i: SignInput): Record<string, string> {
  const amzDate = i.now.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const day = amzDate.slice(0, 8);
  const headers: Record<string, string> = {
    ...Object.fromEntries(Object.entries(i.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v.trim()])),
    host: i.host, 'x-amz-content-sha256': i.payloadHash, 'x-amz-date': amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]}\n`).join('');
  const signedHeaders = names.join(';');
  const canonicalQuery = Object.keys(i.query ?? {}).sort().map((k) => `${encode(k)}=${encode(i.query![k])}`).join('&');
  const canonicalPath = i.path.split('/').map(encode).join('/');
  const canonical = [i.method, canonicalPath, canonicalQuery, canonicalHeaders, signedHeaders, i.payloadHash].join('\n');
  const scope = `${day}/${i.region}/${i.service}/aws4_request`;
  const toSign = ['AWS4-HMAC-SHA256', amzDate, scope, sha256hex(canonical)].join('\n');
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${i.secretAccessKey}`, day), i.region), i.service), 'aws4_request');
  const signature = createHmac('sha256', signingKey).update(toSign).digest('hex');
  return {
    ...headers,
    authorization: `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// ─── The bucket ──────────────────────────────────────────────────────────────

/** Signed headers and the URL for one request to the bucket. */
function signed(cfg: AwayConfig, method: 'PUT' | 'GET', path: string, body: Buffer | null, queryParams: Record<string, string> = {}):
{ host: string; qs: string; headers: Record<string, string> } {
  const host = `${cfg.accountId}.r2.cloudflarestorage.com`;
  const headers = signV4({
    method, host, path, query: queryParams, payloadHash: sha256hex(body ?? Buffer.alloc(0)),
    headers: body ? { 'content-length': String(body.length), 'content-type': 'application/octet-stream' } : {},
    accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey, region: 'auto', service: 's3', now: new Date(),
  });
  delete headers.host;
  const qs = Object.keys(queryParams).sort().map((k) => `${encode(k)}=${encode(queryParams[k])}`).join('&');
  return { host, qs: qs ? `?${qs}` : '', headers };
}

const objectPath = (cfg: AwayConfig, name: string): string => `/${cfg.bucket}/${name}`;
/** A copy's name away: the local name, sealed. Never a path from anywhere else. */
const awayName = (localName: string): string => {
  if (!/^foundry-\d{4}-\d{2}-\d{2}\.db\.gz$/.test(localName)) throw new Error(`not a copy's name: ${localName}`);
  return `${localName}.sealed`;
};

export interface SentAway { key: string; bytes: number; sha256: string }

/**
 * Seal a copy the rehearsal has already passed and send it away. Called by the
 * daily job after `sayRehearsal(...).ok`, never before.
 */
export async function sendTheCopyAway(copyPath: string, opts: { env?: NodeJS.ProcessEnv } = {}):
Promise<{ sent: SentAway } | { notConfigured: string }> {
  const c = awayConfig(opts.env);
  if ('notConfigured' in c) return c;
  const key = awayName(basename(copyPath));
  const sealed = sealCopy(await readFile(copyPath), c.config.key);
  const path = objectPath(c.config, key);
  const { host, headers } = signed(c.config, 'PUT', path, sealed);
  // THE ONE THING THAT LEAVES: a sealed copy, to the owner's own bucket.
  const res = await safeFetch(`https://${host}${path}`, {
    method: 'PUT', headers, body: sealed, signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`the copy away was refused: HTTP ${String(res.status)}`);
  const sent = { key, bytes: sealed.length, sha256: sha256hex(sealed) };
  await query(`INSERT OR REPLACE INTO copies_sent_away (away_key, bytes, sha256, sent_at) VALUES (?,?,?,datetime('now'))`,
    [sent.key, sent.bytes, sent.sha256]);
  return { sent };
}

/** The newest copy recorded as sent, from this machine's own record. */
export async function lastSentAway(): Promise<{ key: string; sentAt: string } | null> {
  const r = (await query(`SELECT away_key, sent_at FROM copies_sent_away ORDER BY sent_at DESC, rowid DESC LIMIT 1`)).rows[0] as
    Record<string, unknown> | undefined;
  return r ? { key: String(r.away_key), sentAt: String(r.sent_at) } : null;
}

/** What the bucket holds, newest first — read from the bucket, because after losing the volume this machine's record is gone too. */
export async function listCopiesAway(opts: { env?: NodeJS.ProcessEnv } = {}): Promise<string[]> {
  const c = awayConfig(opts.env);
  if ('notConfigured' in c) throw new Error(c.notConfigured);
  const path = `/${c.config.bucket}`;
  const { host, qs, headers } = signed(c.config, 'GET', path, null, { 'list-type': '2', prefix: 'foundry-' });
  const res = await safeFetch(`https://${host}${path}${qs}`, { method: 'GET', headers, signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`the bucket could not be listed: HTTP ${String(res.status)}`);
  const xml = await res.text();
  return [...xml.matchAll(/<Key>(foundry-\d{4}-\d{2}-\d{2}\.db\.gz\.sealed)<\/Key>/g)].map((m) => m[1]).sort().reverse();
}

/** Fetch a copy back, check its seal, and write the plain `.db.gz` to `into`. */
export async function fetchCopyBack(key: string, into: string, opts: { env?: NodeJS.ProcessEnv } = {}): Promise<number> {
  const c = awayConfig(opts.env);
  if ('notConfigured' in c) throw new Error(c.notConfigured);
  if (!/^foundry-\d{4}-\d{2}-\d{2}\.db\.gz\.sealed$/.test(key)) throw new Error(`not a copy's name: ${key}`);
  const path = objectPath(c.config, key);
  const { host, headers } = signed(c.config, 'GET', path, null);
  const res = await safeFetch(`https://${host}${path}`, { method: 'GET', headers, signal: AbortSignal.timeout(120_000) });
  if (!res.ok) throw new Error(`the copy could not be fetched: HTTP ${String(res.status)}`);
  const plain = openCopy(Buffer.from(await res.arrayBuffer()), c.config.key);
  await writeFile(into, plain);
  return plain.length;
}
