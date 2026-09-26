import type { MerchantPrivateState } from '../contracts/witnesses.js';

// SAMPLE data for the demo, not real merchants. Amounts are Guinean francs (GNF),
// the weekly totals an MRU merchant's voice-logged sales ledger would produce.

// A lender's offer: "12 weeks totalling at least 25M GNF, and no week under 1.5M GNF."
export const LOAN_OFFER = {
  threshold: 25_000_000n,
  weeklyMinimum: 1_500_000n,
};

// Aminata runs a fabric stall in Madina market, Conakry. Steady trade.
export const AMINATA: MerchantPrivateState = {
  weeklySales: [
    2_450_000, 2_610_000, 2_380_000, 2_900_000, 3_120_000, 2_750_000,
    2_560_000, 2_830_000, 3_050_000, 2_690_000, 2_980_000, 3_240_000,
  ],
  secretHex: 'a1'.repeat(32),
};

// Moussa sells phone credit. Strong total, but his kiosk was shut for a week.
export const MOUSSA: MerchantPrivateState = {
  weeklySales: [
    3_100_000, 2_950_000, 3_300_000, 400_000, 3_050_000, 3_200_000,
    2_880_000, 3_150_000, 2_990_000, 3_060_000, 3_240_000, 3_110_000,
  ],
  secretHex: 'b2'.repeat(32),
};

export const total = (s: MerchantPrivateState): bigint =>
  s.weeklySales.reduce((acc, w) => acc + BigInt(w), 0n);
