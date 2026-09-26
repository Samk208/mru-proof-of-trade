# MRU Proof of Trade

**A market merchant proves "I sell enough, steadily enough, to repay this loan" without showing anyone her sales.**

Built on [Midnight](https://midnight.network) for the Midnight Korea Hackathon 2026.

## The problem

Most market merchants in West Africa (Guinea, Liberia, the Mano River basin) have no credit
history. Their only evidence of creditworthiness is their sales record, so a lender or a savings
group asks to see it. Handing it over is a real cost: it exposes suppliers, margins and customers
to whoever sees it, and it creates a tax and competitive risk. Many merchants therefore never ask.

MRU Merchant OS is a voice-first sales ledger for these merchants, with Mobile Money built in. It
already knows their weekly totals. Proof of Trade lets them use that record **without disclosing it**.

## What it does

A lender publishes simple terms, for example:

> 12 weeks of sales totalling at least **25,000,000 GNF**, and no week below **1,500,000 GNF**.

The merchant's device runs a zero-knowledge circuit over her private weekly totals. If, and only if,
the terms hold, a proof is accepted on-chain and the public ledger records:

```
merchant pseudonym (for this lender)  ->  { threshold: 25,000,000, weeklyMinimum: 1,500,000 }
```

That is all anyone else learns: not the weekly figures, not the total, not the margin by which she
qualified, not her identity. The lender checks the pseudonym the merchant gives them against the
ledger. The pseudonym is different for every lender, so two lenders (or anyone watching the chain)
cannot tell that they are dealing with the same merchant.

## How Midnight is used

| Midnight feature | Where | Why it matters here |
|---|---|---|
| **Witnesses (private inputs)** | `weeklySales()`, `merchantSecret()` in [`contracts/proof-of-trade.compact`](contracts/proof-of-trade.compact), supplied by [`contracts/witnesses.ts`](contracts/witnesses.ts) | The 12 weekly totals and the merchant secret never leave the merchant's private state store. |
| **Circuit assertions over private data** | `assert(week >= weeklyMinimum)` for every week, `assert(total >= threshold)` | The rules are enforced inside the ZK proof. A merchant who doesn't meet them cannot produce a valid transaction at all. |
| **Selective disclosure with `disclose()`** | Only the pseudonym and the terms are disclosed | The compiler forces every private-to-public flow to be explicit, so it is auditable that no sales figure is published. |
| **Pure circuit for a pseudonym** | `merchantId(secret, lender)` = `persistentHash([pad(32, "mru:proof-of-trade:merchant:v1"), secret, lender])` | A per-lender identifier the merchant hands to that lender. It is unlinkable to her identity, her wallet, and her pseudonyms with other lenders. The secret is 32 random bytes, so the hash can't be brute-forced; the tag is versioned and domain-separated. |
| **Public ledger state** | `attestations: Map<Bytes<32>, Attestation>`, `proofsIssued: Counter` | Anyone can verify an attestation; nobody can read the underlying data. |

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

# 4. Deploy and run the demo scenario (about 90 seconds)
yarn test:local

yarn env:down
```

> `compact` 0.34 compiles fine but its output needs a newer `compact-runtime` than the pinned
> midnight-js 4.1.1 packages ship ("compiled code expects 0.19.0, runtime is 0.16.0"). Use 0.31.1.

## Demo flow

`yarn test:local` runs the whole story against a real local Midnight chain, with real proofs
(from the local proof server) and real transactions. Sample data is in
[`src/demo-data.ts`](src/demo-data.ts). The merchants are fictional.

1. **Deploy.** The attestation registry starts empty.
2. **Aminata qualifies.** She runs a fabric stall in Madina market, Conakry: 12 steady weeks,
   33.56M GNF in total. She proves the loan terms. The ledger gains one attestation holding only
   her pseudonym and the terms. The test checks that none of her weekly figures, her total or her
   secret appears in the public state.
3. **She can't overclaim.** Asking to prove a threshold of her real total + 1 GNF is refused by the
   circuit ("Sales total is below the threshold"). No transaction, no ledger change.
4. **Moussa is refused.** He has a bigger total (34.43M GNF), but his kiosk was shut for one week
   (400,000 GNF). The circuit refuses ("A week fell below the minimum").
5. **Moussa qualifies with another lender** (a tontine offering 20M total, 400k weekly minimum). A
   lender offering a smaller loan can still serve him, again without seeing his sales.
6. **Two lenders can't link her.** Aminata also proves terms to the tontine. The ledger now holds two
   attestations for her under two different pseudonyms; nothing connects them.

```
✓ deploys with an empty attestation registry
✓ a qualifying merchant proves the loan terms without revealing her sales
✓ cannot prove a threshold above the real sales total
✓ a merchant with one week below the minimum cannot get an attestation
✓ the same merchant can qualify with another lender on terms that match his record
✓ two lenders see unlinkable pseudonyms for the same merchant
Tests  6 passed (6)
```

## Security and privacy notes

Checked against Midnight's [smart contract security guidance](https://docs.midnight.network/compact/smart-contract-security):

- **Witnesses are untrusted.** Everything the contract relies on is re-checked by assertions inside the circuit.
- **Minimal, late disclosure.** `disclose()` wraps only the pseudonym and the terms, at the point where they are written to the ledger.
- **No `ownPublicKey()` for identity.** Identity comes from a secret that only the merchant holds.
- **Pseudonyms can't be brute-forced or linked.** They are domain-separated, versioned, per-lender hashes of a 32-byte random secret.
- **Assertion messages name no week and no figure.** A failed proof never produces a transaction, so a refusal leaves no on-chain trace.
- **No overflow.** 12 × (2³² − 1) < 2³⁶, so the 64-bit total cannot overflow.
- **Dependencies are clean.** `yarn audit` reports 0 vulnerabilities, with patched versions pinned via `resolutions`.
- **No secrets in the repo.** The only key-like values are Midnight's public local-dev seed and the compose defaults for a local-only stack.

## Honest limits and next step

- **The proof is only as good as its input.** Today the weekly totals come from the merchant's own
  ledger, so a merchant could type in false numbers. The next step is to have the mobile-money
  operator (MTN MoMo, Orange Money) or MRU's server **sign** each weekly total, and to verify
  that signature inside the circuit. Then the claim becomes "an operator-attested record
  satisfies these terms", which a lender can rely on.
- A lender may want freshness: add the period end date to the attestation and let lenders require
  a recent one.
- One attestation per merchant pseudonym: a new proof overwrites the old one. A merchant keeps her
  best current claim.

## Project layout

```
contracts/proof-of-trade.compact   the Compact contract (circuit + ledger)
contracts/witnesses.ts             private inputs from the merchant's local state
contracts/index.ts                 compiled-contract wiring
src/demo-data.ts                   sample merchants and loan terms (fictional)
src/test/pot.test.ts               end-to-end demo against a local Midnight network
src/{config,providers,wallet}.ts   network, provider and wallet setup
compose.yml                        local node, indexer and proof server
```

Scaffolded from [midnightntwrk/example-hello-world](https://github.com/midnightntwrk/example-hello-world) (Apache-2.0).
