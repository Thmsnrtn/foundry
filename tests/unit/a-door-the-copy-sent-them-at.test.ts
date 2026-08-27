process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { stripComments } from '../../scripts/lib/strip-comments.mjs';

// =============================================================================
// A DOOR THE COPY SENT THEM AT.
//
// The letter page told the founder: "Point your helpdesk or mailbox at that URL
// and I will see what people send." A mailbox cannot POST JSON at all, and a
// helpdesk posts its OWN webhook shape, which `POST /ingest/customer-message/
// :channelKey` refuses as `fields_invalid`. The design record is explicit that
// "an adapter for a helpdesk, a mailbox, or a form is an ordinary caller" —
// and no adapter exists anywhere in `src/`, so the sentence described one that
// was never written.
//
// The founder would have found out by trying, and the refusal counter on that
// same card would have told them afterwards. That is the system failing
// gracefully, not the system being honest: the copy sent them at it.
//
// What this pins is narrow and durable: every field the page names must be one
// the door's schema accepts, and the page must not tell a founder to point a
// source at it that cannot POST. A page and a zod schema drift the moment one
// is edited without the other.
// =============================================================================

const PAGE = 'src/routes/dashboard/letter.ts';
const DOOR = 'src/routes/ingest/index.ts';

function intakeCard(): string {
  const src = stripComments(readFileSync(PAGE, 'utf8'), { lineComments: true });
  const start = src.indexOf('How customers reach you');
  expect(start, 'the intake card should still be on the page').toBeGreaterThan(-1);
  return src.slice(start, src.indexOf('supportChannelSection', start) + 4000);
}

/** The fields the customer-message door's schema actually declares. */
function schemaFields(): { required: string[]; optional: string[] } {
  const src = readFileSync(DOOR, 'utf8');
  const block = src.slice(src.indexOf("'/ingest/customer-message/:channelKey'"));
  const schema = block.slice(block.indexOf('z.object({'), block.indexOf('}).safeParse'));
  const required: string[] = [];
  const optional: string[] = [];
  for (const line of schema.split('\n')) {
    const m = /^\s*(\w+):\s*z\./.exec(line);
    if (!m) continue;
    (line.includes('.optional()') ? optional : required).push(m[1]!);
  }
  return { required, optional };
}

describe('the page describes the door it points at', () => {
  it('names every field the door requires', () => {
    const card = intakeCard();
    for (const field of schemaFields().required) {
      expect(card, `the card must name the required field ${field}`).toContain(field);
    }
  });

  it('names no field the door does not accept', () => {
    const card = intakeCard();
    const known = new Set([...schemaFields().required, ...schemaFields().optional]);
    // Anything the card presents as a JSON key must be a real one.
    for (const m of card.matchAll(/"(\w+)":/g)) {
      expect(known, `the card offers "${m[1]}" and the schema has no such field`)
        .toContain(m[1]);
    }
  });

  it('does not tell a founder to point a mailbox at a JSON endpoint', () => {
    const card = intakeCard();
    expect(card.toLowerCase())
      .not.toMatch(/point your (helpdesk or )?mailbox at that url/);
    // And says plainly what a mailbox cannot do, because that is the thing a
    // founder would otherwise assume.
    expect(card).toMatch(/mailbox\s*\n?\s*cannot do that on its own|mailbox cannot/i);
  });

  it('the copy names every adapter that exists, and no adapter goes unnamed', () => {
    // THIS TEST FIRED AS DESIGNED. It used to assert that NO adapter existed,
    // with the note: "If one is ever written, this test should fail and the
    // copy should change to name it." One was written, it failed, and the copy
    // changed. What it holds now is the durable half of the same rule — the
    // page and the set of built adapters cannot drift apart in either
    // direction.
    const { readdirSync, statSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const walk = (dir: string): string[] => readdirSync(dir).flatMap((e) => {
      const p = join(dir, e);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith('.ts') ? [p] : [];
    });
    // A module that calls the door and is not the door itself is an adapter.
    const adapters = walk('src')
      .filter((f) => !f.includes('customer-message-intake'))
      .filter((f) => /ingestCustomerMessage\s*\(/.test(
        stripComments(readFileSync(f, 'utf8'), { lineComments: true })))
      .filter((f) => !f.includes('routes/ingest'));
    expect(adapters).toEqual(['src/services/integrations/intercom-messages.ts']);

    // Each one is named on the page, so a founder knows it is available to
    // them rather than discovering it in a changelog.
    const card = intakeCard();
    for (const provider of ['Intercom']) expect(card).toContain(provider);
  });

  it('what the page says the adapter can see is what the adapter says', () => {
    // The four limits the module commits to. A page that promised more reach
    // than the sense has is the same defect as the sentence this file is named
    // for, one level along.
    const card = intakeCard();
    expect(card).toMatch(/seven days/i);
    expect(card).toMatch(/first\s*\n?\s*message/i);
    expect(card).toMatch(/email address/i);
    expect(card).toMatch(/not see replies/i);
  });
});
