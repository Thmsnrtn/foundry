process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import {
  INGEST_PURPOSES, authenticateIngest, getIngestCredentials, mintIngestCredential,
  revealIngestSecret, revokeIngestCredential,
} from '../../src/services/institution/ingest-credentials.js';

// =============================================================================
// One secret, three consequences — the defect migration 139 closes.
//
// `products.ingest_token` is described on the settings page as the URL you give
// to Stripe, to Zapier, to a cron job. It is a credential for POSTING NUMBERS.
// It also authenticated two other public intakes:
//
//   /ingest/company-report/:token    raise a responsibility
//   /ingest/effect-outcome/:token    say an executed effect achieved its intent
//
// The second one is the serious one. An outcome report is the only evidence
// that can move an effect off `unresolved`; it becomes a learned claim and
// takes the effect off the owner's "did this work?" list. Migration 137 refuses
// reports attributed to the institution — a system that can declare its own
// success has no outcome layer — and a metrics integration is not the
// institution, so it passed that check while being no better placed than
// Foundry to know whether anybody turned up.
//
// This is the recurring defect of this codebase wearing new clothes: a general
// mechanism bound to a widening consequence. It is also the exact inverse of
// the rule applied everywhere else — authority is NARROWER than the credential
// you hold, never a side effect of holding it.
// =============================================================================

const P = 'ic_co';
const OTHER = 'ic_other';
const OWNER = 'ic_owner';
const OTHER_OWNER = 'ic_owner2';

beforeAll(async () => {
  await runMigrations();
  await query(
    `INSERT INTO founders (id,clerk_user_id,email) VALUES
      ('${OWNER}','ic_c1','o@example.com'),('${OTHER_OWNER}','ic_c2','x@example.com')`, []);
  await query('INSERT INTO products (id,name,owner_id,ingest_token) VALUES (?,?,?,?),(?,?,?,?)',
    [P, 'Barrowfield Groundworks', OWNER, 'legacy_metrics_token_aaaaaaaa',
      OTHER, 'Somebody Else', OTHER_OWNER, 'legacy_metrics_token_bbbbbbbb']);
});

