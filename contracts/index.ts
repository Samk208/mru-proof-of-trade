import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';
import path from 'node:path';
import { Contract } from './managed/proof-of-trade/contract/index.js';
import { witnesses } from './witnesses.js';

export {
  Contract,
  ledger,
  pureCircuits,
  type Ledger,
  type Attestation,
  type SalesRecord,
} from './managed/proof-of-trade/contract/index.js';
export * from './witnesses.js';

const currentDir = path.resolve(new URL(import.meta.url).pathname, '..');
export const zkConfigPath = path.resolve(currentDir, 'managed', 'proof-of-trade');

export const CompiledProofOfTradeContract = CompiledContract.make(
  'ProofOfTradeContract',
  Contract,
).pipe(
  CompiledContract.withWitnesses(witnesses),
  CompiledContract.withCompiledFileAssets(zkConfigPath),
);
