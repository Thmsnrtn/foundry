// =============================================================================
// THE SEND PATH ASKS FOR ITS OWN CAPABILITY.
//
// The gateway's handler registry is process-global and filled by IMPORT SIDE
// EFFECT: `integration/resend.ts` registers `send_email` when it is loaded, and
// not otherwise. Nothing in the hand or in correspondence imported it. Both
// worked anyway, because the server happens to import unrelated modules —
// onboarding email, the digest, the SCP executor — that pull it in first.
//
// That is an accidental dependency on import order for the most consequential
// thing this institution does. It was found by proving the answering loop in
// production, where a reply composed correctly, refused to send, and recorded
// the reason: "no trusted policy registered for tool 'send_email'" — with the
// provider configured, credentialed and working the whole time.
//
// A send must ask for the capability where the send is.
// =============================================================================

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (rel: string) => readFileSync(resolve(process.cwd(), rel), 'utf-8');

/** Every module that hands the gateway a `send_email` of its own. */
const SENDERS = [
  'src/services/venture/hand.ts',
  'src/services/public-workshop/correspondence.ts',
];

describe('a module that sends asks for the thing that sends', () => {
  it('every send site imports the provider that registers the capability', () => {
    for (const rel of SENDERS) {
      const source = read(rel);
      expect(source, `${rel} calls the gateway with send_email`).toContain("tool: 'send_email'");
      expect(
        /import\(['"][^'"]*integration\/resend\.js['"]\)/.test(source),
        `${rel} sends email but never imports integration/resend.js, so whether it works depends on `
        + 'some other module having been imported first. Ask for it where the send is.',
      ).toBe(true);
    }
  });

  it('asks before it invokes, not after', () => {
    for (const rel of SENDERS) {
      const source = read(rel);
      const asks = source.search(/import\(['"][^'"]*integration\/resend\.js['"]\)/);
      const sends = source.indexOf("tool: 'send_email'");
      expect(asks, `${rel}: the import must come before the call that needs it`).toBeLessThan(sends);
    }
  });
});
