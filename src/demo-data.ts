import { randomBytes } from 'node:crypto';
import type { MerchantState } from '../contracts/witnesses.js';

// SAMPLE data for the demo, not real merchants. Amounts are Guinean francs (GNF),
// the weekly totals a mobile-money operator (and an MRU merchant's ledger) would hold.

const random32 = () => randomBytes(32).toString('hex');

// The 12 weeks end on Sunday 2026-09-20 (days since 1970-01-01).
export const PERIOD_END = Date.UTC(2026, 8, 20) / 86_400_000;

// The mobile-money operator's signing secret. Its public key is fixed at deploy time.
export const OPERATOR_SECRET = random32();

// Lenders are identified by a public 32-byte id they publish with their offer.
export const LENDER_A = randomBytes(32); // e.g. a Conakry microfinance institution
export const LENDER_B = randomBytes(32); // e.g. a tontine (rotating savings group)

// Lender A's offer: "12 weeks totalling at least 25M GNF, and no week under 1.5M GNF."
export const LOAN_OFFER = {
  threshold: 25_000_000n,
  weeklyMinimum: 1_500_000n,
};

// Aminata runs a fabric stall in Madina market, Conakry. Steady trade.
export const AMINATA: MerchantState = {
  weeklySales: [
    2_450_000, 2_610_000, 2_380_000, 2_900_000, 3_120_000, 2_750_000,
    2_560_000, 2_830_000, 3_050_000, 2_690_000, 2_980_000, 3_240_000,
  ],
  periodEnd: PERIOD_END,
  secretHex: random32(),
  blinderHex: random32(),
};

// Moussa sells phone credit. Strong total, but his kiosk was shut for a week.
export const MOUSSA: MerchantState = {
  weeklySales: [
    3_100_000, 2_950_000, 3_300_000, 400_000, 3_050_000, 3_200_000,
    2_880_000, 3_150_000, 2_990_000, 3_060_000, 3_240_000, 3_110_000,
  ],
  periodEnd: PERIOD_END,
  secretHex: random32(),
  blinderHex: random32(),
};

export const total = (m: MerchantState): bigint =>
  m.weeklySales.reduce((acc, w) => acc + BigInt(w), 0n);
