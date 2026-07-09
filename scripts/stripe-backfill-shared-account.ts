#!/usr/bin/env tsx
/**
 * ONE-SHOT shared-account backfill (see docs/stripe-shared-account.md).
 *
 * Brings the EXISTING live objects in the shared Stripe account
 * (acct_1SATMcRx25BFZ1Jm) up to the convention:
 *   - AcreOS + Foundry products  → app, app_object, plan_key, statement_descriptor
 *   - AcreOS + Foundry prices     → app, plan_key, billing_period + native lookup_key
 *   - Land sale products          → app:land (metadata only; prices/subs untouched)
 *
 * Metadata is MERGED by Stripe, so existing keys (acreos_product, tier, …) are
 * preserved. lookup_key uses transfer_lookup_key so re-runs never collide.
 * Idempotent: safe to run repeatedly.
 *
 * Usage:
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-backfill-shared-account.ts            # dry run
 *   STRIPE_SECRET_KEY=sk_live_... npx tsx scripts/stripe-backfill-shared-account.ts --apply    # write
 */
import Stripe from "stripe";

const APPLY = process.argv.includes("--apply");
const secret = process.env.STRIPE_SECRET_KEY;
if (!secret) { console.error("STRIPE_SECRET_KEY required"); process.exit(1); }
const stripe = new Stripe(secret, { apiVersion: "2023-10-16" as Stripe.LatestApiVersion });

type ProdPatch = { id: string; app: string; app_object?: string; plan_key?: string; descriptor?: string };
type PricePatch = { id: string; app: string; plan_key: string; period: "monthly" | "yearly" | "one_time"; lookup: string };

// ── AcreOS products ──────────────────────────────────────────────────────────
const ACREOS_PRODUCTS: ProdPatch[] = [
  { id: "prod_UW5G4XDwEmdFPn", app: "acreos", app_object: "plan", plan_key: "starter", descriptor: "ACREOS" },
  { id: "prod_UW5GkPzkV9F6vj", app: "acreos", app_object: "plan", plan_key: "pro", descriptor: "ACREOS" },
  { id: "prod_UW5GMSenTLWUWe", app: "acreos", app_object: "plan", plan_key: "scale", descriptor: "ACREOS" },
  { id: "prod_UW5GyK7PSVjVpM", app: "acreos", app_object: "seat", plan_key: "pro", descriptor: "ACREOS" },
  { id: "prod_UW5G8vlYd8x5dB", app: "acreos", app_object: "seat", plan_key: "scale", descriptor: "ACREOS" },
  { id: "prod_UW5G9Ei0yXNZFl", app: "acreos", app_object: "pack", plan_key: "note_investor", descriptor: "ACREOS" },
  { id: "prod_UW5GwPBztxWCSI", app: "acreos", app_object: "pack", plan_key: "buy_and_hold", descriptor: "ACREOS" },
  { id: "prod_UW5GeuRxrDYKH9", app: "acreos", app_object: "pack", plan_key: "fix_and_flipper", descriptor: "ACREOS" },
  { id: "prod_UW5GSK9u4MTzbl", app: "acreos", app_object: "pack", plan_key: "subdivision", descriptor: "ACREOS" },
  { id: "prod_UW5GW9QqBa0rI5", app: "acreos", app_object: "pack", plan_key: "wholesale", descriptor: "ACREOS" },
];

// ── AcreOS prices ────────────────────────────────────────────────────────────
const ACREOS_PRICES: PricePatch[] = [
  { id: "price_1TX35kRx25BFZ1JmMGCu9sjY", app: "acreos", plan_key: "starter", period: "monthly", lookup: "acreos_starter_monthly" },
  { id: "price_1TX35kRx25BFZ1Jm1MpuQjYT", app: "acreos", plan_key: "starter", period: "yearly", lookup: "acreos_starter_yearly" },
  { id: "price_1TX35lRx25BFZ1Jm3M4y5viT", app: "acreos", plan_key: "pro", period: "monthly", lookup: "acreos_pro_monthly" },
  { id: "price_1TX35lRx25BFZ1JmhHKBsrR5", app: "acreos", plan_key: "pro", period: "yearly", lookup: "acreos_pro_yearly" },
  { id: "price_1TX35mRx25BFZ1JmBd6IUYNj", app: "acreos", plan_key: "scale", period: "monthly", lookup: "acreos_scale_monthly" },
  { id: "price_1TX35nRx25BFZ1JmTf80IXY2", app: "acreos", plan_key: "scale", period: "yearly", lookup: "acreos_scale_yearly" },
  { id: "price_1TX35nRx25BFZ1JmtjVnhuio", app: "acreos", plan_key: "pro", period: "monthly", lookup: "acreos_seat_pro_monthly" },
  { id: "price_1TX35oRx25BFZ1JmZu1rmA1G", app: "acreos", plan_key: "pro", period: "yearly", lookup: "acreos_seat_pro_yearly" },
  { id: "price_1TX35oRx25BFZ1Jmk8Z3YueS", app: "acreos", plan_key: "scale", period: "monthly", lookup: "acreos_seat_scale_monthly" },
  { id: "price_1TX35pRx25BFZ1JmMLJ2JA3k", app: "acreos", plan_key: "scale", period: "yearly", lookup: "acreos_seat_scale_yearly" },
  { id: "price_1TX35pRx25BFZ1Jm1x9jgzZZ", app: "acreos", plan_key: "note_investor", period: "monthly", lookup: "acreos_pack_note_investor_monthly" },
  { id: "price_1TX35qRx25BFZ1Jmj7K9tHcN", app: "acreos", plan_key: "note_investor", period: "yearly", lookup: "acreos_pack_note_investor_yearly" },
  { id: "price_1TX35qRx25BFZ1JmhZcqKApW", app: "acreos", plan_key: "buy_and_hold", period: "monthly", lookup: "acreos_pack_buy_and_hold_monthly" },
  { id: "price_1TX35rRx25BFZ1JmK8W5UauT", app: "acreos", plan_key: "buy_and_hold", period: "yearly", lookup: "acreos_pack_buy_and_hold_yearly" },
  { id: "price_1TX35rRx25BFZ1Jm9VZnVtes", app: "acreos", plan_key: "fix_and_flipper", period: "monthly", lookup: "acreos_pack_fix_and_flipper_monthly" },
  { id: "price_1TX35sRx25BFZ1JmlaGoQScV", app: "acreos", plan_key: "fix_and_flipper", period: "yearly", lookup: "acreos_pack_fix_and_flipper_yearly" },
  { id: "price_1TX35tRx25BFZ1JmmlQhtGXG", app: "acreos", plan_key: "subdivision", period: "monthly", lookup: "acreos_pack_subdivision_monthly" },
  { id: "price_1TX35tRx25BFZ1JmqC4ziRrY", app: "acreos", plan_key: "subdivision", period: "yearly", lookup: "acreos_pack_subdivision_yearly" },
  { id: "price_1TX35uRx25BFZ1JmE2Ccjynj", app: "acreos", plan_key: "wholesale", period: "monthly", lookup: "acreos_pack_wholesale_monthly" },
  { id: "price_1TX35uRx25BFZ1JmfLHnfU4u", app: "acreos", plan_key: "wholesale", period: "yearly", lookup: "acreos_pack_wholesale_yearly" },
];

