# MRU Proof of Trade

**A market merchant proves "my operator-recorded sales meet your loan terms" without showing anyone a single sales figure.**

Built on [Midnight](https://midnight.network) for the Midnight Korea Hackathon 2026.

## The problem

Most market merchants in West Africa (Guinea, Liberia, the Mano River basin) have no credit
history. Their only evidence of creditworthiness is their sales record, so a lender or a savings
group asks to see it. Handing it over is a real cost: it exposes suppliers, margins and customers
to whoever sees it, and it creates a tax and competitive risk. Many merchants therefore never ask.
Mobile-money lenders that do serve them see everything.

Most of these merchants are already paid through mobile money (MTN MoMo, Orange Money), so their
operator holds a trustworthy record of weekly takings. MRU Merchant OS is a voice-first sales ledger
for these merchants. Proof of Trade lets a merchant **use** that record **without disclosing it**.

## What it does

1. **The operator records.** For each merchant, the mobile-money operator publishes a hiding
   commitment to her 12 weekly totals into an on-chain Merkle tree. Only the operator's key can add
   records. The commitment reveals nothing without a blinder that only the operator and the
   merchant hold.
2. **A lender publishes terms**, for example:
   > 12 weeks of sales totalling at least **25,000,000 GNF**, and no week below **1,500,000 GNF**.
3. **The merchant proves.** Her device runs a zero-knowledge circuit showing that one of the
   operator's records is hers, and that it meets the terms. If, and only if, all of that holds, the
   public ledger records:

```
merchant pseudonym (for this lender)  ->  { threshold: 25,000,000, weeklyMinimum: 1,500,000, periodEnd: 2026-09-20 }
```

That is all anyone learns. Nobody sees the weekly figures, the total, or the margin she cleared
the terms by. Nobody learns **which** operator record is hers, or her identity. The pseudonym is
different for every lender, so two lenders (or anyone watching the chain) cannot tell they are
dealing with the same merchant. And because the figures must match the operator's record, she
cannot simply type in better numbers.

## How Midnight is used

| Midnight feature | Where | Why it matters here |
|---|---|---|
| **Witnesses (private inputs)** | `salesRecord()`, `recordBlinder()`, `merchantSecret()`, `recordPath()`, `operatorSecret()` in [`contracts/proof-of-trade.compact`](contracts/proof-of-trade.compact), supplied by [`contracts/witnesses.ts`](contracts/witnesses.ts) | Weekly totals, secrets and the Merkle path never leave the prover's device. |
| **`HistoricMerkleTree` + `merkleTreePathRoot` / `checkRoot`** | `salesRecords` ledger field, checked in `proveTrade` | Proves the merchant's record is one the operator published, **without revealing which leaf**. The historic tree lets old proofs stay valid as the operator adds records. |
| **`persistentCommit` (hiding commitment)** | `salesLeaf(record, blinder)` | The operator's on-chain records reveal nothing about anyone's sales. |
| **Key-based authorisation (no `ownPublicKey()`)** | `recordSales` asserts `publicKeyOf(operatorSecret()) == operatorKey`; the operator key is set by the `constructor` | Only the operator can add records, and the check is bound to a secret the prover must actually know. |
| **Ownership binding** | `record.owner == ownerKey(merchantSecret())` | A merchant cannot use someone else's record. |
| **Circuit assertions over private data** | every week `>= weeklyMinimum`, total `>= threshold` | The lender's rules are enforced inside the proof. A merchant who doesn't qualify cannot produce a transaction at all. |
| **Selective disclosure with `disclose()`** | Only the pseudonym, the terms, the attested period and the tree root (already public) are disclosed | The compiler forces every private-to-public flow to be explicit, so it is auditable that no sales figure is published. |
| **Per-lender pseudonym** | `merchantId(secret, lender)` = `persistentHash([pad(32, "mru:proof-of-trade:merchant:v1"), secret, lender])` | Unlinkable across lenders. A 32-byte random secret means it can't be brute-forced. |
| **Public ledger state** | `attestations: Map<Bytes<32>, Attestation>`, `proofsIssued: Counter` | Anyone can verify an attestation; nobody can read the data behind it. |

## Run it

Midnight tooling runs on Linux/macOS (on Windows, use WSL2). You need Node 22+, Docker and yarn.

```bash
# 1. Compact compiler, pinned to the version the runtime packages expect
curl --proto '=https' --tlsv1.2 -LsSf https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
compact update 0.31.1

# 2. Dependencies and contract
yarn install
yarn compile

# 3. Local Midnight network: node, indexer, proof server
yarn env:up

# 4. Deploy and run the demo scenario (about 2.5 minutes, real proofs)
yarn test:local

yarn env:down
```

> `compact` 0.34 compiles fine but its output needs a newer `compact-runtime` than the pinned
> midnight-js 4.1.1 packages ship ("compiled code expects 0.19.0, runtime is 0.16.0"). Use 0.31.1.

## Demo flow

`yarn test:local` runs the whole story against a real local Midnight chain, with real proofs
(from the local proof server) and real transactions. Sample data is in
[`src/demo-data.ts`](src/demo-data.ts). The merchants are fictional.

1. **Deploy** with the operator's public key. The registry and attestations start empty.
2. **The operator records** Aminata's and Moussa's 12-week sales as hidden commitments.
3. **An impostor can't record.** A forged record with 10x sales, submitted without the operator's
   key, is refused ("Only the operator can record sales").
4. **Aminata qualifies.** She runs a fabric stall in Madina market, Conakry: 33.56M GNF over 12
   weeks. She proves the lender's terms. The public state gains one attestation, and the test
   checks it contains none of her figures, her total, her secret, her blinder, or the operator's
   commitment to her record.
5. **She can't overclaim.** Proving a threshold of her real total + 1 GNF is refused ("Sales total
   is below the threshold").
6. **Edited figures fail.** Moussa's kiosk was shut for a week (400,000 GNF). He types in 2M for that
   week to pass. The proof is refused ("Sales record not attested by operator"): his edited
   figures don't match anything the operator recorded.
7. **His real record is refused** for these terms ("A week fell below the minimum").
8. **Moussa qualifies with a tontine** on terms that fit his real record (20M total, 400k weekly
   minimum), again without the tontine seeing his sales.
9. **Two lenders can't link her.** Aminata also proves terms to the tontine. The ledger holds two
   attestations for her under two unrelated pseudonyms.

```
✓ deploys with the operator key and an empty registry
✓ the operator records merchants' weekly sales as hidden commitments
✓ only the operator can record sales
✓ a qualifying merchant proves the loan terms without revealing her sales
✓ cannot prove a threshold above the real sales total
✓ edited sales figures fail: they no longer match the operator's record
✓ a merchant with one week below the minimum cannot get an attestation
✓ the same merchant can qualify with another lender on terms that match his record
✓ two lenders see unlinkable pseudonyms for the same merchant
Tests  9 passed (9)
```

## Where the trust comes from

| Tier | Example | This project |
|---|---|---|
| Self-reported numbers | typed into a form | No longer: edited figures are refused (step 6) |
| **Issuer-attested commitment** | operator publishes a hiding commitment; the holder proves in ZK | **This project** (same pattern as issuer-signed credential systems) |
| Proof of the source session (zkTLS) | prove data straight from the operator's API session | A future option if operators won't publish commitments |

The operator is trusted to record true takings, which it already does as the payment rail. It
learns nothing about which lender a merchant approaches, or what she proved.

## Security and privacy notes

Checked against Midnight's [smart contract security guidance](https://docs.midnight.network/compact/smart-contract-security):

- **Witnesses are untrusted.** Ownership, operator membership (Merkle root), weekly minimum and total are all re-checked inside the circuit.
- **Authorisation is bound to a secret key.** `publicKeyOf(secret) == operatorKey` is used, never `ownPublicKey()`.
- **Hiding commitments.** Operator records use `persistentCommit` with a per-merchant random blinder, so no blinder is reused across records.
- **Pseudonyms can't be linked or brute-forced.** They are domain-separated, versioned, per-lender hashes of a 32-byte random secret.
- **Minimal, late disclosure.** `disclose()` is applied at the ledger write.
- **Assertion messages name no week and no figure.** A failed proof never produces a transaction.
- **No overflow.** 12 × (2³² − 1) < 2³⁶, so the 64-bit total cannot overflow.
- **Dependencies are clean.** `yarn audit` reports 0 vulnerabilities, with patched versions pinned via `resolutions`.
- **No secrets in the repo.** The only key-like values are Midnight's public local-dev seed and compose defaults for a local-only stack. Demo secrets are generated at random each run.

## Limits and next steps

- **Freshness policy is the lender's call.** Attestations carry `periodEnd`; a lender should
  require a recent one. An expiry check in-circuit (against block time) is a natural addition.
- **One operator key.** A production version would hold a set of licensed operators, with key rotation.
- **One attestation per pseudonym.** A new proof overwrites the old one, so a merchant keeps her
  latest claim with each lender.
- **Runs on a local network in this repo.** Deploying to Midnight Preprod needs a funded tDUST wallet
  (see `.env.preprod.example`); the contract and code are unchanged.

## Project layout

```
contracts/proof-of-trade.compact   the Compact contract (operator registry, circuit, ledger)
contracts/witnesses.ts             private inputs for the operator and merchant roles
contracts/index.ts                 compiled-contract wiring
src/demo-data.ts                   sample merchants, operator and loan terms (fictional)
src/test/pot.test.ts               end-to-end demo against a local Midnight network
src/{config,providers,wallet}.ts   network, provider and wallet setup
compose.yml                        local node, indexer and proof server
```

Scaffolded from [midnightntwrk/example-hello-world](https://github.com/midnightntwrk/example-hello-world) (Apache-2.0).
