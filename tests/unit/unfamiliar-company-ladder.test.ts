process.env.TURSO_DATABASE_URL = 'file::memory:';

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { runMigrations } from '../../src/db/migrate.js';
import { query } from '../../src/db/client.js';
import { reportCompanyObligation } from '../../src/services/founder/company-report.js';
import { recordReconstructionClaim } from '../../src/services/institution/reconstruction.js';
import {
  earnResponsibilityUnderstanding, requiredUnderstandingFacts,
} from '../../src/services/institution/responsibility-understanding.js';
import {
  beginExternalMetricShadowing, resolveExternalMetricShadowing,
} from '../../src/services/institution/external-shadowing.js';
import {
  recordCompanyObservations, registerObservationChannel,
} from '../../src/services/institution/company-observation.js';

// =============================================================================
// Four companies that are nothing like each other, and nothing like a SaaS
// product, carried from an owner report to Shadowing through the ordinary path.
//
// The point is not that the ladder can be walked — earlier tests show that. It
// is that walking it for a dance school required NO kernel change: no new
// capability, no new obligation kind, no new metric column, no branch that
// knows what a class or a croissant is. Each company supplies its own
// vocabulary as evidence; the institution supplies structure.
//
// These are written as businesses first and fixtures second. If one of them
// forces a kernel change, that is a defect in the generalization, not a feature
// request from the company.
// =============================================================================

interface Company {
  id: string;
  name: string;
  /** What the owner actually says has to be handled, in their words. */
  obligation: { kind: string; what: string };
  /** What they count, and what their tools would post it under. */
  channel: { key: string; label: string; unit: string };
  /** Their facts. Deliberately in domain language the kernel never sees. */
  facts: Record<string, string>;
  /** Readings over time, oldest first. */
  readings: number[];
  expect: 'rose' | 'fell' | 'held';
}

const OWNER = 'ucl_owner';

const COMPANIES: Company[] = [
  {
    id: 'ucl_dance', name: 'Fold Street Dance',
    obligation: { kind: 'recurring_work', what: 'Every timetabled class has a teacher and a room' },
    channel: { key: 'classes_taught_weekly', label: 'Classes actually taught', unit: 'classes' },
    facts: {
      purpose: 'Nobody turns up to a class that is not running',
      desired_outcome: 'The timetable and the week agree',
      success_conditions: 'Every timetabled class ran with a teacher present',
      operating_constraints: 'Four teachers, two studios, term dates fixed a year ahead',
      dependencies: 'Teacher availability and the studio lease',
      risks: 'A cancelled class loses the family, not just the fee',
      systems: 'The wall timetable and the class register',
      current_carrier: 'The studio manager rings round on Sunday evening',
      failure_modes: 'A teacher is ill and no cover is found before the class starts',
    },
    readings: [38, 41], expect: 'rose',
  },
  {
    id: 'ucl_agency', name: 'Kesterly Brand Studio',
    obligation: { kind: 'delivery', what: 'Every retained client gets their agreed monthly work delivered' },
    channel: { key: 'retainers_delivered_on_time', label: 'Retainers delivered in the month', unit: 'clients' },
    facts: {
      purpose: 'Clients pay monthly and must receive that month',
      desired_outcome: 'No retainer rolls unfinished into the next month',
      success_conditions: 'Every retained client signed off their month',
      operating_constraints: 'Six designers, and August is unstaffable',
      dependencies: 'Client feedback arriving, and freelance illustrators',
      risks: 'A slipped month is usually the month before a client leaves',
      systems: 'The job board and the client folder',
      current_carrier: 'The account lead reviews the board every Friday',
      failure_modes: 'A client goes quiet, the work stalls, and nobody chases it',
    },
    readings: [11, 9], expect: 'fell',
  },
  {
    id: 'ucl_shop', name: 'Harrow Lane Provisions',
    obligation: { kind: 'delivery', what: 'Orders placed before noon go out the same day' },
    channel: { key: 'orders_shipped_same_day', label: 'Orders shipped the same day', unit: 'orders' },
    facts: {
      purpose: 'The same-day promise on the website is kept',
      desired_outcome: 'Nothing placed before noon waits overnight',
      success_conditions: 'The noon list is empty by the courier collection',
      operating_constraints: 'One packer, and the courier collects at four',
      dependencies: 'Stock on the shelf and the courier turning up',
      risks: 'A missed promise costs a repeat customer and a review',
      systems: 'The order printer and the packing bench',
      current_carrier: 'The packer works the printed list in order',
      failure_modes: 'Stock says available and the shelf is empty',
    },
    readings: [64, 64], expect: 'held',
  },
  {
    id: 'ucl_clinic', name: 'Thorne Veterinary',
    obligation: { kind: 'customer_commitment', what: 'Every client gets their test results explained within two days' },
    channel: { key: 'results_explained_in_two_days', label: 'Results explained within two days', unit: 'clients' },
    facts: {
      purpose: 'An owner waiting on results is frightened, and waiting is the harm',
      desired_outcome: 'No client waits more than two days for an explanation',
      success_conditions: 'Every result that came back was explained to its owner',
      operating_constraints: 'Two vets, and the lab returns in batches',
      dependencies: 'The external lab and the phone list',
      risks: 'A delayed explanation is remembered far longer than the wait',
    },
    readings: [17, 22], expect: 'rose',
  },
];