// ── Foundry ──────────────────────────────────────────────────────────────────
const FOUNDRY_PRODUCTS: ProdPatch[] = [
  { id: "prod_ULJCAvVQCYi864", app: "foundry", app_object: "plan", descriptor: "FOUNDRY" },
];
const FOUNDRY_PRICES: PricePatch[] = [
  { id: "price_1TrGcQRx25BFZ1JmKX8LLjUU", app: "foundry", plan_key: "solo", period: "monthly", lookup: "foundry_solo_monthly" },
  { id: "price_1TMcZoRx25BFZ1JmvZC3Ebig", app: "foundry", plan_key: "growth", period: "monthly", lookup: "foundry_growth_monthly" },
  { id: "price_1TMcZpRx25BFZ1JmZauYkItz", app: "foundry", plan_key: "investor_ready", period: "monthly", lookup: "foundry_investor_ready_monthly" },
  { id: "price_1TMcZoRx25BFZ1JmLSzy4AlJ", app: "foundry", plan_key: "founding", period: "monthly", lookup: "foundry_founding_monthly" },
];

// ── Land sales — metadata tag ONLY. Prices, subscriptions, descriptors untouched.
const LAND_PRODUCTS: ProdPatch[] = [
  { id: "prod_THzsLFGlL7qRnw", app: "land" }, // Luna County — 0.5 Acre
  { id: "prod_TI1Dz41o0DrUWT", app: "land" }, // Luna County — 1 Acre Lot
  { id: "prod_TtScPYfiX2iIvo", app: "land" }, // Down Payment
  { id: "prod_TplQfyL4FjRTmo", app: "land" }, // Doc Fee
];

async function patchProduct(p: ProdPatch) {
  const meta: Record<string, string> = { app: p.app };
  if (p.app_object) meta.app_object = p.app_object;
  if (p.plan_key) meta.plan_key = p.plan_key;
  const params: Stripe.ProductUpdateParams = { metadata: meta };
  if (p.descriptor) params.statement_descriptor = p.descriptor;
  console.log(`  product ${p.id} ← ${JSON.stringify(meta)}${p.descriptor ? ` descriptor=${p.descriptor}` : ""}`);
  if (APPLY) await stripe.products.update(p.id, params);
}

async function patchPrice(p: PricePatch) {
  console.log(`  price   ${p.id} ← app=${p.app} plan_key=${p.plan_key} lookup_key=${p.lookup}`);
  if (APPLY) {
    await stripe.prices.update(p.id, {
      lookup_key: p.lookup,
      transfer_lookup_key: true,
      metadata: { app: p.app, plan_key: p.plan_key, billing_period: p.period },
    });
  }
}

async function main() {
  console.log(`Shared-account backfill ${APPLY ? "(APPLY)" : "(DRY RUN — pass --apply to write)"}\n`);
  console.log("AcreOS products:");   for (const p of ACREOS_PRODUCTS) await patchProduct(p);
  console.log("AcreOS prices:");     for (const p of ACREOS_PRICES) await patchPrice(p);
  console.log("Foundry products:");  for (const p of FOUNDRY_PRODUCTS) await patchProduct(p);
  console.log("Foundry prices:");    for (const p of FOUNDRY_PRICES) await patchPrice(p);
  console.log("Land products (tag only):"); for (const p of LAND_PRODUCTS) await patchProduct(p);
  console.log(`\nDone. ${APPLY ? "Applied." : "No changes written (dry run)."}`);
}

main().catch((err) => { console.error(err); process.exit(1); });
