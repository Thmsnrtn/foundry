// =============================================================================
// FOUNDRY — the exchange a commercial observation was made under.
//
// "Paid twenty-nine dollars" is not one fact. Paid before receiving anything,
// and paid afterwards by somebody who had already read it, are different
// observations about willingness to pay; the ledger could record only the
// first half of that sentence. This resolves the exchange from the probe's own
// sealed design so every outcome event keeps the instrument that produced it.
//
// Its own module because `outcome.ts` is kernel-level and must not learn about
// probe deliberation, and because a null answer is correct rather than
// exceptional: rows written before designs existed were made under an exchange
// nobody recorded, and inventing one for them is the exact collapse the column
// exists to prevent.
// =============================================================================
import { query } from '../../db/client.js';

export async function exchangeOf(experimentId: string): Promise<string | null> {
  const r = (await query('SELECT exchange FROM probe_designs WHERE experiment_id = ?', [experimentId]))
    .rows[0] as Record<string, unknown> | undefined;
  return r ? String(r.exchange) : null;
}