beforeAll(async () => {
  await runMigrations();
  await query(`INSERT INTO founders (id,clerk_user_id,email) VALUES ('${OWNER}','ucl_clerk','o@example.com')`, []);
  for (const c of COMPANIES) {
    await query('INSERT INTO products (id,name,owner_id) VALUES (?,?,?)', [c.id, c.name, OWNER]);
  }
});

/** The whole ordinary path, with nothing company-specific in the mechanics. */
async function climb(company: Company): Promise<{ state: string; classification: string }> {
  const reported = await reportCompanyObligation({
    productId: company.id, founderId: OWNER,
    obligationKind: company.obligation.kind, what: company.obligation.what,
  });
  const responsibility = reported!.responsibility!;
  const signalId = String(((await query(
    'SELECT discovery_evidence_ref d FROM institutional_responsibilities WHERE id=?', [responsibility.id],
  )).rows[0] as Record<string, unknown>).d).replace('signal_event:', '');

  for (const [predicate, value] of Object.entries(company.facts)) {
    await recordReconstructionClaim({
      productId: company.id, subject: `responsibility:${responsibility.id}`, predicate, value,
      epistemicStatus: 'known', evidenceRefs: [{ kind: 'signal_event', id: signalId }],
      derivationMethod: 'the owner described how the business works', observedAt: new Date(),
    });
  }
  const understood = await earnResponsibilityUnderstanding(company.id, responsibility.id);
  expect(understood.state, `${company.name} should be understood`).toBe('understood');

  await registerObservationChannel({
    productId: company.id, founderId: OWNER, channelKey: company.channel.key,
    label: company.channel.label, unit: company.channel.unit,
  });
  for (const value of company.readings) {
    await recordCompanyObservations({
      productId: company.id, origin: 'test_adapter',
      readings: [{ channelKey: company.channel.key, observedValue: value }],
    });
  }

  const shadowing = await beginExternalMetricShadowing({
    productId: company.id, responsibilityId: responsibility.id, founderId: OWNER,
    field: company.channel.key, direction: company.expect,
  });
  expect(shadowing, `${company.name} should enter shadowing`).not.toBeNull();

  const expectationId = String(((await query(
    'SELECT id FROM responsibility_shadow_expectations WHERE responsibility_id=? ORDER BY rowid DESC LIMIT 1',
    [responsibility.id],
  )).rows[0] as Record<string, unknown>).id);
  await query(
    "UPDATE responsibility_shadow_expectations SET created_at=datetime(created_at,'-60 seconds') WHERE id=?",
    [expectationId]);
  await recordCompanyObservations({
    productId: company.id, origin: 'test_adapter',
    readings: [{ channelKey: company.channel.key, observedValue: nextReading(company) }],
  });
  const resolved = await resolveExternalMetricShadowing(company.id, expectationId);
  return { state: shadowing!.state, classification: resolved.classification };
}

