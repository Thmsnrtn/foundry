// =============================================================================
// APEX MICRO IS THE COMMUNICATION IDENTITY. THE OWNER'S MAILBOX IS NOT.
//
// `standUpTheEars` and `connectReplyInbox` read `founders.email` and made the
// address the owner signs in with into the destination every message to
// apexmicro.ai is delivered to. Nobody decided that. It was the default in a
// line of code, and it quietly turned a private mailbox into Workshop
// infrastructure — the kind of dependency that is invisible until somebody
// reads the routing rules and finds their personal account in them.
//
// The identities are different things:
//
//   founders.email                        who the owner is to Foundry
//   public_workshop.contact_email         who Apex Micro is to the world
//   public_workshop.mail_kv_namespace_id  where Apex Micro keeps its own post
//
// The first fix pointed the post at an address the owner chose. That was still
// a mailbox somewhere, and the only mailbox to hand was the private one. The
// second fix removed the mailbox: the program at the edge writes every message
// into a store the Workshop owns and then rings Foundry's doorbell, so nothing
// is forwarded to anybody's account and nothing is lost if Foundry is down.
//
// Absent that store the Workshop cannot be given ears at all: the door makes
// one or refuses, rather than reaching for whatever address happens to be on
// the founder row.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

/**
 * The code, without the prose. A comment explaining why a module must NOT read
 * the founder's address would otherwise read as it doing so — the rule would
 * refuse the sentence that states it.
 */
const executable = (rel: string): string => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .split('\n').map((l) => l.replace(/(^|\s)\/\/.*$/, '')).join('\n');

/** Every module that decides how Apex Micro communicates with people. */
const COMMUNICATIONS = [
  'src/services/public-workshop/infrastructure.ts',
  'src/services/public-workshop/correspondence.ts',
  'src/services/public-workshop/mail.ts',
  'src/services/public-workshop/suppression.ts',
];

describe('no communications path reaches for the owner\'s account address', () => {
  it('none of them reads the founder row\'s email', () => {
    for (const rel of COMMUNICATIONS) {
      const source = executable(rel);
      const reads = /SELECT\s+email\s+FROM\s+founders|founder\?\.email|founders\.email/i.test(source);
      expect(reads,
        `${rel} reads the founder account's address. That address is who the owner is to Foundry; `
        + 'where Apex Micro\'s post goes is a store the Workshop owns, and it is a decision.')
        .toBe(false);
    }
  });

  it('none of them reads the configured owner address either', () => {
    for (const rel of COMMUNICATIONS) {
      expect(/getOwnerEmail|FOUNDRY_OWNER_EMAIL/.test(executable(rel)),
        `${rel} reaches for the instance owner's address; Apex Micro's identity is the Workshop's own`)
        .toBe(false);
    }
  });

  it('giving the Workshop ears refuses without somewhere of its own to keep post', () => {
    const source = read('src/services/public-workshop/infrastructure.ts');
    // Both doors that point mail somewhere must refuse rather than default.
    // It refuses without somewhere of its own to keep post, and what it keeps
    // post in is never the store the world can read.
    expect(source).toContain('no_mail_store');
    expect(source).toContain('mail_store_is_not_the_page_store');
    expect(source).toContain('w.mailKvNamespaceId');
  });
});

describe('nothing in the live path forwards mail to a mailbox at all', () => {
  it('the program at the edge records and rings; it never forwards', () => {
    const program = read('src/services/public-workshop/mail-worker-source.ts');
    // `message.forward(address)` is how an Email Worker hands a message to a
    // mailbox. Its absence is the boundary: there is no address to point at,
    // therefore no private account can become infrastructure by default.
    expect(program).not.toMatch(/message\.forward\s*\(/);
    expect(program).toContain('env.MAIL.put(');
    expect(program).toContain('setReject(');
  });

  it('nothing in the Workshop still carries a forwarding address', () => {
    for (const rel of [
      'src/services/public-workshop/infrastructure.ts',
      'src/services/public-workshop/settings.ts',
      'src/services/integration/cloudflare-gateway.ts',
      'src/routes/dashboard/workshop-place.ts',
      'src/cli/index.ts',
    ]) {
      expect(/mail_forward_to|mailForwardTo|setMailForwardTo|connectReplyInbox/.test(executable(rel)),
        `${rel} still carries the forwarding path that made a mailbox load-bearing`).toBe(false);
    }
  });
});

describe('the postal address is the owner\'s, exactly as he gave it', () => {
  it('keeps every line and invents none', async () => {
    const { postalLines } = await import('../../src/services/public-workshop/settings.js');
    expect(postalLines('  A Person\n 11 Some Drive \n\nSuite 300A #361\nTown, MA 01752  \n'))
      .toEqual(['A Person', '11 Some Drive', 'Suite 300A #361', 'Town, MA 01752']);
    expect(postalLines(null)).toEqual([]);
    expect(postalLines('')).toEqual([]);
  });

  it('is read from one recorded truth wherever it is shown', () => {
    // A second copy of an address is a second address as soon as one changes.
    for (const rel of ['src/services/public-workshop/site.ts', 'src/services/venture/hand.ts']) {
      expect(executable(rel)).toContain('postalLines(');
    }
  });
});

describe('the owner\'s address is not a test fixture for Workshop correspondence', () => {
  it('no Workshop test writes to or from the owner\'s account address', () => {
    // Proving a live send by pointing it at the owner's private mailbox makes
    // that mailbox part of the proof, and then part of the furniture. Use a
    // provider sink built for it instead — the runbook names one.
    for (const rel of [
      'tests/unit/the-workshop-can-hear.test.ts',
      'tests/unit/the-workshop-answers-for-itself.test.ts',
      'tests/unit/the-workshop-has-one-public-face.test.ts',
    ]) {
      expect(read(rel).includes('thmsnrtn@gmail.com'),
        `${rel} uses the owner's personal address as a correspondent`).toBe(false);
    }
  });
});
