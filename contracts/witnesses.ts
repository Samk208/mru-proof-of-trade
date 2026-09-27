import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import {
  pureCircuits,
  type Ledger,
  type SalesRecord,
} from './managed/proof-of-trade/contract/index.js';

export const WEEKS = 12;

// What the merchant's device holds after onboarding with the operator. Never sent on-chain.
// Plain JSON types so the level private-state provider can persist it as-is.
export type MerchantState = {
  weeklySales: number[]; // 12 weekly totals in minor currency units, oldest first
  periodEnd: number; // last day covered, days since 1970-01-01
  secretHex: string; // 32-byte merchant secret (random)
  blinderHex: string; // 32-byte commitment blinder, shared by the operator with the merchant
};

// One private-state shape for both roles: the operator holds only its key,
// a merchant holds only her record.
export type PrivateState = {
  operatorSecretHex?: string;
  merchant?: MerchantState;
};

export const hexToBytes = (hex: string): Uint8Array =>
  Uint8Array.from(hex.match(/../g)!.map((b) => parseInt(b, 16)));

const need = <T>(value: T | undefined, what: string): T => {
  if (value === undefined) throw new Error(`Private state has no ${what}`);
  return value;
};

export const toSalesRecord = (m: MerchantState, owner: Uint8Array): SalesRecord => {
  if (m.weeklySales.length !== WEEKS) {
    throw new Error(`Expected ${WEEKS} weekly totals, got ${m.weeklySales.length}`);
  }
  return { weeks: m.weeklySales.map(BigInt), periodEnd: BigInt(m.periodEnd), owner };
};

type Ctx = WitnessContext<Ledger, PrivateState>;

export const witnesses = {
  operatorSecret: ({ privateState }: Ctx): [PrivateState, Uint8Array] => [
    privateState,
    hexToBytes(need(privateState.operatorSecretHex, 'operator key')),
  ],

  merchantSecret: ({ privateState }: Ctx): [PrivateState, Uint8Array] => [
    privateState,
    hexToBytes(need(privateState.merchant, 'merchant record').secretHex),
  ],

  recordBlinder: ({ privateState }: Ctx): [PrivateState, Uint8Array] => [
    privateState,
    hexToBytes(need(privateState.merchant, 'merchant record').blinderHex),
  ],

  // The circuit re-checks owner == ownerKey(secret), so a merchant can't use another's record.
  salesRecord: ({ privateState }: Ctx): [PrivateState, SalesRecord] => {
    const m = need(privateState.merchant, 'merchant record');
    return [privateState, toSalesRecord(m, pureCircuits.ownerKey(hexToBytes(m.secretHex)))];
  },

  // Find this leaf in the operator's tree. If it isn't there (edited figures), hand back
  // a path for slot 0 anyway: its root won't match, so the circuit itself refuses.
  recordPath: ({ privateState, ledger }: Ctx, leaf: Uint8Array) => [
    privateState,
    ledger.salesRecords.findPathForLeaf(leaf) ?? ledger.salesRecords.pathForLeaf(0n, leaf),
  ],
};

// What the operator publishes for a merchant: a hiding commitment to her record.
export const leafFor = (m: MerchantState): Uint8Array =>
  pureCircuits.salesLeaf(
    toSalesRecord(m, pureCircuits.ownerKey(hexToBytes(m.secretHex))),
    hexToBytes(m.blinderHex),
  );