/** A later reading that moves the way the owner said it would. */
function nextReading(company: Company): number {
  const last = company.readings[company.readings.length - 1];
  return company.expect === 'rose' ? last + 5 : company.expect === 'fell' ? last - 5 : last;
}

describe('unfamiliar companies climb the ordinary ladder', () => {
  for (const company of COMPANIES) {
    it(`carries ${company.name} from an owner report to a resolved Shadowing`, async () => {
      const result = await climb(company);
      expect(result.state).toBe('shadowing');
      expect(result.classification).toBe('matched');

      // Watching is not permission, in any of these businesses.
      expect((await query(
        'SELECT COUNT(*) n FROM autonomy_consents WHERE product_id=?', [company.id])).rows[0])
        .toMatchObject({ n: 0 });
    });
  }

  it('required no kernel branch that knows what any of these businesses are', () => {
    // The generalization claim, made structural. If carrying a dance school
    // ever needs the kernel to know what a class is, that is a defect in the
    // generalization and this fails.
    // Comments are stripped first. The kernel DOES name these businesses in
    // prose — migration 135's rationale is literally about a dance school — and
    // that is explanation, not a branch. The claim being tested is that no
    // executable line knows what any of them is.
    const kernel = ['discovery.ts', 'responsibility.ts', 'responsibility-understanding.ts',
      'external-shadowing.ts', 'external-observation.ts', 'company-observation.ts',
      'responsibility-shadowing.ts']
      .map((f) => readFileSync(resolve(__dirname, '../../src/services/institution', f), 'utf8'))
      .join('\n')
      .replace(/^[ \t]*\/\*[\s\S]*?\*\//gm, ' ')
      .split('\n').map((line) => line.replace(/^\s*\/\/.*$/, '')).join('\n')
      // camelCase split BEFORE the case fold. Folding first turns `danceStudio`
      // into `dancestudio`, where no word boundary can see either word — a
      // mutation found this on the sibling gate and it was true here too.
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .toLowerCase();

    // Words that can only mean the business. `class` and `order` are excluded
    // deliberately — they collide with JavaScript and with `ORDER BY`, so they
    // would fail on programming vocabulary rather than on domain knowledge, and
    // a test that fails for the wrong reason teaches the wrong lesson.
    for (const domainWord of [
      'dance', 'studio', 'teacher', 'retainer', 'agency', 'designer',
      'courier', 'packer', 'shop', 'vet', 'clinic', 'boat', 'marina',
    ]) {
      expect(kernel, `the kernel must not know what a ${domainWord} is`)
        .not.toMatch(new RegExp(`\\b${domainWord}\\b`));
    }

    // And the vocabularies these companies used are all owner-supplied or
    // generic: nothing was added to a closed list to make them work.
    for (const company of COMPANIES) {
      expect(kernel).not.toContain(company.channel.key);
      expect(kernel).not.toContain(company.obligation.what.toLowerCase());
    }
  });

  it('asks each company only for facts the institution genuinely needs', () => {
    // Requirements come from the capability, never from the industry. Two
    // companies with the same capability are asked the same things, and a
    // veterinary practice is not asked about studios.
    const support = requiredUnderstandingFacts('customer_support');
    const operations = requiredUnderstandingFacts('operations');
    expect(operations.length).toBeGreaterThan(support.length);
    for (const fact of support) expect(operations).toContain(fact);

    // Every fact name is business-independent.
    for (const fact of [...support, ...operations]) {
      expect(fact).toMatch(/^[a-z_]+$/);
      expect(['purpose', 'desired_outcome', 'success_conditions', 'operating_constraints',
        'dependencies', 'risks', 'systems', 'current_carrier', 'failure_modes',
        'failure_conditions', 'stakeholder_obligations', 'financial_consequence']).toContain(fact);
    }
  });
});
