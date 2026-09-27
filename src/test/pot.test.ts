import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { WebSocket } from 'ws';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { deployContract, submitCallTx } from '@midnight-ntwrk/midnight-js-contracts';
import type { ContractAddress } from '@midnight-ntwrk/midnight-js-protocol/compact-runtime';
import type { EnvironmentConfiguration } from '@midnight-ntwrk/testkit-js';
import pino from 'pino';

import { getConfig } from '../config.js';
import { MidnightWalletProvider, syncWallet } from '../wallet.js';
import { buildProviders, type ProofOfTradeProviders } from '../providers.js';
import {
  CompiledProofOfTradeContract,
  Contract,
  ledger,
  pureCircuits,
  hexToBytes,
  leafFor,
  zkConfigPath,
  type MerchantState,
  type PrivateState,
} from '../../contracts/index.js';
import {
  AMINATA,
  MOUSSA,
  LENDER_A,
  LENDER_B,
  LOAN_OFFER,
  OPERATOR_SECRET,
  PERIOD_END,
  total,
} from '../demo-data.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

// Local dev-chain funded seed (same one the upstream example uses). Local only.
const LOCAL_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const STATE_ID = 'proofOfTradePrivateState';

const logger = pino({ level: process.env['LOG_LEVEL'] ?? 'info', transport: { target: 'pino-pretty' } });

