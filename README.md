# XRPL<>EVM Bridge

> A simple PoC multi-sig bridge for wrapping XRP, the native token of the [XRP Ledger](https://xrpl.org/), to EVM-compatible chains.

The purpose of this bridge is to demonstrate the feasibility of such a system and a way to learn more about the XRPL stack. It comes with many caveats that are mentioned below.

## Architecture

The entry point of the bridge is on the XRP Ledger. On XRPL, there exists a custodian [multi-sig account](https://xrpl.org/multi-signing.html) that is responsible for holding and releasing funds. On the EVM side of the bridge lies a partial deployment of the [Enosys Bridge](https://github.com/flrfinance/bridge-contracts), specifically the [WrapMintBurn](https://github.com/flrfinance/bridge-contracts/blob/main/src/WrapMintBurn.sol) contract. A standard ERC-20 token is also needed; it will act as the wrapped version of the XRP token, on the EVM side.

Off-chain, there are validator processes, written in TypeScript, that watch and sign transactions between the two sides of the bridge. The number of validators required is specified during the deployment of `WrapMintBurn` and can also be re-configured during the lifetime of the bridge.

Below is an outline of the process of wrapping and un-wrapping tokens using the bridge:
- The user needs to acquire a Destination Tag from the Bridge Maintainer, mapping this tag to a destination address on the EVM side.
- The user deposits `X` amount of XRP to the multi-sig account on XRPL, specifying the Destination Tag provided by the Bridge Maintainer.
- The Validator processes watch for transactions on the multi-sig account and capture the user's deposit. They then attest to this transaction on the EVM side. Once the transaction has been attested by enough validators (i.e., quorum has been reached), it is executed and the user receives the corresponding wrapped tokens to their EVM account.
- If the user decides to unwrap their tokens, they deposit the desired amount on the `WrapMintBurn` contract.
- The Validator processes also watch for deposits on the EVM side. Once they observe a deposit event, each of them signs a transaction for XRPL to return XRP to the user's wallet.
- Once enough signatures have been gathered, the transaction is submitted and the user receives the corresponding XRP tokens.

## Caveats

### Signature Gathering

In order for an XRPL multi-sig transaction to be executed, all the required signatures must be gathered before publishing the transaction to the XRPL network. There needs to be a mechanism to gather those transactions across Validators running on different machines/networks. This mechanism is out-of-scope for this project, so, instead, we assumed that the Validators will be running on the same machine and are submitting their signatures in a Redis database. The last one to sign the transaction also broadcasts it, along with the signatures, to XRPL.

### Ordered Execution of Transactions

The `WrapMintBurn` contract executes transactions sequentially. For example, deposit #2 cannot be executed before deposit #1. If a Validator finds and submits deposit #2 before deposit #1, then deposit #2 will never be executed. Deposit #1 will be executed, and there will be no retry for deposit #2. In that scenario, no other deposits will be executed after #1. It is currently best to complete a wrap before starting another one, to make sure that they will arrive in the proper order.

### Destination Tag Mapping

Currently, the only user input is the Destination Tag, which is quite limiting. There needs to be a mapping between Destination Tags and recipient addresses to know where to send the funds on both sides of the bridge. This mapping is currently hardcoded in the Validator process code. Another option would be to use [XRPL Memos](https://xrpl.org/transaction-common-fields.html#memos-field) and pass an arbitrary address along with the deposit, eliminating the need for a mapping.

### Submission of Signatures

The XRPL transaction that the Validators sign includes a [Sequence](https://xrpl.org/basic-data-types.html#account-sequence) number, which is the transaction number of the multi-sig account. Gathering signatures takes time, and there might be other transactions in the meantime. If another transaction is executed from that multi-sig, then the multisigned transaction will not be executable since the Sequence number will be outdated. It is currently best to complete an unwrapping before starting another one, to make sure that no other transactions will be executed until all the signatures have been gathered for a given unwrapping. To fix this, [XRPL Tickets](https://xrpl.org/tickets.html) could be used, allowing a transaction to be executed out of order.

## Setup

- Install dependencies via NPM:
```bash
npm install
```
- Create the necessary accounts for XRP:
```bash
CHAIN=xrp npx ts-node lib/create-wallet.ts
```
- Create the necessary accounts for the EVM-compatible chain (currently hardcoded to Sepolia):
```bash
npx ts-node lib/create-wallet.ts
```
- Specify the accounts that you just created in `accounts.json`.
- Fund the EVM-compatible wallets with some native tokens (e.g., using a faucet). The XRPL wallets are already funded.
- Start a Redis Server on the default port.
- The bridge is currently configured to run with 2 validators, so you will need 2 validator processes running in parallel:
```bash
VALIDATOR_IDX=0 npx ts-node validator.ts
```
```bash
VALIDATOR_IDX=1 npx ts-node validator.ts
```
- Both validators should be listening for transactions now. You can either manually try to send some XRP to the multi-sig account, or use the following helper script:
```bash
CHAIN=xrp npx ts-node lib/send.ts
```
- To unwrap, on the EVM side, either call `deposit()` on the `WrapMintBurn` contract or use the helper script:
```bash
npx ts-node lib/send.ts
```
