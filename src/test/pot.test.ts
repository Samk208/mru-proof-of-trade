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
  zkConfigPath,
  type MerchantPrivateState,
} from '../../contracts/index.js';
import { AMINATA, MOUSSA, LOAN_OFFER, total } from '../demo-data.js';

// @ts-expect-error WebSocket global assignment for apollo
globalThis.WebSocket = WebSocket;

// Local dev-chain funded seed (same one the upstream example uses). Local only.
const LOCAL_SEED = '0000000000000000000000000000000000000000000000000000000000000001';
const MERCHANT_STATE = 'merchantPrivateState';

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

  const prove = (merchant: MerchantPrivateState, threshold: bigint, weeklyMinimum: bigint) =>
    providers.privateStateProvider.set(MERCHANT_STATE, merchant).then(() =>
      (submitCallTx<Contract, 'proveTrade'>)(providers, {
        compiledContract: CompiledProofOfTradeContract,
        contractAddress,
        privateStateId: MERCHANT_STATE,
        circuitId: 'proveTrade',
        args: [threshold, weeklyMinimum],
      }),
    );

  const idOf = (m: MerchantPrivateState) => pureCircuits.merchantId(hexToBytes(m.secretHex));

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

  it('deploys with an empty attestation registry', async () => {
    const deployed = await (deployContract<Contract>)(providers, {
      compiledContract: CompiledProofOfTradeContract,
      privateStateId: MERCHANT_STATE,
      initialPrivateState: AMINATA,
    });
    contractAddress = deployed.deployTxData.public.contractAddress;
    logger.info(`Proof of Trade deployed at ${contractAddress}`);

    const state = await readLedger();
    expect(state.attestations.isEmpty()).toBe(true);
    expect(state.proofsIssued).toBe(0n);
  });

  it('a qualifying merchant proves the loan terms without revealing her sales', async () => {
    expect(total(AMINATA)).toBeGreaterThanOrEqual(LOAN_OFFER.threshold); // sanity on the sample

    await prove(AMINATA, LOAN_OFFER.threshold, LOAN_OFFER.weeklyMinimum);

    const state = await readLedger();
    expect(state.proofsIssued).toBe(1n);
    expect(state.attestations.member(idOf(AMINATA))).toBe(true);
    expect(state.attestations.lookup(idOf(AMINATA))).toEqual({
      threshold: LOAN_OFFER.threshold,
      weeklyMinimum: LOAN_OFFER.weeklyMinimum,
    });

    // The whole public state is one attestation (pseudonym -> terms) and a counter.
    // No sales figure, total, or merchant secret appears anywhere in it.
    const publicValues = JSON.stringify(
      [...state.attestations].map(([k, v]) => [Buffer.from(k).toString('hex'), v]),
      (_, v) => (typeof v === 'bigint' ? v.toString() : v),
    );
    for (const week of AMINATA.weeklySales) expect(publicValues).not.toContain(String(week));
    expect(publicValues).not.toContain(total(AMINATA).toString());
    expect(publicValues).not.toContain(AMINATA.secretHex);
  });

  it('cannot prove a threshold above the real sales total', async () => {
    const tooHigh = total(AMINATA) + 1n;
    await expect(prove(AMINATA, tooHigh, LOAN_OFFER.weeklyMinimum)).rejects.toThrow(
      /Sales total is below the threshold/,
    );

    const state = await readLedger();
    expect(state.proofsIssued).toBe(1n);
    expect(state.attestations.lookup(idOf(AMINATA)).threshold).toBe(LOAN_OFFER.threshold);
  });

  it('a merchant with one week below the minimum cannot get an attestation', async () => {
    expect(total(MOUSSA)).toBeGreaterThanOrEqual(LOAN_OFFER.threshold); // big total, one bad week

    await expect(prove(MOUSSA, LOAN_OFFER.threshold, LOAN_OFFER.weeklyMinimum)).rejects.toThrow(
      /A week fell below the minimum/,
    );

    const state = await readLedger();
    expect(state.attestations.member(idOf(MOUSSA))).toBe(false);
    expect(state.proofsIssued).toBe(1n);
  });

  it('the same merchant can qualify for smaller terms that match his record', async () => {
    await prove(MOUSSA, 20_000_000n, 400_000n);

    const state = await readLedger();
    expect(state.proofsIssued).toBe(2n);
    expect(state.attestations.lookup(idOf(MOUSSA))).toEqual({ threshold: 20_000_000n, weeklyMinimum: 400_000n });
  });
});
