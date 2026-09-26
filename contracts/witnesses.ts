import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from './managed/proof-of-trade/contract/index.js';

export const WEEKS = 12;

// Lives only in the merchant's local private-state store; never sent on-chain.
// Plain JSON types so the level private-state provider can persist it as-is.
export type MerchantPrivateState = {
  weeklySales: number[]; // 12 weekly totals in minor currency units, oldest first
  secretHex: string; // 32-byte merchant secret
};

export const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));

export const witnesses = {
  weeklySales: ({
    privateState,
  }: WitnessContext<Ledger, MerchantPrivateState>): [MerchantPrivateState, bigint[]] => {
    if (privateState.weeklySales.length !== WEEKS) {
      throw new Error(`Expected ${WEEKS} weekly totals, got ${privateState.weeklySales.length}`);
    }
    return [privateState, privateState.weeklySales.map(BigInt)];
  },
  merchantSecret: ({
    privateState,
  }: WitnessContext<Ledger, MerchantPrivateState>): [MerchantPrivateState, Uint8Array] => [
    privateState,
    hexToBytes(privateState.secretHex),
  ],
};