describe('MRU Proof of Trade (local)', () => {
  let wallet: MidnightWalletProvider;
  let providers: ProofOfTradeProviders;
  let contractAddress: ContractAddress;
  const config = getConfig();

  const readLedger = async () => {
    const state = await providers.publicDataProvider.queryContractState(contractAddress);
    expect(state).not.toBeNull();
    return ledger(state!.data);
  };

  // Each call runs as one party: set that party's private state, then submit.
  const asOperator: PrivateState = { operatorSecretHex: OPERATOR_SECRET };
  const asMerchant = (m: MerchantState): PrivateState => ({ merchant: m });

  const recordAs = async (party: PrivateState, leaf: Uint8Array) => {
    await providers.privateStateProvider.set(STATE_ID, party);
    return (submitCallTx<Contract, 'recordSales'>)(providers, {
      compiledContract: CompiledProofOfTradeContract,
      contractAddress,
      privateStateId: STATE_ID,
      circuitId: 'recordSales',
      args: [leaf],
    });
  };

  const prove = async (m: MerchantState, lender: Uint8Array, threshold: bigint, weeklyMinimum: bigint) => {
    await providers.privateStateProvider.set(STATE_ID, asMerchant(m));
    return (submitCallTx<Contract, 'proveTrade'>)(providers, {
      compiledContract: CompiledProofOfTradeContract,
      contractAddress,
      privateStateId: STATE_ID,
      circuitId: 'proveTrade',
      args: [lender, threshold, weeklyMinimum],
    });
  };

  const idOf = (m: MerchantState, lender: Uint8Array) =>
    pureCircuits.merchantId(hexToBytes(m.secretHex), lender);

  beforeAll(async () => {
    setNetworkId(config.networkId);
    const envConfig: EnvironmentConfiguration = {
      walletNetworkId: config.networkId,
      networkId: config.networkId,
      indexer: config.indexer,
      indexerWS: config.indexerWS,
      node: config.node,
      nodeWS: config.nodeWS,
      faucet: config.faucet,
      proofServer: config.proofServer,
    };
    wallet = await MidnightWalletProvider.build(logger, envConfig, { kind: 'seed', value: LOCAL_SEED });
    await wallet.start();
    await syncWallet(logger, wallet.wallet, 10 * 60_000);
    providers = buildProviders(wallet, zkConfigPath, config);
  });

  afterAll(async () => {
    if (wallet) await wallet.stop();
  });

  it('deploys with the operator key and an empty registry', async () => {
    const operatorKey = pureCircuits.publicKeyOf(hexToBytes(OPERATOR_SECRET));
    const deployed = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledProofOfTradeContract,
      privateStateId: STATE_ID,
      initialPrivateState: asOperator,
      args: [operatorKey],
    });
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Proof of Trade deployed at ${contractAddress}`);

    const state = await readLedger();
    expect(state.operatorKey).toEqual(operatorKey);
    expect(state.salesRecords.firstFree()).toBe(0n);
    expect(state.attestations.isEmpty()).toBe(true);
    expect(state.proofsIssued).toBe(0n);
  });

  it("the operator records merchants' weekly sales as hidden commitments", async () => {
    await recordAs(asOperator, leafFor(AMINATA));
    await recordAs(asOperator, leafFor(MOUSSA));

    const state = await readLedger();
    expect(state.salesRecords.firstFree()).toBe(2n);
    expect(state.salesRecords.findPathForLeaf(leafFor(AMINATA))).toBeDefined();
    expect(state.salesRecords.findPathForLeaf(leafFor(MOUSSA))).toBeDefined();
  });

  it('only the operator can record sales', async () => {
    const impostor: PrivateState = { operatorSecretHex: 'ff'.repeat(32) };
    const forged: MerchantState = { ...AMINATA, weeklySales: AMINATA.weeklySales.map((w) => w * 10) };

    await expect(recordAs(impostor, leafFor(forged))).rejects.toThrow(/Only the operator can record sales/);
    expect((await readLedger()).salesRecords.firstFree()).toBe(2n);
  });

  it('a qualifying merchant proves the loan terms without revealing her sales', async () => {
    expect(total(AMINATA)).toBeGreaterThanOrEqual(LOAN_OFFER.threshold); // sanity on the sample

    await prove(AMINATA, LENDER_A, LOAN_OFFER.threshold, LOAN_OFFER.weeklyMinimum);

    const state = await readLedger();
    expect(state.proofsIssued).toBe(1n);
    expect(state.attestations.lookup(idOf(AMINATA, LENDER_A))).toEqual({
      threshold: LOAN_OFFER.threshold,
      weeklyMinimum: LOAN_OFFER.weeklyMinimum,
      periodEnd: BigInt(PERIOD_END),
    });

    // Public attestations hold a pseudonym and the terms only: no sales figure, total,
    // secret, blinder, or the operator's commitment (so the record can't be linked either).
    const publicValues = JSON.stringify(
      [...state.attestations].map(([k, v]) => [Buffer.from(k).toString('hex'), v]),
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const week of AMINATA.weeklySales) expect(publicValues).not.toContain(String(week));
    expect(publicValues).not.toContain(total(AMINATA).toString());
    expect(publicValues).not.toContain(AMINATA.secretHex);
    expect(publicValues).not.toContain(AMINATA.blinderHex);
    expect(publicValues).not.toContain(Buffer.from(leafFor(AMINATA)).toString('hex'));
  });

  it('cannot prove a threshold above the real sales total', async () => {
    const tooHigh = total(AMINATA) + 1n;
    await expect(prove(AMINATA, LENDER_A, tooHigh, LOAN_OFFER.weeklyMinimum)).rejects.toThrow(
      /Sales total is below the threshold/,
    );

    const state = await readLedger();
    expect(state.proofsIssued).toBe(1n);
    expect(state.attestations.lookup(idOf(AMINATA, LENDER_A)).threshold).toBe(LOAN_OFFER.threshold);
  });

  it("edited sales figures fail: they no longer match the operator's record", async () => {
    // Moussa hides his bad week by typing in a better number. His real record fails the
    // lender's weekly minimum; the edited one would pass, but the operator never recorded it.
    const edited: MerchantState = {
      ...MOUSSA,
      weeklySales: MOUSSA.weeklySales.map((w) => Math.max(w, 2_000_000)),
    };

    await expect(prove(edited, LENDER_A, LOAN_OFFER.threshold, LOAN_OFFER.weeklyMinimum)).rejects.toThrow(
      /Sales record not attested by operator/,
    );

    const state = await readLedger();
    expect(state.attestations.member(idOf(MOUSSA, LENDER_A))).toBe(false);
    expect(state.proofsIssued).toBe(1n);
  });

  it('a merchant with one week below the minimum cannot get an attestation', async () => {
    expect(total(MOUSSA)).toBeGreaterThanOrEqual(LOAN_OFFER.threshold); // big total, one bad week

    await expect(prove(MOUSSA, LENDER_A, LOAN_OFFER.threshold, LOAN_OFFER.weeklyMinimum)).rejects.toThrow(
      /A week fell below the minimum/,
    );

    const state = await readLedger();
    expect(state.attestations.member(idOf(MOUSSA, LENDER_A))).toBe(false);
    expect(state.proofsIssued).toBe(1n);
  });

  it('the same merchant can qualify with another lender on terms that match his record', async () => {
    await prove(MOUSSA, LENDER_B, 20_000_000n, 400_000n);

    const state = await readLedger();
    expect(state.proofsIssued).toBe(2n);
    expect(state.attestations.lookup(idOf(MOUSSA, LENDER_B))).toEqual({
      threshold: 20_000_000n,
      weeklyMinimum: 400_000n,
      periodEnd: BigInt(PERIOD_END),
    });
  });

  it('two lenders see unlinkable pseudonyms for the same merchant', async () => {
    await prove(AMINATA, LENDER_B, 20_000_000n, 1_000_000n);

    const toLenderA = idOf(AMINATA, LENDER_A);
    const toLenderB = idOf(AMINATA, LENDER_B);
    expect(Buffer.from(toLenderA).equals(Buffer.from(toLenderB))).toBe(false);

    const state = await readLedger();
    expect(state.proofsIssued).toBe(3n);
    expect(state.attestations.size()).toBe(3n);
    expect(state.attestations.lookup(toLenderA).threshold).toBe(LOAN_OFFER.threshold);
    expect(state.attestations.lookup(toLenderB).threshold).toBe(20_000_000n);
  });
});