describe('a credential says what the system holding it may say', () => {
  it('is issued by the owner, with provenance, and shows its secret once', async () => {
    const minted = await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Job board', purposes: ['company_report'],
    });
    expect('secret' in minted).toBe(true);
    const credential = minted as { id: string; secret: string; purposes: string[] };
    expect(credential.purposes).toEqual(['company_report']);
    expect(credential.secret.length).toBeGreaterThanOrEqual(32);

    // Issuing one is a founder assertion, recorded as canonical evidence like
    // any other thing the owner tells Foundry.
    const evidence = (await query(
      `SELECT e.payload_json FROM ingest_credentials c
         JOIN signal_events e ON e.id=c.evidence_signal_id
        WHERE c.id=?`, [credential.id])).rows[0] as Record<string, unknown>;
    expect(JSON.parse(String(evidence.payload_json))).toMatchObject({
      founder_id: OWNER, label: 'Job board', purposes: ['company_report'],
    });

    // Listings never carry secrets; reading one back is its own owned call.
    const listed = await getIngestCredentials(P);
    expect(listed[0]).not.toHaveProperty('secret');
    expect(await revealIngestSecret({
      productId: P, founderId: OWNER, credentialId: credential.id })).toBe(credential.secret);
    expect(await revealIngestSecret({
      productId: P, founderId: OTHER_OWNER, credentialId: credential.id })).toBeNull();
  });

  it('opens the intake it was issued for and no other', async () => {
    const minted = await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Rota', purposes: ['company_report'],
    }) as { secret: string };

    expect(await authenticateIngest(minted.secret, 'company_report'))
      .toMatchObject({ productId: P, label: 'Rota' });

    // THE DEFECT, as a test. A credential for raising work may not say that
    // something worked, and one for numbers may not do either.
    expect(await authenticateIngest(minted.secret, 'effect_outcome')).toBeNull();
    expect(await authenticateIngest(minted.secret, 'metrics')).toBeNull();
  });

  it('will not let the metrics token reach the other two intakes', async () => {
    // The product-wide token is still what it always was, and is now ONLY that.
    for (const purpose of INGEST_PURPOSES) {
      expect(await authenticateIngest('legacy_metrics_token_aaaaaaaa', purpose),
        `the metrics token must not authenticate ${purpose}`).toBeNull();
    }
  });

  it('stops the moment the owner withdraws it', async () => {
    const minted = await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Delivery scanner', purposes: ['effect_outcome'],
    }) as { id: string; secret: string };
    expect(await authenticateIngest(minted.secret, 'effect_outcome')).not.toBeNull();

    // Not the owner — refused, and the credential still works.
    expect(await revokeIngestCredential({
      productId: P, founderId: OTHER_OWNER, credentialId: minted.id })).toBe(false);
    expect(await authenticateIngest(minted.secret, 'effect_outcome')).not.toBeNull();

    expect(await revokeIngestCredential({
      productId: P, founderId: OWNER, credentialId: minted.id })).toBe(true);
    expect(await authenticateIngest(minted.secret, 'effect_outcome')).toBeNull();
    // Withdrawn and unknown fail identically: a caller learns nothing about
    // which credentials exist or what they were once allowed to do.
    expect(await authenticateIngest('nosuchsecretnosuchsecretnosuch', 'effect_outcome')).toBeNull();
  });

  it('records use, so an owner can see which system has gone quiet', async () => {
    const minted = await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Till', purposes: ['metrics'],
    }) as { id: string; secret: string };
    expect((await getIngestCredentials(P)).find((c) => c.id === minted.id)!.lastUsedAt).toBeNull();
    await authenticateIngest(minted.secret, 'metrics');
    expect((await getIngestCredentials(P)).find((c) => c.id === minted.id)!.lastUsedAt).not.toBeNull();
  });
});

