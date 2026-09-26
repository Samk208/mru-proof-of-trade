import { type MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { type MidnightWalletProvider } from './wallet.js';
import { type NetworkConfig } from './config.js';

export type ProofOfTradeCircuits = 'proveTrade';

export type ProofOfTradeProviders = MidnightProviders<any>;

export function buildProviders(
    wallet: MidnightWalletProvider,
    zkConfigPath: string,
    config: NetworkConfig,
): ProofOfTradeProviders {
    const zkConfigProvider = new NodeZkConfigProvider<ProofOfTradeCircuits>(zkConfigPath);

    return {
        // The merchant's sales vector and secret live here, on the merchant's device only.
        privateStateProvider: levelPrivateStateProvider({
            privateStateStoreName: `proof-of-trade-${Date.now()}`,
            privateStoragePasswordProvider: () => 'Proof-Of-Trade-Local-Demo-Password',
            accountId: wallet.getCoinPublicKey(),
        }),
        publicDataProvider: indexerPublicDataProvider(
            config.indexer,
            config.indexerWS,
        ),
        zkConfigProvider,
        proofProvider: httpClientProofProvider(
            config.proofServer,
            zkConfigProvider,
        ),
        walletProvider: wallet,
        midnightProvider: wallet,
    };
}
