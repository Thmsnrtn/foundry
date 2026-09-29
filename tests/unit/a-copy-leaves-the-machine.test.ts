process.env.ENCRYPTION_KEY = '4'.repeat(64);
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// =============================================================================
// A COPY LEAVES THE MACHINE — SEALED, AND ONLY ONCE IT HAS BEEN SHOWN TO WORK.
//
// Every daily copy lived on the database's own volume: the right defence
// against a bad migration, and none against losing the volume or the machine.
// The executive review of 29 September 2026 named it the institution's single
// point of failure. The copy that passes its restore rehearsal is now sealed
// under a key of its own and sent to object storage off the machine, and it can
// be fetched back, unsealed and rehearsed from there.
// =============================================================================

const SECRETS = {
  R2_ACCOUNT_ID: 'a'.repeat(32), R2_BUCKET: 'foundry-copies',
  R2_ACCESS_KEY_ID: 'AKIDEXAMPLE', R2_SECRET_ACCESS_KEY: 'secret-example',
  BACKUP_ENCRYPTION_KEY: 'b'.repeat(64),
};
let dir = '';

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'foundry-away-'));
  process.env.TURSO_DATABASE_URL = `file:${join(dir, 'foundry.db')}`;
  const { runMigrations } = await import('../../src/db/migrate.js');
  const { query } = await import('../../src/db/client.js');
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)', ['aw_owner', 'clerk_aw', 'owner@example.com', 'Owner']);
});

afterEach(() => {
  for (const k of Object.keys(SECRETS)) delete process.env[k];
  vi.restoreAllMocks();
});

