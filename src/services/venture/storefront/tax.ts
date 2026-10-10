// =============================================================================
// FOUNDRY — tax on the Workshop's own Stripe page (F2; PENDING 35, 42).
//
// THREE THINGS, NONE OF WHICH DECIDES HIS TAX POSTURE FOR HIM:
//
//   * STRIPE TAX ON THE LINK, ONLY ON HIS WORD. Whether to turn it on is
//     PENDING 35 (it costs 0.5% a sale, STRIPE_TAX in fee-floor.ts). His own
//     `stripe_tax` row, signed founder:<id>, turns on `automatic_tax` on every
//     payment link the door mints; no row, no tax line. Stripe Tax must also be
//     activated on the Stripe account (head office address, registrations),
//     which is his act in Stripe's dashboard: the link creation would fail
//     otherwise, and a failed link is refused rather than retried without tax.
//
//   * THE THRESHOLD ALERT. Read from the dated, cited thresholds below and
//     Foundry's own trailing sales on the page. A seller established outside
//     the EU owes EU VAT from the first sale of a digital service to an EU
//     consumer, and the same holds for the UK: those thresholds are ZERO. In
//     the US the lowest common state threshold is $100,000 of sales a year;
//     the buyer's state is not recorded, so per-state exposure is NOT KNOWN,
//     and the alert says so rather than pretending to a per-state count.
//
//   * THE ROUTING RULE. The buyer's country is never known here, so the page
//     offers a buyer in the EU or the UK the merchant of record that carries
//     the product (Gumroad or Lemon Squeezy collect and pay that VAT
//     themselves), once one is open, carries it and has an address a buyer
//     reaches; the buyer chooses. Otherwise the Workshop page stays the path.
// =============================================================================
import { query } from '../../../db/client.js';

export const THRESHOLDS = Object.freeze({
  eu: { cents: 0, applies: 'a seller established outside the EU, selling a digital service to an EU consumer',
    source: 'https://vat-one-stop-shop.ec.europa.eu/system/files/2021-07/vatecommerceexplanatory_notes_28102020_en.pdf (the EUR 10,000 threshold does not apply to a supplier not established in the EU)', readOn: '2026-10-09' },
  uk: { cents: 0, applies: 'a seller not established in the UK, selling digital services to UK consumers',
    source: 'https://www.gov.uk/guidance/the-vat-rules-if-you-supply-digital-services-to-private-consumers; VAT Notice 700/1', readOn: '2026-10-09' },
  us: { cents: 10_000_000, applies: 'the lowest dollar threshold most US states set for remote sellers (some are $250,000 or $500,000; taxability of digital files varies by state)',
    source: 'https://salestaxinstitute.com/resources/economic-nexus-state-guide', readOn: '2026-10-09' },
});

/** The share of a threshold at which the alert is raised: an assumption, named so. */
export const ALERT_AT = 0.8;

export interface TaxAlert { level: 'none' | 'approaching' | 'over' | 'not_known'; sentence: string }

/** Foundry's own trailing 12-month real sales on its own page, and what they mean against the thresholds. */
export async function taxThresholdAlert(founderId: string): Promise<TaxAlert[]> {
  const r = (await query(
    `SELECT COALESCE(SUM(CASE WHEN kind = 'charge' THEN amount_cents ELSE 0 END), 0)
          - COALESCE(SUM(CASE WHEN kind IN ('refund','dispute_withdrawal') THEN amount_cents ELSE 0 END), 0) AS gross,
            COUNT(CASE WHEN kind = 'charge' THEN 1 END) AS sales
       FROM economic_events WHERE founder_id = ? AND provider = 'stripe' AND evidence_mode = 'real'
        AND datetime(occurred_at) >= datetime('now', '-365 days')`, [founderId])).rows[0] as Record<string, unknown> | undefined;
  return taxAlertFrom({ grossCents: Number(r?.gross ?? 0), sales: Number(r?.sales ?? 0) });
}

/** What trailing sales on the Workshop page mean against the thresholds. Pure. */
export function taxAlertFrom(t: { grossCents: number; sales: number }): TaxAlert[] {
  const gross = t.grossCents; const sales = t.sales;
  const out: TaxAlert[] = [];
  out.push(sales === 0
    ? { level: 'none', sentence: 'No sale on the Workshop page in the last year, so no EU or UK VAT is owed on one yet.' }
    : { level: 'not_known', sentence: `${String(sales)} ${sales === 1 ? 'sale' : 'sales'} on the Workshop page in the last year. If any buyer was in the EU or the UK, VAT was due from that first sale (threshold zero for a seller outside them: ${THRESHOLDS.eu.source.split(' ')[0]!}); the buyer's country is not recorded, so whether one was is not known. A merchant-of-record channel collects it instead (PENDING 35).` });
  const share = gross / THRESHOLDS.us.cents;
  out.push({
    level: share >= 1 ? 'over' : share >= ALERT_AT ? 'approaching' : 'none',
    sentence: `$${(gross / 100).toFixed(2)} of sales on the Workshop page in the last year, ${(share * 100).toFixed(1)}% of $100,000, ${THRESHOLDS.us.applies} (${THRESHOLDS.us.source}, read ${THRESHOLDS.us.readOn}); per-state amounts are not known because the buyer's state is not recorded.`,
  });
  return out;
}

/** THE ONE RULE for which channel takes an EU or UK buyer: the first merchant of record that carries it with an address. */
export function merchantOfRecordAmong<T extends { merchantOfRecord: boolean; url: string | null }>(carriers: ReadonlyArray<T>): T | null {
  return carriers.find((x) => x.merchantOfRecord && !!x.url) ?? null;
}

/** His word on Stripe Tax for the Workshop's links, from his own signed row only. */
export async function stripeTaxOn(founderId: string): Promise<boolean> {
  const row = (await query(
    `SELECT value, set_by FROM origination_policy WHERE founder_id = ? AND requirement = 'stripe_tax' AND superseded_at IS NULL
      ORDER BY set_at DESC, rowid DESC LIMIT 1`, [founderId])).rows[0] as Record<string, unknown> | undefined;
  return !!row && String(row.set_by ?? '').startsWith('founder:') && String(row.value) === 'on';
}
