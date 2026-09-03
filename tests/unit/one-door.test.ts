process.env.TURSO_DATABASE_URL = 'file::memory:';
process.env.ENCRYPTION_KEY = '0'.repeat(64);
process.env.FOUNDRY_INSTANCE_POSTURE = 'private_owner';
process.env.FOUNDRY_OWNER_EMAIL = 'owner@example.com';

import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { whichDoor } from '../../src/services/institution/the-door.js';

// =============================================================================
// ONE DOOR.
//
// THE FAILURE THIS EXISTS FOR HAPPENED IN PRODUCTION, TO THE OWNER, ON HIS
// PHONE. He opened Private Foundry to give the institution its first real
// mandate and got a 404. The form was mine, shipped an hour earlier, posting to
// a route that does not exist — and no test could have caught it, because every
// test drove the handler directly and none of them ever pressed the button.
//
// The 404 was the smaller half. The larger half is that the form was the wrong
// shape: posting to /foundry/venture requires him to know a venture mandate is
// a thing and to have found the screen that collects one. He should say what he
// wants. Choosing which system receives the sentence is Foundry's job.
// =============================================================================

const OWNER = 'door_owner';
let app: Hono;

beforeAll(async () => {
  await runMigrations();
  await query('INSERT INTO founders (id,clerk_user_id,email,name) VALUES (?,?,?,?)',
    [OWNER, 'clerk_door', 'owner@example.com', 'Owner']);
  const { foundryShellRoutes } = await import('../../src/routes/dashboard/foundry-shell.js');
  app = new Hono();
  app.use('*', async (c, next) => {
    c.set('founder' as never,
      { id: OWNER, email: 'owner@example.com', name: 'Thomas Norton' } as never);
    c.set('csrfToken' as never, 'test' as never);
    await next();
  });
  app.route('/', foundryShellRoutes);
});

/** His real sentence, as he wrote it. */
const THE_MANDATE =
  'Make the river stronger by finding another small digital income stream that would '
  + 'make my portfolio more resilient, keep legal risk low, avoid increasing our biggest '
  + 'existing dependencies, spend no more than $25 validating anything, and bring me only '
  + 'things that deserve my attention.';

describe('which door a sentence goes through', () => {
  it('sends the owner\'s real mandate to the search, whole', () => {
    const door = whichDoor(THE_MANDATE);
    expect(door.destination).toBe('venture');
    // NOT a budget instruction. The paragraph contains "spend no more than $25"
    // and a boundary about what reaches him, and reading either as company
    // machinery would file two thirds of a mandate away and drop the rest.
    expect(door.understoodAs).toContain('look for another way to make money');
  });

  it('hears a question as a question, not as an instruction', () => {
    expect(whichDoor('How are things?').destination).toBe('question');
    expect(whichDoor('Why is AcreOS not growing?').destination).toBe('question');
    expect(whichDoor('Show me what you found').destination).toBe('question');
  });

  it('never hears a firm instruction as idle curiosity', () => {
    // "Do not contact customers" opens with the same auxiliary a question does.
    // Filing his firmest instruction as an enquiry would be the worst possible
    // misreading, so the negative imperative is recognised before anything.
    for (const said of ['Do not contact customers without asking me',
      "Don't spend anything", 'Never email anyone']) {
      expect(whichDoor(said).destination, said).not.toBe('question');
    }
  });

  it('places company steering, and says what it still needs', () => {
    const door = whichDoor('Spend no more than $25 a month');
    expect(door.destination).toBe('company');
    expect(door.needs).toContain('which company');
  });

  it('says so plainly when it cannot place a sentence', () => {
    const door = whichDoor('The weather has been remarkable lately');
    expect(door.destination).toBe('unplaceable');
    expect(door.said).toBe('The weather has been remarkable lately');
  });
});

describe('the door as the owner actually presses it', () => {
  it('accepts his real mandate and opens a real search', async () => {
    const res = await app.request('/foundry/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said: THE_MANDATE }).toString(),
    });
    // NOT a 404. This is the assertion that would have caught what he hit.
    expect(res.status).toBe(302);
    expect(res.headers.get('location')).toBe('/foundry?done=looking');

    const open = (await query(
      'SELECT statement FROM venture_mandates WHERE founder_id = ? AND closed_at IS NULL',
      [OWNER])).rows as unknown as Array<Record<string, unknown>>;
    expect(open.length).toBe(1);
    // AND THE CONSTRAINTS TRAVELLED WITH IT rather than away from it.
    const guidance = (await query(
      'SELECT COUNT(*) AS n FROM venture_guidance')).rows[0] as Record<string, unknown>;
    expect(Number(guidance.n)).toBeGreaterThan(0);
  });

  it('never strands him on a dead end when it cannot place a sentence', async () => {
    const said = 'The weather has been remarkable lately';
    const res = await app.request('/foundry/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said }).toString(),
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    // HIS WORDS COME BACK. Losing three hundred words of mandate because
    // nothing recognised them is worse than the 404 was.
    expect(body).toContain(said);
    expect(body).toContain('Send it again');
    expect(body).toContain('not lost');
  });

  it('answers an empty submission without an error page', async () => {
    const res = await app.request('/foundry/ask', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ said: '   ' }).toString(),
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('did not follow');
  });
});