describe('the signature', () => {
  it('matches the AWS Signature Version 4 example for S3 (GET Object)', async () => {
    const { signV4 } = await import('../../src/services/institution/sending-away.js');
    const h = signV4({
      method: 'GET', host: 'examplebucket.s3.amazonaws.com', path: '/test.txt',
      headers: { Range: 'bytes=0-9' },
      payloadHash: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
      accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
      region: 'us-east-1', service: 's3', now: new Date('2013-05-24T00:00:00Z'),
    });
    expect(h.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, '
      + 'SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, '
      + 'Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
});

describe('the seal', () => {
  it('opens with its key, and refuses a changed byte, the wrong key, or anything else', async () => {
    const { sealCopy, openCopy } = await import('../../src/services/institution/sending-away.js');
    const key = Buffer.from('c'.repeat(64), 'hex');
    const plain = Buffer.from('the whole institution, compressed');
    const sealed = sealCopy(plain, key);
    expect(sealed.includes(plain)).toBe(false);
    expect(openCopy(sealed, key).equals(plain)).toBe(true);
    const flipped = Buffer.from(sealed); flipped[flipped.length - 20] ^= 1;
    expect(() => openCopy(flipped, key)).toThrow();
    expect(() => openCopy(sealed, Buffer.from('d'.repeat(64), 'hex'))).toThrow();
    expect(() => openCopy(plain, key)).toThrow(/not a sealed/);
  });
});

describe('the configuration', () => {
  it('names what is missing, never what is set', async () => {
    const { awayConfig } = await import('../../src/services/institution/sending-away.js');
    const none = awayConfig({});
    expect(none).toEqual({ notConfigured: expect.stringMatching(/R2_ACCOUNT_ID.*BACKUP_ENCRYPTION_KEY are not set/) });
    const partial = awayConfig({ ...SECRETS, R2_SECRET_ACCESS_KEY: '' });
    expect(JSON.stringify(partial)).not.toContain(SECRETS.R2_ACCESS_KEY_ID);
    expect(partial).toEqual({ notConfigured: 'not configured: R2_SECRET_ACCESS_KEY is not set' });
  });

  it('refuses a malformed account or bucket, and the application key reused as the backup key', async () => {
    const { awayConfig } = await import('../../src/services/institution/sending-away.js');
    expect(awayConfig({ ...SECRETS, R2_ACCOUNT_ID: 'evil.example.com/x' })).toHaveProperty('notConfigured');
    expect(awayConfig({ ...SECRETS, R2_BUCKET: '../etc' })).toHaveProperty('notConfigured');
    expect(awayConfig({ ...SECRETS, ENCRYPTION_KEY: SECRETS.BACKUP_ENCRYPTION_KEY })).toEqual({
      notConfigured: 'BACKUP_ENCRYPTION_KEY must not be the application key' });
    expect(awayConfig(SECRETS)).toHaveProperty('config');
  });
});

describe('the daily job', () => {
  it('without storage configured, keeps the local copy and says the copy stays here', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    await expect(JOB_REGISTRY.keep_a_copy_of_everything.fn()).resolves.toBeUndefined();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect((await readdir(join(dir, 'backups'))).some((n) => /^foundry-.*\.db\.gz$/.test(n))).toBe(true);
  });

  it('with storage configured, rehearses the copy and then sends it sealed, signed, to the bucket', async () => {
    Object.assign(process.env, SECRETS);
    const puts: Array<{ url: string; init: RequestInit }> = [];
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      puts.push({ url: String(url), init: init as RequestInit });
      return new Response('', { status: 200 });
    });
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    await JOB_REGISTRY.keep_a_copy_of_everything.fn();
    expect(puts).toHaveLength(1);
    const { url, init } = puts[0];
    expect(init.method).toBe('PUT');
    expect(url).toMatch(new RegExp(`^https://${SECRETS.R2_ACCOUNT_ID}\\.r2\\.cloudflarestorage\\.com/foundry-copies/foundry-\\d{4}-\\d{2}-\\d{2}\\.db\\.gz\\.sealed$`));
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\/\d{8}\/auto\/s3\/aws4_request/);
    // What left is the copy, sealed: it opens with the backup key into the very gzip on disk.
    const { openCopy } = await import('../../src/services/institution/sending-away.js');
    const local = (await readdir(join(dir, 'backups'))).find((n) => /^foundry-.*\.db\.gz$/.test(n))!;
    const opened = openCopy(Buffer.from(init.body as Buffer), Buffer.from(SECRETS.BACKUP_ENCRYPTION_KEY, 'hex'));
    expect(opened.equals(await readFile(join(dir, 'backups', local)))).toBe(true);
    expect(gunzipSync(opened).subarray(0, 15).toString()).toBe('SQLite format 3');
    const { lastSentAway } = await import('../../src/services/institution/sending-away.js');
    expect((await lastSentAway())?.key).toBe(`${local}.sealed`);
  });

  it('fails when a configured send is refused, so health and the Brief say so', async () => {
    Object.assign(process.env, SECRETS);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('denied', { status: 403 }));
    const { JOB_REGISTRY } = await import('../../src/jobs/index.js');
    await expect(JOB_REGISTRY.keep_a_copy_of_everything.fn()).rejects.toThrow(/refused: HTTP 403/);
  });
});

describe('fetching a copy back', () => {
  it('lists the bucket, fetches the newest, opens its seal, and refuses a name that is not a copy', async () => {
    Object.assign(process.env, SECRETS);
    const { sealCopy, listCopiesAway, fetchCopyBack } = await import('../../src/services/institution/sending-away.js');
    const plain = Buffer.from('a copy');
    const sealed = sealCopy(plain, Buffer.from(SECRETS.BACKUP_ENCRYPTION_KEY, 'hex'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = new URL(String(url));
      if (u.searchParams.get('list-type') === '2') {
        return new Response('<ListBucketResult><Contents><Key>foundry-2026-09-28.db.gz.sealed</Key></Contents>'
          + '<Contents><Key>foundry-2026-09-29.db.gz.sealed</Key></Contents><Contents><Key>other/thing</Key></Contents></ListBucketResult>');
      }
      return new Response(sealed);
    });
    expect(await listCopiesAway()).toEqual(['foundry-2026-09-29.db.gz.sealed', 'foundry-2026-09-28.db.gz.sealed']);
    const into = join(dir, 'fetched.db.gz');
    expect(await fetchCopyBack('foundry-2026-09-29.db.gz.sealed', into)).toBe(plain.length);
    expect((await readFile(into)).equals(plain)).toBe(true);
    await expect(fetchCopyBack('../../etc/passwd', into)).rejects.toThrow(/not a copy's name/);
    await writeFile(into, '');
  });
});
