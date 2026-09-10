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
// The two identities are different things:
//
//   founders.email                   who the owner is to Foundry
//   public_workshop.contact_email    who Apex Micro is to the world
//   public_workshop.mail_forward_to  where Apex Micro's post is delivered
//
// The third is a decision. Absent one, the Workshop cannot be given ears at
// all: the door refuses rather than reaching for whatever address happens to
// be on the founder row.
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
        + 'where Apex Micro\'s post goes is public_workshop.mail_forward_to, and it is a decision.')
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

  it('giving the Workshop ears refuses without an address of its own', () => {
    const source = read('src/services/public-workshop/infrastructure.ts');
    // Both doors that point mail somewhere must refuse rather than default.
    const refusals = source.match(/no_forwarding_address/g) ?? [];
    expect(refusals.length, 'both the ears and the reply inbox must refuse without a forwarding address')
      .toBeGreaterThanOrEqual(2);
    expect(source).toContain('w.mailForwardTo');
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