describe('what a credential is not', () => {
  it('refuses a purpose nobody honours, in the service and in the database', async () => {
    expect(await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Anything', purposes: ['everything'],
    })).toEqual({ refused: 'purpose_unknown' });
    expect(await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Anything', purposes: [],
    })).toEqual({ refused: 'purposes_required' });
    expect(await mintIngestCredential({
      productId: P, founderId: OWNER, label: '   ', purposes: ['metrics'],
    })).toEqual({ refused: 'label_required' });

    // Defence in depth: relaxing the service alone would produce a system that
    // accepts an unknown purpose right up until the insert.
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ic_forge_sig',?,'founder_assertion_structured','founder_issued_ingest_credential',
               'low','{}','x')`, [P]);
    await expect(query(
      `INSERT INTO ingest_credentials (id,product_id,label,secret,purposes_json,evidence_signal_id)
       VALUES ('ic_forged',?,'Forged','sssssssssssssssssssssssssssssssss',
               json_array('effect_outcome','admin'),'ic_forge_sig')`, [P],
    )).rejects.toThrow(/purpose_unknown/);
  });

  it('refuses a credential issued into a company the founder does not own', async () => {
    expect(await mintIngestCredential({
      productId: OTHER, founderId: OWNER, label: 'Sneak', purposes: ['effect_outcome'],
    })).toEqual({ refused: 'not_owned' });
  });

  it('refuses a credential grounded in another company\'s evidence', async () => {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ic_other_sig',?,'founder_assertion_structured','founder_issued_ingest_credential',
               'low','{}','x')`, [OTHER]);
    await expect(query(
      `INSERT INTO ingest_credentials (id,product_id,label,secret,purposes_json,evidence_signal_id)
       VALUES ('ic_crosstenant',?,'Leak','tttttttttttttttttttttttttttttttt',
               json_array('metrics'),'ic_other_sig')`, [P],
    )).rejects.toThrow(/evidence_invalid/);
  });

  it('cannot be upgraded in place', async () => {
    // If purposes could be edited, the answer to "what was this secret ever
    // allowed to do?" would be whatever the row says today, and every past
    // request would be re-described by the present.
    const minted = await mintIngestCredential({
      productId: P, founderId: OWNER, label: 'Immutable', purposes: ['metrics'],
    }) as { id: string };
    await expect(query(
      `UPDATE ingest_credentials SET purposes_json=json_array('metrics','effect_outcome') WHERE id=?`,
      [minted.id])).rejects.toThrow(/immutable/);
    await expect(query(
      'UPDATE ingest_credentials SET secret=? WHERE id=?',
      ['uuuuuuuuuuuuuuuuuuuuuuuuuuuuuuuu', minted.id])).rejects.toThrow(/immutable/);
    // Withdrawal and use-tracking are the mutable parts, deliberately.
    await query("UPDATE ingest_credentials SET revoked_at=datetime('now') WHERE id=?", [minted.id]);
  });

  it('refuses a secret too weak to be the whole of the authentication', async () => {
    await query(
      `INSERT INTO signal_events (id,product_id,source,event_type,severity,payload_json,summary)
       VALUES ('ic_weak_sig',?,'founder_assertion_structured','founder_issued_ingest_credential',
               'low','{}','x')`, [P]);
    await expect(query(
      `INSERT INTO ingest_credentials (id,product_id,label,secret,purposes_json,evidence_signal_id)
       VALUES ('ic_weak',?,'Weak','short','["metrics"]','ic_weak_sig')`, [P],
    )).rejects.toThrow(/secret_weak/);
  });

  it('authorises nothing by existing', async () => {
    // Narrowing who may SAY something says nothing about what follows from
    // having said it. No credential creates a grant, and none ever should.
    expect((await query(
      'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [P])).rows[0])
      .toMatchObject({ n: 0 });
  });
});

describe('the vocabulary is closed in both places', () => {
  it('the service and migration 139 name exactly the same purposes', () => {
    const sql = readFileSync(
      resolve(__dirname, '../../src/db/migrations/139_scoped_ingest_credentials.sql'), 'utf8')
      .replace(/--[^\n]*/g, '');
    const declared = [...sql.matchAll(/NOT IN \(([^)]*)\)/g)]
      .flatMap((m) => [...m[1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]));
    expect(declared.sort()).toEqual([...INGEST_PURPOSES].sort());
  });

  it('every route that takes a token names the purpose itself', () => {
    // The purpose comes from the ROUTE, never from the request, so a caller
    // cannot name the intake it would like to be allowed. Structural, so a
    // fourth intake added later cannot quietly inherit the metrics token.
    const source = readFileSync(
      resolve(__dirname, '../../src/routes/ingest/index.ts'), 'utf8');
    const routes = [...source.matchAll(/ingestRoutes\.post\('([^']+)'/g)].map((m) => m[1]);
    expect(routes.sort()).toEqual([
      '/ingest/:token', '/ingest/company-report/:token',
      '/ingest/customer-message/:channelKey', '/ingest/effect-outcome/:token',
    ]);

    // The two intakes whose consequence is not "a number changed" must not
    // reach the product-wide token at all.
    const consequential = source.slice(source.indexOf("'/ingest/company-report/:token'"));
    expect(consequential).not.toContain('WHERE ingest_token');
    for (const purpose of ['company_report', 'effect_outcome']) {
      expect(source).toContain(`authenticateIngest(token, '${purpose}')`);
    }
  });

  it('no other route in src authenticates against the metrics token', () => {
    // The settings page reads it to display it, and the metric intake resolves
    // it. Anything else reaching for `ingest_token` as a credential is the
    // defect coming back.
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
      const p = resolve(dir, e.name);
      return e.isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    const users = walk(resolve(__dirname, '../../src/routes'))
      .filter((f) => /WHERE ingest_token/.test(readFileSync(f, 'utf8')))
      .map((f) => f.replace(resolve(__dirname, '../..') + '/', ''));
    expect(users.sort()).toEqual(['src/routes/ingest/index.ts']);
  });
});
